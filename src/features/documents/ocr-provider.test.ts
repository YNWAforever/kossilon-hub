import { describe, expect, it, vi } from "vitest";
import { runDocumentOcr, type DocumentOcrProvider } from "./ocr-provider";

const input = {
  documentVersionId: "11111111-1111-4111-8111-111111111111",
  sha256: "a".repeat(64),
  body: new ArrayBuffer(1),
  contentType: "image/png",
};
describe("internal OCR evidence boundary", () => {
  it("never treats a malformed failure as a valid unknown reason", async () => {
    const provider = {
      extract: async () => ({ status: "failed" }),
    } as unknown as DocumentOcrProvider;
    expect(await runDocumentOcr(provider, input)).toEqual({
      status: "failed",
      errorCode: "ocr-invalid-evidence",
    });
  });
  it("rejects an invalid timeout before invoking the provider", async () => {
    const extract = vi.fn(async () => ({ status: "failed" as const, errorCode: "synthetic" }));
    expect(await runDocumentOcr({ extract }, input, NaN)).toEqual({
      status: "failed",
      errorCode: "ocr-invalid-timeout",
    });
    expect(extract).not.toHaveBeenCalled();
  });
  it("bounds a provider that ignores abort", async () => {
    expect(await runDocumentOcr({ extract: () => new Promise(() => {}) }, input, 5)).toEqual({
      status: "failed",
      errorCode: "ocr-timeout",
    });
  });
});
