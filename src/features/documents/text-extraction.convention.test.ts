import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * pdf.js is the largest attack surface in the Worker: it parses bytes a client
 * chose. Keeping it behind one function keeps the scan gate the only way in --
 * a second importer could parse a document the gate never saw.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const UNPDF_IMPORT = /from\s+["']unpdf(?:\/[^"']*)?["']|import\s*\(?\s*["']unpdf(?:\/[^"']*)?["']/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("unpdf import boundary", () => {
  it.each([
    'import { extractText } from "unpdf";',
    "import 'unpdf';",
    'const m = await import("unpdf");',
    'import { getDocument } from "unpdf/pdfjs";',
    'export { extractText } from "unpdf";',
  ])("recognises %s as an unpdf import", (line) => {
    expect(UNPDF_IMPORT.test(line)).toBe(true);
  });

  it("does not mistake pdfjs-dist for unpdf", () => {
    expect(UNPDF_IMPORT.test('import * as pdfjs from "pdfjs-dist";')).toBe(false);
  });

  it("is imported by text-extraction.ts and nothing else", () => {
    const importers = sourceFiles(SRC)
      .filter((path) => UNPDF_IMPORT.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"));

    expect(importers).toEqual(["src/features/documents/text-extraction.ts"]);
  });
});
