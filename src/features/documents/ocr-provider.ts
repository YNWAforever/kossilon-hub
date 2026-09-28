import type { ExtractionResult } from "./text-extraction";

export type OcrPage = { page: number; text: string; confidence: number };
export type OcrResult = {
  method: "ocr";
  pages: readonly OcrPage[];
  providerReference: string;
  modelVersion: string;
  latencyMs: number;
  costMinor: number;
};
export type DocumentOcrProvider = {
  extract(input: {
    documentVersionId: string;
    contentSha256: string;
    contentType: string;
    body: ArrayBuffer;
  }): Promise<OcrResult>;
};

/** No live OCR adapter can be enabled until a provider contract is approved. */
export function createDocumentOcrProvider(): DocumentOcrProvider | null {
  return null;
}

/** Digital text first. A scanned or sparse file needs real OCR or human review. */
export function chooseOcrPath(input: {
  extraction: ExtractionResult;
  ocrAvailable: boolean;
}): "text-layer" | "ocr" | "human-only" {
  if (
    input.extraction.method === "text-layer" &&
    !input.extraction.truncated &&
    input.extraction.text.trim().length >= 120
  )
    return "text-layer";
  if (input.extraction.method === "unreadable") return "human-only";
  return input.ocrAvailable ? "ocr" : "human-only";
}
