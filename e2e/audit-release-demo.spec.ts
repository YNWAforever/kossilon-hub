import { test, expect } from "@playwright/test";
import { englishPdf, ENGLISH_PHRASE } from "../src/test/synthetic-pdf";
import JSZip from "jszip";

test("LOCAL supplemental: real DOCX parser retains paragraphs, Unicode and literal markup", async ({
  page,
}) => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>香港年報 &amp; synthetic only</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;literal text&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>',
  );
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await page.goto("/login");
  const result = await page.evaluate(async (data) => {
    const parserPath = "/src/lib/doc-parser.ts";
    const { parseFile } = await import(/* @vite-ignore */ parserPath);
    return parseFile(
      new File([new Uint8Array(data)], "synthetic-audit.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
  }, Array.from(bytes));
  const text = "香港年報 & synthetic only\n\n<script>literal text</script>";
  expect(result.text).toBe(text);
  expect(result.chunks).toEqual([text]);
  expect(result.summary).toBe("香港年報 & synthetic only <script>literal text</script>");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("LOCAL supplemental: real PDF parser and worker extract a synthetic file without a provider claim", async ({
  page,
}) => {
  await page.goto("/login");
  const result = await page.evaluate(
    async (bytes) => {
      const parserPath = "/src/lib/doc-parser.ts";
      const { parseFile } = await import(/* @vite-ignore */ parserPath);
      try {
        return await parseFile(
          new File([new Uint8Array(bytes)], "synthetic-audit.pdf", { type: "application/pdf" }),
        );
      } catch (error) {
        const failure = error as { name?: string; message?: string; details?: string };
        throw new Error([failure.name, failure.message, failure.details].join(" | "));
      }
    },
    Array.from(new Uint8Array(englishPdf())),
  );
  expect(result.text).toBe(ENGLISH_PHRASE);
  expect(result.pageCount).toBe(1);
  expect(result.chunks).toContain(ENGLISH_PHRASE);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});
