import { test, expect } from "@playwright/test";
import { englishPdf, ENGLISH_PHRASE } from "../src/test/synthetic-pdf";

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
