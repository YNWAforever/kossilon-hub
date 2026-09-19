import { sniffContentType } from "./analysis-checks";

/**
 * Server-side text extraction for PDFs, inside the Worker.
 *
 * The only file that imports `unpdf` (text-extraction.convention.test.ts holds
 * that line). `doc-parser.ts` stays browser-only: `pdfjs-dist` evaluates
 * `new DOMMatrix()` at module scope, which workerd does not have. `unpdf` ships
 * a serverless build of the same pdf.js, so font handling -- including the
 * ToUnicode maps Chinese text depends on -- is pdf.js's own, not a rewrite.
 *
 * PDFs only. An image has no text layer to read, and OCR is a separate problem.
 */

export const EXTRACTOR_VERSION = "1";

/**
 * A ceiling on what one version stores. Generous for any real filing document;
 * the point is that one pathological upload cannot put megabytes in a row.
 */
export const MAX_EXTRACTED_CHARS = 200_000;

export type ExtractionResult =
  | { method: "text-layer"; text: string; pageCount: number; truncated: boolean }
  /**
   * Opened, no text on any page (a scan), or not a PDF at all (`pageCount`
   * null). A real outcome, distinct from "not extracted yet", which is no row.
   */
  | { method: "none"; pageCount: number | null }
  /**
   * Encrypted or corrupt. The error's class only: a message can carry file
   * content, and this ends up on a reviewer's screen.
   */
  | { method: "unreadable"; errorClass: string };

/** What `document_version_texts` records. An unreadable result is not stored. */
export type StoredExtraction = Exclude<ExtractionResult, { method: "unreadable" }> & {
  extractorVersion: string;
};

/**
 * pdf.js options for a Worker reading untrusted bytes.
 *
 * No eval, no system fonts, no font faces: nothing here renders, it only reads
 * text. With no `standardFontDataUrl` or `cMapUrl` there is nothing to fetch, so
 * a non-embedded CJK font yields less text rather than a request to a CDN.
 */
const PDF_OPTIONS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  stopAtErrors: true,
} as const;

function errorClassOf(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "unknown";
}

export async function extractPdfText(input: {
  body: ArrayBuffer;
  /** Accepted so the call site reads honestly; deliberately not consulted. */
  contentType: string | null;
}): Promise<ExtractionResult> {
  // Sniffed, not declared: the declaration is whatever the uploader said.
  const head = new Uint8Array(input.body, 0, Math.min(16, input.body.byteLength));
  if (sniffContentType(head) !== "application/pdf") return { method: "none", pageCount: null };

  try {
    // Loaded lazily so nothing that merely imports this module pays for pdf.js.
    const { extractText, getDocumentProxy } = await import("unpdf");
    // A copy: pdf.js takes ownership of the buffer it is handed and can detach
    // it, and the caller still needs its bytes.
    const pdf = await getDocumentProxy(new Uint8Array(input.body.slice(0)), PDF_OPTIONS);
    try {
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      const clean = text.replaceAll("\u0000", "").trim();
      if (clean.length === 0) return { method: "none", pageCount: totalPages };

      const truncated = clean.length > MAX_EXTRACTED_CHARS;
      return {
        method: "text-layer",
        text: truncated ? clean.slice(0, MAX_EXTRACTED_CHARS) : clean,
        pageCount: totalPages,
        truncated,
      };
    } finally {
      // pdf.js 6 removed PDFDocumentProxy.destroy(); the loading task owns teardown.
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    return { method: "unreadable", errorClass: errorClassOf(error) };
  }
}
