import { describe, expect, it, vi } from "vitest";
import { downloadWoztellMedia } from "./media-download";

const pdf = new TextEncoder().encode("%PDF-1.7\nOwned synthetic media\n%%EOF");
const options = {
  fileId: "owned-file-id",
  accessToken: "owned-token",
  allowedHosts: ["media.example.test"],
  resolveHost: async () => ["93.184.216.34"],
};
function response(url = "https://media.example.test/owned.pdf", size = pdf.byteLength) {
  return new Response(
    JSON.stringify({ data: { apiViewer: { file: { fileId: options.fileId, url, size } } } }),
    { headers: { "content-type": "application/json" } },
  );
}
describe("bounded WOZTELL file retrieval", () => {
  it("uses the documented fileId GraphQL contract and returns hashed bounded bytes", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const result = await downloadWoztellMedia({
      ...options,
      fetchImpl: async (url, init) => {
        calls.push([String(url), init]);
        return calls.length === 1
          ? response()
          : new Response(pdf, { headers: { "content-type": "application/pdf" } });
      },
    });
    expect(result).toMatchObject({
      status: "downloaded",
      fileId: options.fileId,
      sizeBytes: pdf.byteLength,
      contentType: "application/pdf",
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(calls[0][0]).toBe("https://open.api.woztell.com/v3");
    expect(JSON.parse(calls[0][1]!.body as string)).toMatchObject({
      variables: { fileId: options.fileId },
    });
    expect(JSON.parse(calls[0][1]!.body as string).query).toContain("file(fileId: $fileId)");
    expect(new Headers(calls[1][1]!.headers).has("authorization")).toBe(false);
    expect(calls[1][1]!.redirect).toBe("manual");
  });
  it.each([
    "http://media.example.test/x",
    "https://127.0.0.1/x",
    "https://evil.example/x",
    "https://user:password@media.example.test/x",
  ])("refuses an unsafe file URL: %s", async (url) => {
    const fetchImpl = vi.fn(async () => response(url));
    expect(await downloadWoztellMedia({ ...options, fetchImpl })).toMatchObject({
      status: "blocked",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refuses a private DNS answer before downloading bytes", async () => {
    const fetchImpl = vi.fn(async () => response());
    expect(
      await downloadWoztellMedia({ ...options, resolveHost: async () => ["10.0.0.8"], fetchImpl }),
    ).toMatchObject({ status: "blocked", errorCode: "media-private-host" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rechecks redirects and never forwards credentials to a media host", async () => {
    const fetchImpl = vi.fn(async () =>
      fetchImpl.mock.calls.length === 1
        ? response()
        : new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/latest/meta-data" },
          }),
    );
    expect(await downloadWoztellMedia({ ...options, fetchImpl })).toMatchObject({
      status: "blocked",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized metadata before fetching media", async () => {
    const fetchImpl = vi.fn(async () => response(undefined, 10 * 1024 * 1024 + 1));
    expect(await downloadWoztellMedia({ ...options, fetchImpl })).toMatchObject({
      status: "blocked",
      errorCode: "media-too-large",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong-mime", "interrupted"])(
    "contains %s downloads without a document or fake scan",
    async (mode) => {
      let calls = 0;
      const fetchImpl = async () => {
        if (++calls === 1) return response();
        return mode === "wrong-mime"
          ? new Response(pdf, { headers: { "content-type": "image/png" } })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(pdf.slice(0, 5));
                  controller.error(new Error("owned disconnect"));
                },
              }),
              { headers: { "content-type": "application/pdf" } },
            );
      };
      expect(await downloadWoztellMedia({ ...options, fetchImpl })).toMatchObject({
        status: mode === "wrong-mime" ? "blocked" : "failed",
      });
    },
  );
  it("stays blocked without an approved exact host policy", async () => {
    const fetchImpl = vi.fn();
    expect(await downloadWoztellMedia({ ...options, allowedHosts: [], fetchImpl })).toMatchObject({
      status: "blocked",
      errorCode: "media-host-policy-missing",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
