import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHINESE_PHRASE,
  ENGLISH_PHRASE,
  SECOND_PAGE_MARKER,
  chinesePdf,
  encryptedPdf,
  englishPdf,
  imageOnlyPdf,
  longFirstPagePdf,
  longTextPdf,
  manyPagePdf,
  pngBytes,
  threePagePdf,
  truncatedPdf,
} from "@/test/synthetic-pdf";
import {
  MAX_EXTRACTED_CHARS,
  MAX_EXTRACTED_PAGES,
  cleanExtractedText,
  extractPdfText,
} from "./text-extraction";

/**
 * The real unpdf, with every document proxy's `getPage` recorded. Nothing is
 * faked: the proxy is pdf.js's own, so the page numbers here are the pages the
 * extractor actually asked pdf.js to parse.
 */
const pagesRead = vi.hoisted(() => [] as number[]);
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    getDocumentProxy: async (...args: Parameters<typeof actual.getDocumentProxy>) => {
      const pdf = await actual.getDocumentProxy(...args);
      const getPage = pdf.getPage.bind(pdf);
      pdf.getPage = (pageNumber: number) => {
        pagesRead.push(pageNumber);
        return getPage(pageNumber);
      };
      return pdf;
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  pagesRead.length = 0;
});

describe("extractPdfText", () => {
  it("reads the text layer and page count of a digital PDF", async () => {
    const result = await extractPdfText({ body: englishPdf(), contentType: "application/pdf" });

    expect(result).toEqual({
      method: "text-layer",
      text: ENGLISH_PHRASE,
      pageCount: 1,
      truncated: false,
      pages: [{ page: 1, text: ENGLISH_PHRASE }],
    });
  });

  /**
   * The reason for choosing unpdf over a hand-written parser. Without the
   * ToUnicode map applied, this comes back as CIDs or mojibake, and wrong text
   * presented as extracted text is worse than none.
   */
  it("returns Traditional Chinese as characters, verbatim", async () => {
    const result = await extractPdfText({ body: chinesePdf(), contentType: "application/pdf" });

    expect(result.method).toBe("text-layer");
    if (result.method !== "text-layer") return;
    expect(result.text).toBe(CHINESE_PHRASE);
  });

  it("counts every page", async () => {
    const result = await extractPdfText({ body: threePagePdf(), contentType: "application/pdf" });

    expect(result).toMatchObject({
      method: "text-layer",
      pageCount: 3,
      pages: [{ page: 1 }, { page: 2 }, { page: 3 }],
    });
  });

  /**
   * A scan. `none` with a real page count -- not `unreadable`, because the file
   * opened fine, and not an empty `text-layer`, which would claim text was found.
   */
  it("reports no text layer for a PDF that has none", async () => {
    const result = await extractPdfText({ body: imageOnlyPdf(), contentType: "application/pdf" });

    expect(result).toEqual({ method: "none", pageCount: 1 });
  });

  it("reports an encrypted PDF as unreadable by class, never by message", async () => {
    const result = await extractPdfText({ body: encryptedPdf(), contentType: "application/pdf" });

    expect(result).toEqual({ method: "unreadable", errorClass: "PasswordException" });
  });

  it("reports a truncated PDF as unreadable rather than throwing", async () => {
    const result = await extractPdfText({ body: truncatedPdf(), contentType: "application/pdf" });

    expect(result).toEqual({ method: "unreadable", errorClass: "InvalidPDFException" });
  });

  /**
   * Sniffed from the bytes, not the declared type. An image declared as a PDF
   * is still an image, and a PDF declared as an image is still read.
   */
  it("does not parse an image, whatever it was declared as", async () => {
    const result = await extractPdfText({ body: pngBytes(), contentType: "application/pdf" });

    expect(result).toEqual({ method: "none", pageCount: null });
  });

  it("reads a PDF even when the upload declared something else", async () => {
    const result = await extractPdfText({ body: englishPdf(), contentType: "image/png" });

    expect(result.method).toBe("text-layer");
  });

  it("cuts text at the limit and says so", async () => {
    const result = await extractPdfText({
      body: longTextPdf(MAX_EXTRACTED_CHARS + 50),
      contentType: "application/pdf",
    });

    expect(result.method).toBe("text-layer");
    if (result.method !== "text-layer") return;
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
    expect(result.truncated).toBe(true);
  });

  /**
   * The limit bounds work, not just storage: once page 1 alone passes it, no
   * later page is parsed, yet the page count is still the document's own.
   */
  it("stops reading pages once the text limit is passed", async () => {
    const result = await extractPdfText({
      body: longFirstPagePdf(MAX_EXTRACTED_CHARS + 50),
      contentType: "application/pdf",
    });

    expect(result).toMatchObject({ method: "text-layer", pageCount: 2, truncated: true });
    if (result.method !== "text-layer") return;
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
    expect(result.text).not.toContain(SECOND_PAGE_MARKER);
    expect(pagesRead).toEqual([1]);
  });

  /**
   * Stopping early is itself truncation. What was read back can fit within the
   * limit, and a result that skipped pages must not then claim to be complete.
   */
  it("reports truncation when it stopped early, even if the text fits", async () => {
    // Exactly at the limit: the joining newline counted per page trips the
    // early stop, yet the cleaned text is not longer than the limit.
    const result = await extractPdfText({
      body: longFirstPagePdf(MAX_EXTRACTED_CHARS),
      contentType: "application/pdf",
    });

    expect(pagesRead).toEqual([1]);
    expect(result).toMatchObject({ method: "text-layer", pageCount: 2, truncated: true });
  });

  it("reads every page, one at a time, when the limit is not reached", async () => {
    await extractPdfText({ body: threePagePdf(), contentType: "application/pdf" });

    expect(pagesRead).toEqual([1, 2, 3]);
  });

  /** A hostile page count is refused before any page is parsed. */
  it("refuses a PDF with more than MAX_EXTRACTED_PAGES pages without parsing a page", async () => {
    const result = await extractPdfText({
      body: manyPagePdf(MAX_EXTRACTED_PAGES + 1),
      contentType: "application/pdf",
    });

    expect(result).toEqual({ method: "unreadable", errorClass: "too-many-pages" });
    expect(pagesRead).toEqual([]);
  });

  it("still reads a PDF of exactly MAX_EXTRACTED_PAGES pages", async () => {
    const result = await extractPdfText({
      body: manyPagePdf(MAX_EXTRACTED_PAGES),
      contentType: "application/pdf",
    });

    expect(result).toMatchObject({
      method: "text-layer",
      pageCount: MAX_EXTRACTED_PAGES,
      truncated: false,
    });
    if (result.method !== "text-layer") return;
    expect(result.text).toContain(`Page ${MAX_EXTRACTED_PAGES}`);
  });

  /**
   * Postgres `text` refuses NUL. A PDF can carry one in its text layer, and
   * letting it through would turn a readable document into a failed write and a
   * retry loop.
   */
  it("strips NUL characters, which Postgres text cannot store", async () => {
    const result = await extractPdfText({
      body: englishPdf("before\\000after"),
      contentType: "application/pdf",
    });

    expect(result.method).toBe("text-layer");
    if (result.method !== "text-layer") return;
    expect(result.text).not.toContain("\u0000");
    expect(result.text).toContain("before");
    expect(result.text).toContain("after");
  });

  /**
   * The PDF route cannot prove this: pdf.js maps `\000` in a simple font to a
   * space before the text reaches us. The sanitize step is tested directly.
   */
  it("removes every NUL from extracted text", () => {
    expect(cleanExtractedText("  a\u0000b\u0000\u0000c  ")).toBe("abc");
  });

  /**
   * unpdf defaults `standardFontDataUrl` / `cMapUrl` to local files in Node; in
   * a Worker the same URLs would be fetched. pdf.js logs the URL it failed to
   * load, so no such log line means no URL was configured.
   */
  it("configures no font or CMap data URL", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");

    await extractPdfText({ body: englishPdf(), contentType: "application/pdf" });
    await extractPdfText({ body: chinesePdf(), contentType: "application/pdf" });

    const urls = [...log.mock.calls, ...warn.mock.calls]
      .flat()
      .map(String)
      .filter((line) => /standard_fonts|cmaps|file:\/\//.test(line));
    expect(urls).toEqual([]);
  });

  /** The Worker must not reach out to a CDN for font or CMap data while reading a client's document. */
  it("makes no network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await extractPdfText({ body: chinesePdf(), contentType: "application/pdf" });
    await extractPdfText({ body: englishPdf(), contentType: "application/pdf" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not detach the caller's buffer", async () => {
    const body = englishPdf();
    const before = body.byteLength;

    await extractPdfText({ body, contentType: "application/pdf" });

    expect(body.byteLength).toBe(before);
  });
});
