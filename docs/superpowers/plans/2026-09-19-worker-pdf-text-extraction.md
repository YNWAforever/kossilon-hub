# Worker-side PDF text extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the text layer and page count of scan-verified PDFs inside the Worker's analysis pass, store them in `document_version_texts`, and let `/operations` flag `document-text-extraction` once a deployed runtime has actually done it.

**Architecture:** One pure unit (`text-extraction.ts`, the only importer of `unpdf`) returns a three-way result. `drainDocumentAnalysisJobs` calls it through an injected `extractor` after the existing scan gate, upserts the result through an injected `texts` repository, and feeds the page count into the existing page-count cross-check in the same run. The blocker is reclassified from `external` to `runtime`, with a one-query check.

**Tech Stack:** TypeScript 5.8 strict (`noUnusedLocals`), `unpdf` 1.8.1 (already installed and saved exact in `package.json` on this branch), postgres.js raw SQL, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-19-worker-pdf-text-extraction-design.md`

---

## Before you start

- Branch: `codex/worker-pdf-text` (exists; the spec commit is on it). Never push to `main`.
- `unpdf@1.8.1` is already in `package.json` and `node_modules`, uncommitted; Task 2 commits `package.json` and `package-lock.json` with the extractor. Do **not** add any other dependency.
- A spike (2026-09-19) confirmed, in Node, with the options used below: English text, 3-page count, image-only → empty text with 1 page, encrypted → throws `PasswordException`, truncated → throws `InvalidPDFException`, Type0/Identity-H + ToUnicode Chinese → `周年申報表測試` verbatim.
- Typecheck: `npx tsc --noEmit`. Unit tests: `npx vitest run <path>`. Never pipe vitest into `| tail`.
- DB tests need `TEST_DATABASE_URL` and `DATABASE_SSL=disable`; never filter to `--project db` or run a single DB file alone (the group order hangs). Without a database they skip; CI runs them.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File map

| File                                                                | Responsibility                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Create `src/test/synthetic-pdf.ts`                                  | Test-only builder for tiny synthetic PDFs (no binary fixtures, no client documents)              |
| Create `src/features/documents/text-extraction.ts`                  | `extractPdfText`, `ExtractionResult`, `StoredExtraction`, constants. Only file importing `unpdf` |
| Create `src/features/documents/text-extraction.test.ts`             | Extractor behaviour against synthetic PDFs                                                       |
| Create `src/features/documents/text-extraction.convention.test.ts`  | Nothing else imports `unpdf`                                                                     |
| Modify `src/features/documents/analysis-repository.ts`              | `upsertText`                                                                                     |
| Modify `src/features/documents/repository.integration.test.ts`      | DB test for `upsertText`                                                                         |
| Modify `src/features/documents/analysis-worker.ts`                  | Call extractor, upsert, feed page count, record unreadable                                       |
| Modify `src/features/documents/analysis-worker.test.ts`             | Worker behaviour                                                                                 |
| Modify `src/server/maintenance.ts`                                  | Wire `extractor` and `texts`                                                                     |
| Modify `src/features/documents/analysis-checks.ts`                  | Comment only: the marker stays, the reason changes                                               |
| Modify `src/features/operations/capabilities.ts` (+ test)           | Reclassify to `runtime`, add check                                                               |
| Modify `src/features/operations/repository.ts` (+ integration test) | `textLayerObserved()`                                                                            |
| Modify `src/features/operations/server-fns.ts` (+ test)             | Pass `textLayerObserved`                                                                         |
| Modify spec + `docs/implementation/kossilon/status.md`              | Record what shipped                                                                              |

---

### Task 1: Synthetic PDF builder

**Files:**

- Create: `src/test/synthetic-pdf.ts`

Test support only. Exercised by Task 2's tests; it has no test of its own.

- [ ] **Step 1: Write the builder**

```ts
/**
 * Tiny synthetic PDFs for extraction tests.
 *
 * Built in code rather than committed as binaries so every fixture is reviewable
 * text, and so no client document can ever end up in the repository posing as
 * a fixture. Objects are numbered from 1 in array order; the xref offsets are
 * computed, so the files are well-formed rather than merely tolerated.
 */

function buildPdf(objects: string[], options: { encrypt?: boolean } = {}): ArrayBuffer {
  const all = [...objects];
  let trailerExtra = "";
  if (options.encrypt) {
    // Standard security handler with an O/U pair that matches no password, so
    // the empty user password fails and pdf.js raises PasswordException.
    all.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${"11".repeat(32)}> /U <${"22".repeat(32)}> >>`,
    );
    trailerExtra = ` /Encrypt ${all.length} 0 R /ID [<${"33".repeat(16)}> <${"33".repeat(16)}>]`;
  }

  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  all.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character written above is ASCII, so string offsets are byte offsets.
  return new TextEncoder().encode(out).buffer as ArrayBuffer;
}

const stream = (content: string) =>
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

/** Layout: 1 catalog, 2 page tree, then (page, contents) pairs, then fonts. */
function document(
  pages: string[],
  fonts: (firstFontObject: number) => string[],
  resources: (firstFontObject: number) => string,
): string[] {
  const firstFont = 3 + pages.length * 2;
  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
  ];
  for (const content of pages) {
    const self = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${self + 1} 0 R /Resources << ${resources(firstFont)} >> >>`,
    );
    objects.push(stream(content));
  }
  return [...objects, ...fonts(firstFont)];
}

