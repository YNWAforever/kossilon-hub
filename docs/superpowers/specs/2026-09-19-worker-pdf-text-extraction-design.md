# Worker-side PDF text extraction

**Date:** 2026-09-19
**Status:** implemented on `codex/worker-pdf-text`
**Retires (eventually):** `BLOCKED_INTEGRATION: document-text-extraction`

## Why this, and why now

Every blocker except this one needs a provider, a contract or somebody else's
protocol. This one names "a Worker-safe PDF text layer (new work)" as a way to
clear it, and new work is the one thing that can be done without anyone else.

The firm's corpus is **mostly digitally generated PDFs** (e-statements,
system-generated letters, government e-forms), so a text layer covers most of
what arrives. Scans and photos need OCR, which is out of scope here.

## What already exists

- `document_version_texts` (migration `0027`) with `extracted_text`,
  `page_count`, `extraction_method in ('text-layer','ocr','provider','none')`,
  `truncated`, `extractor_version`. **No migration is needed.** `'none'` already
  means "opened, no text layer", which is distinct from "not extracted yet"
  (no row).
- `AnalysisSubject.knownPageCount` is read from that table and feeds
  `crossCheckFindings`, whose page-count rule sits permanently at `uncertain`
  because nothing writes a page count.
- `drainDocumentAnalysisJobs` already reads the full stored object after the
  scan gate, and already treats an advisory tier's failure as a finding rather
  than a job failure.

## Decisions

| Question                       | Decision                                               | Why                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library                        | `unpdf` (serverless build of pdf.js)                   | Runs in workerd without `DOMMatrix`; keeps pdf.js font handling, including ToUnicode/CMaps, which Chinese text depends on. New dependency approved by the user 2026-09-19 |
| Rejected: `pdfjs-dist` + shims | —                                                      | Hand-patched browser globals break silently on upgrade                                                                                                                    |
| Rejected: hand-written parser  | —                                                      | Produces wrong text for CJK and most embedded fonts; wrong text presented as extracted is worse than none                                                                 |
| Rejected: `nodejs_compat`      | —                                                      | Changes the whole Worker's runtime surface to serve one feature                                                                                                           |
| Scan gate                      | **Kept.** Extraction only runs on `verified` documents | Parsing untrusted PDFs is the exposure the gate exists for. Consequence stated plainly below                                                                              |
| Images                         | Not parsed; returned as `none`                         | OCR is a separate problem                                                                                                                                                 |
| Date rules                     | **Out of scope**                                       | Date parsing from bilingual free text is its own design, and depends on the open three-month clamp decision                                                               |

## Components

### 1. `src/features/documents/text-extraction.ts`

One pure unit. The only file that imports `unpdf`.

```ts
export const EXTRACTOR_VERSION = "1";
export const MAX_EXTRACTED_CHARS = 200_000;

export type ExtractionResult =
  | { method: "text-layer"; text: string; pageCount: number; truncated: boolean }
  /** Opened, no text on any page (a scan), or not a PDF at all. */
  | { method: "none"; pageCount: number | null }
  /** Encrypted or corrupt. `errorClass` only, never the message. */
  | { method: "unreadable"; errorClass: string };

export function extractPdfText(input: {
  body: ArrayBuffer;
  contentType: string | null;
}): Promise<ExtractionResult>;
```

- Non-PDF (by sniffed magic bytes, via `sniffContentType`, not the declared
  type) → `{ method: "none", pageCount: null }` without parsing.
- Whitespace-only text across all pages → `none` with the real page count.
- Text longer than `MAX_EXTRACTED_CHARS` is cut and `truncated: true`.
- No network fetches. pdf.js can fetch external CMaps and standard fonts for
  CJK text whose font is not embedded; the extractor disables that, so such a
  document yields `none` or partial text rather than a request to a CDN from
  the Worker. Embedded fonts with a ToUnicode map (the common case for
  generated PDFs) need nothing external. As built, `standardFontDataUrl` and
  `cMapUrl` are passed as `undefined` explicitly: `unpdf` fills both with local
  `pdfjs-dist` paths whenever it believes it is in Node, and caller options are
  spread after its defaults, so an explicit `undefined` is what disables them.
