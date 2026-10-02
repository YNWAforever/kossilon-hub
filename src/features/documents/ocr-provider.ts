import { z } from "zod";

/** Internal port only. No vendor endpoint/protocol is assumed or enabled. */
export type DocumentOcrProvider = {
  extract(input: {
    documentVersionId: string;
    sha256: string;
    body: ArrayBuffer;
    contentType: string | null;
    signal?: AbortSignal;
  }): Promise<DocumentOcrResult>;
};
export type DocumentOcrResult =
  | {
      status: "extracted";
      documentVersionId: string;
      sha256: string;
      pages: { page: number; text: string; confidence: number | null }[];
      providerReference: string;
      model: string | null;
      cost: number | null;
    }
  | { status: "blocked" | "failed"; errorCode: string };

const resultSchema = z
  .object({
    status: z.literal("extracted"),
    documentVersionId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pages: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(200),
            text: z.string().max(200_000),
            confidence: z.number().min(0).max(1).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    providerReference: z.string().min(1).max(200),
    model: z.string().min(1).max(100).nullable(),
    cost: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export async function runDocumentOcr(
  provider: DocumentOcrProvider | null | undefined,
  input: Parameters<DocumentOcrProvider["extract"]>[0],
  timeoutMs = 30_000,
): Promise<DocumentOcrResult> {
  if (!provider) return { status: "blocked", errorCode: "ocr-unconfigured" };
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    return { status: "failed", errorCode: "ocr-invalid-timeout" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<DocumentOcrResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "failed", errorCode: "ocr-timeout" });
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      provider.extract({ ...input, signal: controller.signal }),
      deadline,
    ]);
    if (result?.status !== "extracted") {
      if (
        (result?.status !== "blocked" && result?.status !== "failed") ||
        typeof result.errorCode !== "string" ||
        !/^[a-z0-9-]{1,80}$/.test(result.errorCode)
      )
        return { status: "failed", errorCode: "ocr-invalid-evidence" };
      return result;
    }
    const parsed = resultSchema.safeParse(result);
    if (
      !parsed.success ||
      result.documentVersionId !== input.documentVersionId ||
      result.sha256 !== input.sha256 ||
      new Set(result.pages.map((page) => page.page)).size !== result.pages.length ||
      result.pages.reduce((n, page) => n + page.text.length, 0) > 200_000
    )
      return { status: "failed", errorCode: "ocr-invalid-evidence" };
    return parsed.data;
  } catch {
    return { status: "failed", errorCode: "ocr-transport" };
  } finally {
    clearTimeout(timer!);
  }
}