const helvetica = () => ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
const fontResource = (font: number) => `/Font << /F1 ${font} 0 R >>`;
const line = (text: string) => `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;

export const ENGLISH_PHRASE = "Kossilon synthetic fixture annual return 2026";
export const CHINESE_PHRASE = "周年申報表測試";

export function englishPdf(text: string = ENGLISH_PHRASE): ArrayBuffer {
  return buildPdf(document([line(text)], helvetica, fontResource));
}

export function threePagePdf(): ArrayBuffer {
  return buildPdf(
    document([line("Page one"), line("Page two"), line("Page three")], helvetica, fontResource),
  );
}

/** One page with a filled rectangle and no text operators: what a scan looks like. */
export function imageOnlyPdf(): ArrayBuffer {
  return buildPdf(
    document(
      ["q 0 0 1 rg 72 600 100 100 re f Q"],
      () => [],
      () => "",
    ),
  );
}

export function encryptedPdf(): ArrayBuffer {
  return buildPdf(document([line("secret")], helvetica, fontResource), { encrypt: true });
}

/** The first 200 bytes of a valid PDF: header present, everything else gone. */
export function truncatedPdf(): ArrayBuffer {
  return englishPdf().slice(0, 200);
}

/**
 * Traditional Chinese through a Type0 / Identity-H font with a ToUnicode map.
 *
 * No glyph program is embedded: extraction needs only the map, and this is the
 * shape system-generated Chinese PDFs take. It proves the text comes back as
 * characters rather than as CIDs.
 */
export function chinesePdf(): ArrayBuffer {
  const codePoints = [...CHINESE_PHRASE].map((character) =>
    character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
  );
  const cid = (index: number) => (index + 1).toString(16).toUpperCase().padStart(4, "0");
  const bfchar = codePoints.map((codePoint, index) => `<${cid(index)}> <${codePoint}>`).join("\n");
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap " +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def " +
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def " +
    "1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
    `${codePoints.length} beginbfchar\n${bfchar}\nendbfchar\n` +
    "endcmap CMapName currentdict /CMap defineresource pop end end";
  const content = `BT /F1 12 Tf 72 720 Td <${codePoints.map((_, index) => cid(index)).join("")}> Tj ET`;
  const fonts = (font: number) => [
    `<< /Type /Font /Subtype /Type0 /BaseFont /KossilonCJK /Encoding /Identity-H /DescendantFonts [${font + 1} 0 R] /ToUnicode ${font + 2} 0 R >>`,
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KossilonCJK /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity >>",
    stream(cmap),
  ];
  return buildPdf(document([content], fonts, fontResource));
}

/** Real PNG magic followed by filler: sniffed as an image, never parsed. */
export function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/test/synthetic-pdf.ts
git commit -m "test: synthetic PDF builder for extraction tests"
```

---

### Task 2: The extractor

**Files:**

