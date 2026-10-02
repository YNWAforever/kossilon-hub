import { z } from "zod";
const schema = z
  .object({ handoffId: z.string().uuid(), expectedVersion: z.string().min(1).max(200) })
  .strict();
type Exporter = (
  request: Request,
  data: z.infer<typeof schema>,
) => Promise<{ fileName: string; zip: Uint8Array }>;
async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  const parts: Uint8Array[] = [];
  let total = 0,
    timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), 10000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > 2048) throw new Error("body limit");
          parts.push(value);
        }
        const bytes = new Uint8Array(total);
        let at = 0;
        for (const part of parts) {
          bytes.set(part, at);
          at += part.length;
        }
        return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      })(),
    ]);
  } finally {
    clearTimeout(timer!);
    void reader.cancel().catch(() => {});
  }
}
export function createHandoffExportHttpHandler(exporter: Exporter) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    };
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...headers, allow: "POST" },
      });
    // JSON POST plus exact same Origin prevents cross-site export/audit writes.
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return new Response(JSON.stringify({ error: "forbidden_origin" }), { status: 403, headers });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return new Response(JSON.stringify({ error: "json_required" }), { status: 415, headers });
    let data: z.infer<typeof schema>;
    try {
      data = await boundedJson(request);
    } catch {
      return new Response(JSON.stringify({ error: "invalid_export_request" }), {
        status: 400,
        headers,
      });
    }
    try {
      const archive = await exporter(request, data);
      if (!/^approved-package-[0-9a-f-]{36}\.zip$/.test(archive.fileName))
        throw new Error("Invalid server filename");
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= archive.zip.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 65536, archive.zip.length);
          controller.enqueue(archive.zip.subarray(offset, end));
          offset = end;
        },
      });
      return new Response(stream, {
        headers: {
          ...headers,
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${archive.fileName}"`,
        },
      });
    } catch (error) {
      const status =
        (error as { statusCode?: number }).statusCode === 409
          ? 409
          : error instanceof Error && /Forbidden:|read-only/.test(error.message)
            ? 403
            : 503;
      return new Response(
        JSON.stringify({
          error:
            status === 409
              ? "package_version_conflict"
              : status === 403
                ? "export_forbidden"
                : "export_unavailable",
        }),
        { status, headers },
      );
    }
  };
}
