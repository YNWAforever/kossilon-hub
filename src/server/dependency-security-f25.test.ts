import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const quote = (require("shell-quote") as { quote: (tokens: unknown[]) => string }).quote;
const SourceMapConsumer = (
  require("source-map-js") as { SourceMapConsumer: new (map: unknown) => unknown }
).SourceMapConsumer;
const mammothRequire = createRequire(require.resolve("mammoth"));
const mammoth = mammothRequire("mammoth") as {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};
const Zip = mammothRequire("jszip") as new () => {
  file: (name: string, contents: string) => void;
  generateAsync: (options: { type: "nodebuffer" }) => Promise<Buffer>;
};

async function docxFixture() {
  const zip = new Zip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Kossilon compatibility 公司文件</w:t></w:r></w:p></w:body></w:document>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("F25 dependency security and document compatibility", () => {
  it.each(["\n", "\r", "\u2028", "\u2029"])(
    "rejects a shell line terminator %j after a comment token without invoking a shell",
    (terminator) => {
      expect(() => quote(["echo", "ok", { comment: "untrusted" }, `a${terminator}id;#`])).toThrow(
        TypeError,
      );
    },
  );

  it.each([-1, 10_000_001])("rejects an unsafe indexed source map offset %i", (line) => {
    expect(
      () =>
        new SourceMapConsumer({
          version: 3,
          sections: [
            {
              offset: { line, column: 0 },
              map: { version: 3, sources: ["fixture.js"], names: [], mappings: "AAAA" },
            },
          ],
        }),
    ).toThrow();
  });

  it("removes the unpatched sprintf-js path from the installed DOCX CLI parser", () => {
    const parser = mammothRequire("argparse/package.json") as {
      dependencies?: Record<string, string>;
    };
    expect(parser.dependencies ?? {}).not.toHaveProperty("sprintf-js");
  });

  it("still extracts real synthetic DOCX bytes through the existing API", async () => {
    const result = await mammoth.extractRawText({ buffer: await docxFixture() });
    expect(result.value).toBe("Kossilon compatibility 公司文件\n\n");
  });

  it("preserves mammoth CLI input and output-format arguments after the parser change", async () => {
    const scratch = resolve(process.cwd(), ".worktrees");
    mkdirSync(scratch, { recursive: true });
    const owned = mkdtempSync(resolve(scratch, "r13-docx-"));
    if (dirname(owned) !== scratch || !owned.startsWith(`${scratch}${sep}r13-docx-`)) {
      throw new Error("Owned DOCX fixture identity mismatch");
    }
    try {
      const input = resolve(owned, "fixture.docx");
      writeFileSync(input, await docxFixture());
      const cli = resolve(dirname(require.resolve("mammoth/package.json")), "bin/mammoth");
      const result = spawnSync(process.execPath, [cli, input, "--output-format=html"], {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("<p>Kossilon compatibility 公司文件</p>");
    } finally {
      rmSync(owned, { recursive: true, force: false });
    }
  });
});