- Create: `src/features/documents/text-extraction.ts`
- Test: `src/features/documents/text-extraction.test.ts`
- Commit also: `package.json`, `package-lock.json` (the `unpdf` addition)

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHINESE_PHRASE,
  ENGLISH_PHRASE,
  chinesePdf,
  encryptedPdf,
  englishPdf,
  imageOnlyPdf,
  pngBytes,
  threePagePdf,
  truncatedPdf,
} from "@/test/synthetic-pdf";
import { MAX_EXTRACTED_CHARS, extractPdfText } from "./text-extraction";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractPdfText", () => {
  it("reads the text layer and page count of a digital PDF", async () => {
    const result = await extractPdfText({ body: englishPdf(), contentType: "application/pdf" });

    expect(result).toEqual({
      method: "text-layer",
      text: ENGLISH_PHRASE,
      pageCount: 1,
      truncated: false,
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

    expect(result).toMatchObject({ method: "text-layer", pageCount: 3 });
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
    const long = "A".repeat(MAX_EXTRACTED_CHARS + 50);
    const result = await extractPdfText({ body: englishPdf(long), contentType: "application/pdf" });

    expect(result.method).toBe("text-layer");
    if (result.method !== "text-layer") return;
    expect(result.text).toHaveLength(MAX_EXTRACTED_CHARS);
    expect(result.truncated).toBe(true);
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
    expect(result.text).not.toContain(" ");
    expect(result.text).toContain("before");
    expect(result.text).toContain("after");
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
```

Note on the NUL test: `"before\\000after"` in TS source is the PDF string escape `\000` (octal NUL) inside the content stream, so the text layer genuinely contains a NUL. If pdf.js already drops it on its own, the test still passes and still pins the behaviour; verify with a temporary `console.log(JSON.stringify(result))` that the fixture is what you think, then remove the log.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/documents/text-extraction.test.ts`
Expected: FAIL — cannot resolve `./text-extraction`.

- [ ] **Step 3: Implement**

```ts
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
      const clean = text.replaceAll(" ", "").trim();
      if (clean.length === 0) return { method: "none", pageCount: totalPages };

      const truncated = clean.length > MAX_EXTRACTED_CHARS;
      return {
        method: "text-layer",
        text: truncated ? clean.slice(0, MAX_EXTRACTED_CHARS) : clean,
        pageCount: totalPages,
        truncated,
      };
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    return { method: "unreadable", errorClass: errorClassOf(error) };
  }
}
```

If `noUnusedLocals`/`noUnusedParameters` complains about `contentType`, that is a destructuring issue only — the function reads `input.body`, and `input` is used, so it should not; do not remove the field from the type.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/documents/text-extraction.test.ts`
Expected: 12 passed. If the encrypted or truncated case reports a different class name, print `result` and use the name pdf.js actually reports. Do not loosen the assertion to `expect.any(String)`: the point is that the class is recorded.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add package.json package-lock.json src/features/documents/text-extraction.ts src/features/documents/text-extraction.test.ts
git commit -m "feat: extract the text layer of a PDF inside the Worker"
```

(If `bun.lock` also changed, leave it unstaged and mention it in the report; `npm install` was used.)

---

### Task 3: Only one file may import `unpdf`

**Files:**

- Create: `src/features/documents/text-extraction.convention.test.ts`

- [ ] **Step 1: Write the test**

```ts
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
const UNPDF_IMPORT = /from\s+["']unpdf["']|import\(\s*["']unpdf["']\s*\)/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("unpdf import boundary", () => {
  it("is imported by text-extraction.ts and nothing else", () => {
    const importers = sourceFiles(SRC)
      .filter((path) => UNPDF_IMPORT.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"));

    expect(importers).toEqual(["src/features/documents/text-extraction.ts"]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/documents/text-extraction.convention.test.ts` → PASS.

- [ ] **Step 3: Mutation-check it**

Temporarily add `import "unpdf";` as the first line of `src/features/documents/analysis-worker.ts`. Note the regex above does not match a bare `import "unpdf";` — so instead add `import { extractText } from "unpdf"; void extractText;` and re-run: expected FAIL listing both files. Remove it, re-run: PASS. Then decide whether a bare side-effect import should also be caught; if yes, extend the regex to `/from\s+["']unpdf["']|import\s*\(?\s*["']unpdf["']/`, re-run both the mutation and the clean state. Record the outcomes in the commit body.

- [ ] **Step 4: Commit**

```bash
git add src/features/documents/text-extraction.convention.test.ts
git commit -m "test: keep pdf.js behind the one extraction function"
```

---

### Task 4: `upsertText` on the analysis repository

**Files:**

- Modify: `src/features/documents/analysis-repository.ts` (type at ~line 94; implementation after `replaceUnresolvedForVersion`; comment in `loadForAnalysis` at ~line 156)
- Test: `src/features/documents/repository.integration.test.ts` (append inside the last `describe.skipIf(!databaseUrl)` block, before the file's final `});`)

- [ ] **Step 1: Write the failing DB test**

Add the import at the top of the integration test file:

```ts
import { createDocumentAnalysisRepository } from "./analysis-repository";
```

Append this test inside the last `describe.skipIf(!databaseUrl)` block. It reuses that file's existing `sqlForTests`, `fixture`, `intentInput`, `createDocumentRepository` and `INTEGRATION_TEST_TIMEOUT_MS`; the text row goes with the file's existing teardown through `on delete cascade` from `document_versions`.

```ts
it(
  "stores an extraction and replaces it on a re-run",
  async () => {
    const sql = sqlForTests();
    const repository = createDocumentRepository({ sql });
    const analysis = createDocumentAnalysisRepository({ sql });
    const data = await fixture(sql);

    const intent = await repository.createUploadIntent(intentInput(data));
    const document = await repository.finalizeUploadIntent({
      intentId: intent.id,
      uploadedBy: null,
      source: "client",
    });
    const [version] = await sql<{ id: string }[]>`
        select id from document_versions where document_id = ${document.id}`;

    await analysis.upsertText(version.id, {
      method: "none",
      pageCount: 2,
      extractorVersion: "1",
    });
    await analysis.upsertText(version.id, {
      method: "text-layer",
      text: "周年申報表",
      pageCount: 3,
      truncated: true,
      extractorVersion: "1",
    });

    const rows = await sql<
      {
        extracted_text: string | null;
        page_count: number | null;
        extraction_method: string;
        truncated: boolean;
        extractor_version: string;
      }[]
    >`
        select extracted_text, page_count, extraction_method, truncated, extractor_version
        from document_version_texts where document_version_id = ${version.id}`;

    expect(rows).toEqual([
      {
        extracted_text: "周年申報表",
        page_count: 3,
        extraction_method: "text-layer",
        truncated: true,
        extractor_version: "1",
      },
    ]);

    // And what the analysis pass reads back is the value just written.
    const subject = await analysis.loadForAnalysis(version.id);
    expect(subject?.knownPageCount).toBe(3);
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

Before writing it, confirm that the last `describe` in that file has `fixture`, `intentInput` and `createDocumentRepository` in scope (they are used by the tests at ~lines 815–870). If `createDocumentAnalysisRepository({ sql })` does not accept a transaction-less client of that type, match the call used in `documents/analysis-*.test.ts` or other integration tests.

- [ ] **Step 2: Typecheck to verify failure**

Run: `npx tsc --noEmit`
Expected: FAIL — `Property 'upsertText' does not exist on type 'DocumentAnalysisRepository'`.

- [ ] **Step 3: Implement**

In `analysis-repository.ts`, add to the imports:

```ts
import type { StoredExtraction } from "./text-extraction";
```

Add to the `DocumentAnalysisRepository` type, directly after `replaceUnresolvedForVersion`:

```ts
  /**
   * Records what extraction found for this version, replacing any earlier run.
   *
   * Its own table, never the version row: a pass that could write the version
   * row could write its storage key or checksum with it (see migration 0027).
   */
  upsertText(documentVersionId: string, extraction: StoredExtraction): Promise<void>;
```

Add to the returned object, directly after `replaceUnresolvedForVersion`:

```ts
    async upsertText(documentVersionId, extraction) {
      const text = extraction.method === "text-layer" ? extraction.text : null;
      const truncated = extraction.method === "text-layer" ? extraction.truncated : false;
      await sql`
        insert into document_version_texts (
          document_version_id, extracted_text, page_count, extraction_method,
          truncated, extractor_version, extracted_at
        ) values (
          ${documentVersionId}, ${text}, ${extraction.pageCount}, ${extraction.method},
          ${truncated}, ${extraction.extractorVersion}, now()
        )
        on conflict (document_version_id) do update set
          extracted_text = excluded.extracted_text,
          page_count = excluded.page_count,
          extraction_method = excluded.extraction_method,
          truncated = excluded.truncated,
          extractor_version = excluded.extractor_version,
          extracted_at = excluded.extracted_at
      `;
    },
```

Correct the now-stale comment in `loadForAnalysis`:

```sql
        -- Left joins: a staff- or system-created document has no upload intent,
        -- and a version nobody has extracted yet has no text row.
```

- [ ] **Step 4: Typecheck, and run the DB suite if a database is available**

Run: `npx tsc --noEmit` → exit 0. (This will also fail on `maintenance.ts` only if the worker type changed — it has not yet; if it does fail, read the error before proceeding.)
If `TEST_DATABASE_URL` is set: `DATABASE_SSL=disable npx vitest run` (the full suite, never one DB file alone) → the new test passes. If it is not set, the test skips locally and CI runs it; say exactly that in the report rather than claiming it passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/documents/analysis-repository.ts src/features/documents/repository.integration.test.ts
git commit -m "feat: record a version's extracted text and page count"
```

---

### Task 5: Extraction inside the analysis pass

**Files:**

- Modify: `src/features/documents/analysis-worker.ts`
- Test: `src/features/documents/analysis-worker.test.ts`

- [ ] **Step 1: Extend the harness and write the failing tests**

In `analysis-worker.test.ts`, add to the imports:

```ts
import type { ExtractionResult, StoredExtraction } from "./text-extraction";
```

Add to `HarnessOptions`:

```ts
  extraction?: ExtractionResult;
  extractorThrows?: boolean;
  textsThrow?: boolean;
```

Inside `harness`, before `const dependencies`, add:

```ts
const storedTexts: { documentVersionId: string; extraction: StoredExtraction }[] = [];
const extract = vi.fn(async (): Promise<ExtractionResult> => {
  if (options.extractorThrows) throw new Error("pdf.js exploded");
  return options.extraction ?? { method: "none", pageCount: null };
});
```

Add to the `dependencies` object, after `analyzer`:

```ts
    extractor: { extract },
    texts: {
      upsertText: vi.fn(async (documentVersionId: string, extraction: StoredExtraction) => {
        if (options.textsThrow) throw new Error("write failed");
        storedTexts.push({ documentVersionId, extraction });
      }),
    },
```

Change the harness return to `return { dependencies, written, jobs, storageGet, extract, storedTexts };`.

Append at the end of the file:

```ts
describe("text extraction in the analysis pass", () => {
  /** The scan gate is the whole safety argument for parsing client PDFs. */
  it("never hands an unverified document to the extractor", async () => {
    const test = harness({ subject: subject({ scanVerdictSource: null }) });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(test.extract).not.toHaveBeenCalled();
  });

  it("stores what it extracted against the version", async () => {
    const test = harness({
      extraction: { method: "text-layer", text: "hello", pageCount: 2, truncated: false },
    });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(test.storedTexts).toEqual([
      {
        documentVersionId: VERSION_ID,
        extraction: {
          method: "text-layer",
          text: "hello",
          pageCount: 2,
          truncated: false,
          extractorVersion: "1",
        },
      },
    ]);
  });

  /**
   * The payoff inside the same run: a page count just counted turns the
   * cited-pages rule from `uncertain` into a real verdict, without waiting for
   * a second run to read the row back.
   */
  it("checks cited pages against the page count it just counted", async () => {
    const test = harness({
      subject: subject({
        knownPageCount: null,
        pageClaims: [{ requirementInstanceId: "req-1", pageFrom: 3, pageTo: 4 }],
      }),
      extraction: { method: "text-layer", text: "hello", pageCount: 2, truncated: false },
    });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    const cited = test.written[0].filter((finding) => finding.ruleKey === "cited-pages-exist");
    expect(cited).toHaveLength(1);
    expect(cited[0].outcome).not.toBe("uncertain");
  });

  it("records an unreadable document as uncertain and stores no text", async () => {
    const test = harness({ extraction: { method: "unreadable", errorClass: "PasswordException" } });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.analysed).toBe(1);
    expect(test.storedTexts).toEqual([]);
    const notes = test.written[0].filter((finding) => finding.ruleKey === "extraction:text-layer");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ outcome: "uncertain", tier: "classification" });
    expect(notes[0].detail).toContain("PasswordException");
  });

  /**
   * Same rule as the model tier: a throw must not unwind the loop and strand
   * every job claimed after this one in `processing`.
   */
  it("keeps draining when the extractor throws", async () => {
    const test = harness({
      claimed: [job({ id: "job-1" }), job({ id: "job-2" })],
      extractorThrows: true,
    });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.analysed).toBe(2);
    expect(
      test.written.flat().filter((finding) => finding.ruleKey === "extraction:text-layer"),
    ).toHaveLength(2);
  });

  it("retries the job when the text cannot be written", async () => {
    const test = harness({ extraction: { method: "none", pageCount: 1 }, textsThrow: true });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.retried).toBe(1);
    expect(test.jobs.markRetry).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ errorCode: "texts-not-written" }),
    );
    expect(test.written).toEqual([]);
  });
});
```

Before relying on them, confirm against the file: `documentSafetyOf({ uploadStatus: "available", scanVerdictSource: null })` is not `verified` (check `safety.ts`; if it is, use the status/source pair an existing "awaiting scan" test in this file uses), and `cited-pages-exist` is the rule key (it is, `analysis-checks.ts` ~line 274). Adjust only names, never assertions.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/documents/analysis-worker.test.ts`
Expected: FAIL (the new tests; `extractor`/`texts` unknown to the type).

- [ ] **Step 3: Implement in `analysis-worker.ts`**

Add to the imports:

```ts
import { EXTRACTOR_VERSION, type ExtractionResult, type StoredExtraction } from "./text-extraction";
```

Update the `knownPageCount` doc comment in `AnalysisSubject`:

```ts
/** From document_version_texts; null until an extraction has counted pages. */
knownPageCount: number | null;
```

Add to `AnalysisWorkerDependencies`, after `analyzer`:

```ts
  /**
   * Reads a PDF's text layer. Injected, like the analyzer, so the pass can be
   * tested without pdf.js and so a failure is the pass's to contain.
   */
  extractor: {
    extract(input: { body: ArrayBuffer; contentType: string | null }): Promise<ExtractionResult>;
  };
  texts: { upsertText(documentVersionId: string, extraction: StoredExtraction): Promise<void> };
```

Add a helper next to `providerNote`:

```ts
function extractionNote(documentVersionId: string, errorClass: string): Finding {
  return makeFinding({
    ruleKey: "extraction:text-layer",
    ruleVersion: EXTRACTOR_VERSION,
    tier: "classification",
    outcome: "uncertain",
    severity: "info",
    detail: `The document's text could not be read (${errorClass}), so no check that needs its words could run.`,
    citation: { kind: "version", documentVersionId, pageFrom: null, pageTo: null },
  });
}
```

In `drainDocumentAnalysisJobs`, replace the block from `const { head, tail } = sampleOf(stored.body);` through the closing `];` of the `findings` array with:

```ts
// Wrapped for the same reason the model tier is: a throw would unwind this
// loop and strand every job claimed after this one.
let extraction: ExtractionResult;
try {
  extraction = await dependencies.extractor.extract({
    body: stored.body,
    contentType: subject.declaredContentType,
  });
} catch {
  extraction = { method: "unreadable", errorClass: "extractor-threw" };
}

// What this run counted beats what was loaded: the loaded value is from an
// earlier run, or null because there was none.
let knownPageCount = subject.knownPageCount;
if (extraction.method !== "unreadable") {
  try {
    await dependencies.texts.upsertText(subject.version.id, {
      ...extraction,
      extractorVersion: EXTRACTOR_VERSION,
    });
  } catch {
    const applied = await dependencies.jobs.markRetry(job.id, {
      ...fence,
      errorCode: "texts-not-written",
      errorMessage: "The extracted text for this run could not be recorded.",
    });
    if (applied) summary.retried += 1;
    else summary.superseded += 1;
    continue;
  }
  knownPageCount = extraction.pageCount;
}

const { head, tail } = sampleOf(stored.body);
const findings: Finding[] = [
  ...readabilityFindings(subject.version, {
    declaredContentType: subject.declaredContentType,
    byteSize: stored.body.byteLength,
    head,
    tail,
  }),
  ...crossCheckFindings({
    version: subject.version,
    knownPageCount,
    declaredByteSize: subject.declaredByteSize,
    verifiedByteSize: subject.verifiedByteSize,
    pageClaims: subject.pageClaims,
  }),
  ...(extraction.method === "unreadable"
    ? [extractionNote(subject.version.id, extraction.errorClass)]
    : []),
];
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/documents/analysis-worker.test.ts`
Expected: every test passes, old and new. The default stub returns `{ method: "none", pageCount: null }`, which overrides a loaded page count with null. If a pre-existing test set `knownPageCount` on the subject and now fails for that reason, give that test `extraction: { method: "text-layer", text: "x", pageCount: <same number>, truncated: false }` — that is what a real run would do — and name the test in the report. Do not change the override rule to make it pass.

- [ ] **Step 5: Continue straight to Task 6**

`npx tsc --noEmit` now fails in `src/server/maintenance.ts` (missing `extractor`/`texts`). Do not commit a tree that does not typecheck; Task 6 fixes it and commits both.

---

### Task 6: Wire it into the maintenance tick

**Files:**

- Modify: `src/server/maintenance.ts` (`createAnalysisWorker`, ~line 474)

- [ ] **Step 1: Wire the dependencies**

Add to the imports, next to `createDocumentAiAnalyzerForProviderMode`:

```ts
import { extractPdfText } from "@/features/documents/text-extraction";
```

In the object returned by `createAnalysisWorker`, after `analyzer,`:

```ts
        // Not provider-gated: extraction is local work in every mode, and the
        // scan gate inside the pass decides which bytes ever reach it.
        extractor: { extract: extractPdfText },
        texts: analysis,
```

- [ ] **Step 2: Typecheck and run the affected suites**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run src/features/documents src/server` → all pass. If any `maintenance` test builds an analysis worker object literal, it will need `extractor` and `texts` too; add stubs of the same shape as Task 5's harness.

- [ ] **Step 3: Commit Tasks 5 and 6 together**

```bash
git add src/features/documents/analysis-worker.ts src/features/documents/analysis-worker.test.ts src/server
git commit -m "feat: extract text in the analysis pass and check cited pages against it"
```

---

### Task 7: Reclassify the blocker with a runtime check

**Files:**

- Modify: `src/features/operations/capabilities.ts` (entry ~line 94; `RUNTIME_EVIDENCE` ~line 180; `staleBlockedIntegrations` ~line 201)
- Modify: `src/features/operations/capabilities.test.ts`
- Modify: `src/features/operations/repository.ts` (+ `repository.integration.test.ts`)
- Modify: `src/features/operations/server-fns.ts` (+ `server-fns.test.ts`)
- Modify: `src/features/documents/analysis-checks.ts` (header comment only)

- [ ] **Step 1: Write the failing capability tests**

In `capabilities.test.ts`, every existing `staleBlockedIntegrations({...})` call gains `textLayerObserved: false`. Then append inside the `describe("staleBlockedIntegrations", ...)` block:

```ts
describe("document-text-extraction", () => {
  const extraction = entry({ id: "document-text-extraction", blocksRelease: false });

  it("stays quiet until a deployed runtime has written a text-layer row", () => {
    expect(
      staleBlockedIntegrations({
        blocked: [extraction],
        maintenanceState: "healthy",
        textLayerObserved: false,
      }),
    ).toEqual([]);
  });

  it("flags the entry once one has", () => {
    expect(
      staleBlockedIntegrations({
        blocked: [extraction],
        maintenanceState: "never-observed",
        textLayerObserved: true,
      }),
    ).toEqual(["document-text-extraction"]);
  });
});

it("declares document-text-extraction as runtime evidence", () => {
  const declared = BLOCKED_INTEGRATIONS.find((item) => item.id === "document-text-extraction");
  expect(declared?.evidence).toEqual({ observable: "runtime" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/operations/capabilities.test.ts`
Expected: FAIL (type error on `textLayerObserved`; the entry is still `external`).

- [ ] **Step 3: Implement in `capabilities.ts`**

Replace the `document-text-extraction` entry with:

```ts
  {
    id: "document-text-extraction",
    capability: "讀取文件內文（頁數、日期、年度、內容比對）",
    effect:
      "伺服器端的 PDF 文字層擷取已寫好，但尚未在部署環境中執行過；它只處理已通過真正惡意軟件掃描的文件，" +
      "因此在掃描供應商到位前實際上不會擷取任何內容。掃描檔與相片沒有文字層，仍然讀不到。" +
      "目前沒有任何規則讀取文件文字，包括兩條日期規則。",
    pilotFallback: "文件內容仍由職員親自閱讀核對，一如現時做法。",
    clearedBy:
      "部署環境寫入的第一筆 extraction_method 為 text-layer 的 document_version_texts 記錄。" +
      "程式通過測試不算數：測試在 Node 執行，只有 Worker 上的真實執行才證明它可用。",
    blocksRelease: false,
    evidence: { observable: "runtime" },
  },
```

Replace the `RUNTIME_EVIDENCE` declaration with:

```ts
/** What the runtime checks may look at: already on the screen, or one query away. */
export type RuntimeEvidence = {
  maintenanceState: MaintenanceHealthState;
  /** Whether any version has a `text-layer` extraction recorded. */
  textLayerObserved: boolean;
};

const RUNTIME_EVIDENCE: Partial<Record<BlockedIntegrationId, (input: RuntimeEvidence) => boolean>> =
  {
    // `never-observed` is the absence of any scheduled run at all, so every other
    // state IS the evidence this blocker names. No extra query: the operations
    // screen already computes this state.
    "deployment-runtime": ({ maintenanceState }) => maintenanceState !== "never-observed",
    // A text-layer row can only be written by the analysis pass running `unpdf`
    // for real. Tests run in Node and prove nothing about workerd.
    "document-text-extraction": ({ textLayerObserved }) => textLayerObserved,
  };
```

Change the `staleBlockedIntegrations` signature (body unchanged):

```ts
export function staleBlockedIntegrations(
  input: { blocked: readonly BlockedIntegration[] } & RuntimeEvidence,
): readonly BlockedIntegrationId[] {
```

In `analysis-checks.ts`, replace the header comment (lines 4–18) so the marker stays and the reason is current:

```ts
/**
 * The two deterministic tiers, and only what they can honestly compute.
 *
 * Text extraction now exists (`text-extraction.ts`, run by the analysis pass on
 * scan-verified PDFs) and supplies the page count used below. It has not yet
 * run on a deployed Worker, and under the scanner blocker it reaches no
 * document, so BLOCKED_INTEGRATION: document-text-extraction stands until
 * /operations shows a real text-layer row. No rule here reads a document's
 * words; the two date rules are a separate design. What is here is still worth
 * having: whether the file will open at all, and whether the records about it
 * agree with each other.
 */
```

- [ ] **Step 4: Run capability tests**

Run: `npx vitest run src/features/operations/capabilities.test.ts`
Expected: PASS, including the existing exhaustiveness guard (the new runtime entry has a check), the reverse guard, and the marker cross-check (the marker is still in `analysis-checks.ts` and the other files that carry it).

- [ ] **Step 5: Add `textLayerObserved()` to the operations repository**

In `repository.ts`, add to the `MaintenanceRunRepository` type after `schemaLedger`:

```ts
  /**
   * Whether the analysis pass has ever recorded a text-layer extraction: the
   * runtime evidence for `document-text-extraction` (see capabilities.ts).
   */
  textLayerObserved(): Promise<boolean>;
```

And to the returned object after `schemaLedger`:

```ts
    async textLayerObserved() {
      const [row] = await sql<{ observed: boolean }[]>`
        select exists(
          select 1 from document_version_texts where extraction_method = 'text-layer'
        ) observed
      `;
      return row?.observed === true;
    },
```

Append to `repository.integration.test.ts`, inside `describe.skipIf(!databaseUrl)("maintenance run repository", ...)`, matching how the other tests in that block construct the repository:

```ts
it("answers whether a text-layer extraction exists", async () => {
  const repository = createMaintenanceRunRepository({ sql: sqlForTests() });

  await expect(repository.textLayerObserved()).resolves.toEqual(expect.any(Boolean));
});
```

It asserts that the query runs against the real schema, not its value: another suite may have written a text row. Do not insert rows from this file.

- [ ] **Step 6: Pass it through `server-fns.ts`**

Add `| "textLayerObserved"` to both `Pick<MaintenanceRunRepository, ...>` unions (in `buildOperationsHealth` and `readOperationsState`). In `readOperationsState`, replace the `Promise.all` with:

```ts
const [recentRuns, scheduledRuns, lastScheduledSuccessAt, queues, textLayerObserved] =
  await Promise.all([
    dependencies.repository.listRecentRuns(RECENT_RUN_LIMIT),
    // Judged separately from what the table displays: a window full of manual
    // runs would leave the health rule nothing to judge the schedule by.
    dependencies.repository.listRecentScheduledRuns(RECENT_RUN_LIMIT),
    dependencies.repository.lastScheduledSuccessAt(),
    dependencies.repository.queueDepths(input.now),
    dependencies.repository.textLayerObserved(),
  ]);
```

and pass `textLayerObserved` into the `staleBlockedIntegrations({...})` call. The degraded path already returns `staleBlockers: []`, which is right when the table may not exist.

In `server-fns.test.ts`, add to the `repository()` helper's returned object:

```ts
    textLayerObserved: vi.fn(async () => false),
```

and append inside `describe("buildOperationsHealth", ...)`:

```ts
it("flags text extraction once a text-layer row exists", async () => {
  const repo = repository([]);
  repo.textLayerObserved.mockResolvedValue(true);

  const view = await buildOperationsHealth({ now: NOW }, { repository: repo });

  expect(view.staleBlockers).toContain("document-text-extraction");
});
```

- [ ] **Step 7: Typecheck and run everything touched**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run src/features/operations src/features/documents src/server src/routes` → all pass.

- [ ] **Step 8: Mutation-check the guard**

Temporarily delete the `"document-text-extraction"` key from `RUNTIME_EVIDENCE`; run `npx vitest run src/features/operations/capabilities.test.ts` → expected FAIL in "has an evidence check for every runtime-kind entry". Restore → PASS. Record both in the commit body.

- [ ] **Step 9: Commit**

```bash
git add src/features/operations src/features/documents/analysis-checks.ts
git commit -m "feat: flag text extraction on /operations once a deployed runtime has done it"
```

---

### Task 8: Full verification and docs

**Files:**

- Modify: `docs/superpowers/specs/2026-09-19-worker-pdf-text-extraction-design.md`
- Modify: `docs/implementation/kossilon/status.md`

- [ ] **Step 1: Full suite, build and lint**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run` (with `TEST_DATABASE_URL` and `DATABASE_SSL=disable` if a local database is available) → record the file and test counts exactly as printed, including how many skipped.
Run: `npm run build` → must succeed. Then find the built server/worker chunk containing `unpdf`'s code and check it does not contain a module-scope `new DOMMatrix(` (that would mean the browser `pdfjs-dist` build leaked into the server bundle). Report what you found either way.
Run: `npm run lint` → no new errors in touched files.

- [ ] **Step 2: Update the spec to what shipped**

In the spec:

- Status line → `**Status:** implemented on \`codex/worker-pdf-text\``.
- Testing, fixture paragraph → "Fixtures are generated in code by `src/test/synthetic-pdf.ts`: reviewable text, never binaries, never client documents."
- Component 3, `textLayerObserved: boolean | null` → `textLayerObserved: boolean`, with the sentence: "The only way for it to be unknown is a failed operations read, and that path already reports no stale blockers."
- Testing, Build bullet → "Build: `npm run build` succeeds with `unpdf` in the server bundle, and a convention test keeps `unpdf` imported by `text-extraction.ts` alone."
- Add under Component 1: "NUL characters are stripped: Postgres `text` refuses them, and a PDF text layer can contain one."

- [ ] **Step 3: Update `status.md`**

In the "Since #59" list, add:

```markdown
- **Worker PDF text extraction** (`codex/worker-pdf-text`). The analysis pass
  reads the text layer and page count of scan-verified PDFs with `unpdf` and
  stores them in `document_version_texts`; the cited-pages check uses that count
  in the same run. `document-text-extraction` is now `runtime` evidence: it
  stands until a deployed Worker writes the first `text-layer` row. Under the
  scanner blocker no document reaches it yet. No rule reads the text; the two
  date rules are a separate design.
```

In the Open blockers table, replace the `document-text-extraction` row's Effect and Cleared-by cells with the English meaning of the new `effect` and `clearedBy` in `capabilities.ts`.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write docs/superpowers/specs/2026-09-19-worker-pdf-text-extraction-design.md docs/implementation/kossilon/status.md
git add docs
git commit -m "docs: record Worker PDF text extraction as built"
```

---

## Self-review (done while writing)

- **Spec coverage:** extractor (T2); no network fetch (T2); never throws (T2); NUL stripping (T2, found in the spike, added to the spec in T8); scan gate kept (T5 test); placement and same-run page-count override (T5); unreadable → uncertain finding, no row (T5); failed upsert → retry (T5); wiring (T6); reclassification, runtime check and both guards (T7); fixtures (T1); repository upsert DB test (T4); build (T8); non-goals untouched.
- **Deviations from the spec, recorded in T8:** fixtures in code, not committed binaries; `textLayerObserved` is `boolean`; build is a verification step plus an import-boundary test rather than a bundle-inspecting unit test.
- **Type names:** `ExtractionResult`, `StoredExtraction`, `EXTRACTOR_VERSION`, `MAX_EXTRACTED_CHARS` are defined in T2 and used with the same names in T4–T6. `upsertText(documentVersionId, extraction)` has the same signature in T4 (repository) and T5 (worker dependency), which is why T6 can pass `analysis` as `texts`. `RuntimeEvidence` is defined and consumed in T7.