- NUL characters are stripped: Postgres `text` refuses them, and a PDF text
  layer can contain one.
- Teardown uses `loadingTask.destroy()`. `PDFDocumentProxy.destroy()` does not
  exist in pdf.js 6.
- Never throws: any library error becomes `unreadable` with the error's class
  name. The message is dropped, same rule as `failure_summary`.

### 2. Placement in `drainDocumentAnalysisJobs`

Two new injected dependencies, mirroring `analyzer`:

```ts
extractor: { extract(input: { body: ArrayBuffer; contentType: string | null }): Promise<ExtractionResult> };
texts: { upsert(documentVersionId: string, result: StoredExtraction): Promise<void> };
```

`StoredExtraction` is the `text-layer` / `none` half of `ExtractionResult` plus
`extractorVersion`.

After the scan gate and the storage read, before the checks:

1. Call the extractor, wrapped in try/catch (a throw is treated as
   `unreadable`, `errorClass: "extractor-threw"`), so it cannot unwind the drain.
2. `text-layer` / `none` → upsert into `document_version_texts`, then use the
   page count as `knownPageCount` for this run's cross-checks, overriding the
   stale value loaded with the subject.
3. `unreadable` → no row written (the version has not been extracted), plus an
   `uncertain` finding `extraction:text-layer` saying the text could not be read
   and why (class only).
4. A failed upsert → the job retries (`texts-not-written`), same as a failed
   findings write.

### 3. The blocker: reclassified, not removed

Code existing is not evidence. Vitest runs in Node; only a deployed runtime
proves `unpdf` runs in workerd. So in `capabilities.ts`:

- `document-text-extraction` evidence becomes `{ observable: "runtime" }`.
- `clearedBy` becomes: the first `document_version_texts` row with
  `extraction_method = 'text-layer'` written on the deployed runtime.
- `staleBlockedIntegrations` input gains `textLayerObserved: boolean`, read by
  one `select exists(...)` in the operations repository. The only way for it to
  be unknown is a failed operations read, and that path already reports no
  stale blockers.
- The #63 exhaustiveness guards require this runtime check to exist; the
  reverse guard requires the entry to still claim `runtime`.

### Consequence, stated plainly

Under `BLOCKED_INTEGRATION: malware-scanner-provider` no document reaches
`verified`, so **this extracts nothing in practice until a scanner exists.** It
is complete, tested and ready to deploy; it waits on the same gate every other
analysis tier waits on. The blocker therefore stays on `/operations` until both
a scanner and a deployment exist, and the runtime check is what will say so.

## Testing

Fixtures are generated in code by `src/test/synthetic-pdf.ts`: reviewable text,
never binaries, never client documents.

| Fixture                                            | Asserts                                            |
| -------------------------------------------------- | -------------------------------------------------- |
| English digital, 1 page                            | `text-layer`, known phrase present, `pageCount: 1` |
| Chinese digital (embedded CJK font with ToUnicode) | known Traditional Chinese phrase present verbatim  |
| Three pages                                        | `pageCount: 3`                                     |
| Image-only PDF                                     | `none`, `pageCount: 1`                             |
| Encrypted                                          | `unreadable`                                       |
| Truncated bytes                                    | `unreadable`, never a throw                        |
| PNG bytes                                          | `none`, `pageCount: null`, parser not invoked      |

Plus:

- Extractor: truncation at `MAX_EXTRACTED_CHARS` sets `truncated`.
- Worker: an unverified document never reaches the extractor; a `text-layer`
  result drives the page-count cross-check to a real outcome in the same run; a
  throwing extractor leaves later jobs in the batch completed; an `unreadable`
  result writes no text row and one `uncertain` finding.
- Repository (DB): upsert inserts, then replaces the row for the same version.
- Capabilities: `textLayerObserved: true` flags the blocker; `false` does not.
- Build: `npm run build` succeeds with `unpdf` in the server bundle, and a
  convention test keeps `unpdf` imported by `text-extraction.ts` alone.

## Non-goals

- OCR, images, DOCX.
- Any rule that reads meaning from the text, including both date rules.
- Showing extracted text on any screen.
- Bypassing or weakening the scan gate.
