# Kossilon Phase B — Monthly NAR intake and daily case operations (Design)

## Overview

Staff import the actual monthly worksheet, resolve data differences, open the right
annual case, choose the designated contact, track manual chasing and capture returned
files in one daily workspace.

Everything below was verified against this branch. Line numbers are from
`codex/kossilon-phase-b` (branched from `codex/kossilon-phase-a`); locate anchors by
surrounding text before editing.

Work packages, in the order they land. B-2 is placed second rather than last because it
is the one item that is actively wrong in front of clients today.

---

## B-1: The workbook importer

### The problem

There is no spreadsheet reader in the repository. `package.json` has `mammoth` (DOCX)
and `pdfjs-dist` (PDF) and nothing else; `xlsx` appears zero times in either lockfile.
`src/lib/doc-parser.ts` is a client-side, demo-gated, `localStorage`-backed knowledge-base
parser that reads a `.csv` as undelimited raw text — mistaking it for an ingestion
capability would produce an import that vanishes on reload.

The one authenticated production upload path rejects spreadsheets by allowlist:
`MIME_BY_EXTENSION` permits only pdf/png/jpeg, so an admin cannot even park the workbook
as a document. Phase B needs a genuinely new ingestion route.

### Reading the workbook without a dependency

`DecompressionStream("deflate-raw")` is available in the Node and Workers runtimes, so
the ZIP container can be inflated with no library at all. A purpose-built reader is not
merely adequate here, it is the safer option:

- SheetJS carries a history of prototype-pollution and ReDoS advisories and distributes
  outside the public registry; ExcelJS pulls a large tree into a Worker bundle. The
  repository's own dependency rule (`bunfig.toml` blocks packages published under 24
  hours old; ask before adding an exclusion) points the same way.
- The plan requires that macros, formulas, external workbook links and embedded
  instructions are never executed. A reader that only ever looks at `<v>` and `<is>`
  and has no formula evaluator cannot execute one by construction, rather than by
  configuration.

`src/features/nar-import/xlsx/` reads exactly five entries — `[Content_Types].xml`,
`xl/workbook.xml`, `xl/worksheets/sheetN.xml`, `xl/sharedStrings.xml`, `xl/styles.xml` —
and refuses the file outright when it sees an OLE/CFB header (an encrypted or
pre-2007 workbook), a `vbaProject.bin`, or an `xl/externalLinks/` entry. It is bounded
against a zip bomb: entry count, per-entry uncompressed size, and total inflated size all
capped, checked against the central directory before inflating anything.

`<f>` elements are skipped without being read. A cached formula result in `<v>` is taken
as a value and **flagged**, because a value the workbook computed is not a value the
source system asserted.

### What is preserved

`nar_import_batches` records the source file name, the SHA-256 of the exact bytes, the
size, the sheet, the parser version and the operating period the staff member chose.
`unique (source_sha256, sheet_name)` means re-importing the same bytes finds the same
batch instead of making a second one.

`nar_import_rows` records, per sheet row: the row number, the external client ID, `raw`
(every cell verbatim with its OOXML type and style-derived date-formatted flag) and
`parsed` (the normalized candidates, with explicit unknowns). Nothing is discarded on
the way in, so a mapping decision can be revisited without re-reading the file.

`company_external_references` is the missing identity column: a repo-wide grep for
`external_ref|external_id|source_system|client_code` returns nothing, so today a per-firm
client code from the spreadsheet has nowhere to land and a second import cannot
re-identify the row it created. `unique (source_system, external_client_id)` binds one
external id to one company.

### Normalization, and what must never be invented

Dates are normalized explicitly against the workbook's own epoch flag
(`date1904`), never through `new Date(string)` and never through browser locale.

The supplied workbook drives these rules, each verified cell-by-cell against the file:

| Observed | Rule |
|---|---|
| `dimension` is `A1:CO65`; rows 38–65 carry formatting and no values | Records are bounded by the first and last row carrying a client ID. A reader that counts `<row>` elements gets **65**, not 35. |
| Column D is `dd/mm` text with **no year**; D37 is `30/8` with no leading zero | Parse day and month; leave the year `null`. Never infer an incorporation year. |
| H7 is the **text** `5/9/2025` in a `d/m/yyyy;@` cell, beside serials elsewhere in the same column | Accept both, record which form it arrived in. |
| F23 is `27/8/2025 (Ceredit fr deposit)` | Parse the date candidate, keep the note verbatim for confirmation. |
| E8/E29/E32 and F8/F29/F32 are `(Nil)` — always paired | Preserve as a literal marker. Never map to paid, unpaid or cancelled. |
| F17 is blank; column H has 11 blanks | Blank is unknown, not zero and not "no BR due". |
| A7 is a single space | Column A is a row ordinal, never an identity. |
| Invoice `IAHK-25-07071` appears on rows 14 and 28 — **two different companies** | Column E can never be an import identity or a dedupe key. Duplicate invoice numbers are a flagged conflict, not a match. |
| G matches "anniversary + 42 days" on **34 of 35** rows — row 27 (`K13791`) is one day off | Never recompute column G from column D. The supplied due date is preserved with its provenance, and a derived value is only ever shown as a cross-check. |
| F18 (2025-11-05) falls after G18 (2025-09-29) | A payment date after an AR due date is recorded, not read as late filing. |

### Identity and re-import

The idempotent business identity is `source system + external client ID + service type +
return year`, resolved to the existing authoritative company and case. The schema is
single-firm — no table carries a firm column, `FIRM_ID` is a deployment-level Worker var
whose only functional consumer is the provider-mode gate — so the deployment *is* the
scope and no firm column is added.

Re-import is a controlled merge. Source-owned fields may update with provenance; staff
notes, contact choices, evidence, approvals, reminders and handoffs never lose to a blank
or older export. Each row carries its own disposition: **New / Updated / Unchanged /
Conflict / Invalid / Needs company mapping**.

### What the importer will not do

`companies` requires `cr_number`, `br_number`, `incorporation_date`,
`annual_return_basis_date`, `registered_office`, `company_secretary`,
`assigned_owner_id` and `assigned_team_id` — all `NOT NULL`, with `cr_number` and
`br_number` globally unique. The workbook supplies none of them. A fabricated BR number
would permanently burn a unique value and block the real one later, so **an unmatched row
stages and asks for a mapping. It never creates a company.**

`payments` is worse than "a payment is optional": it has `unique (case_id)` and
`amount integer not null check (amount > 0)`, and a case with no payment row renders
normally on the board but can never be advanced — staff hit "Annual return payment not
found." with no UI anywhere to create one. The workbook has invoice numbers but no
amounts. So the importer **never creates a payment**, records the invoice and
payment-date observations on the staging row, and the apply step requires a staff-supplied
fee, exactly as the existing create-case contract already does.

Applying is also where `ensureWorkItemForEvent` demands an active `sla_policies` row for
`annual_return_case`; without one, bulk creation would fail wholesale. The apply
pre-flight checks for it and reports it as a blocked precondition rather than failing
row 1 of 35.

### Historical replay

The supplied sheet is `8.2025`, historical. Import defaults to archive/replay: rows are
staged and **no case is activated and no reminder is queued**. Staff must explicitly
choose a valid operating period and select the rows to activate.

---

## B-2: A received document is not a missing document

### The problem, which is live in front of clients

There is **no code path that links a client upload to a checklist item at all**.
`grep -rn "checklist" src/features/documents/` returns zero hits. The upload sends
`{companyId, caseId, category, fileName, contentType, sizeBytes, checksum}` and nothing
else, `finalizeUploadIntent` enqueues no work item, and `ensureWorkItemForEvent` is
called from seven places, none of them in the documents feature.

So an uploaded document is invisible to the checklist. Meanwhile:

- `client-portal-server-fns.ts:71-73` and `routes/portal.tsx:465-467` both count
  `item.required && item.status !== "Verified"` and render
  "We are still waiting on N documents from you" — which includes every document the
  client has already sent and staff have not yet reviewed.
- `deriveProductionFollowUpDrafts` emits an `annual-return` chase draft for **every**
  mutable case unconditionally: the loop has no outstanding-work test whatsoever.
- The manual "mark received" toggle in the case detail is a dead end, because a Missing
  item has no `documentId` to carry forward.

Before Phase A, the cron then deleted the uploaded bytes about fifteen minutes later.

### The fix

Introduce the received state properly, without loosening the internal filing gate.
`hasRequiredChecklistEvidence` is a deliberate four-way conjunction whose redundancy with
`updateChecklistItem`'s lockstep writes is what stops a drifted row passing; it is
**not** the bug and is not touched.

- A finalized upload that names a checklist item marks that item `Received` and records
  the document, in the same transaction.
- An upload that names no item lands as unassigned evidence and raises an internal
  matching task — it does not silently satisfy anything.
- The client-facing outstanding list excludes items in `Received`. The internal review
  list includes exactly those.
- The chase-draft loop gains the outstanding-work test it never had. A case with nothing
  genuinely outstanding produces no draft.

---

## B-3: Server-side search and real pagination

`BOARD_PAGE_SIZE = 200`, and `boardFiltersFromSearch` deliberately never forwards `q` —
its own comment says company-name search is a client-side filter over the returned rows.
No server fn accepts a text field; a repo-wide grep for `ilike|to_tsvector|tsquery|
pg_trgm` returns zero hits, and there is no `offset`, cursor or `useInfiniteQuery`
anywhere. There is no existing pattern to copy, so this establishes one.

Three consequences beyond the board, all worse than the audit stated:

- The owner filter — the one control that could narrow the SQL enough to surface a late
  case — is itself populated from the truncated page.
- The "Showing the first 200" warning is gated on `cases.length === 200` exact equality,
  while the `risk` filter is applied *after* hydration, so the warning can be absent when
  truncation happened.
- `follow-up-server-fns.ts:62` builds the production WhatsApp follow-up drafts from
  `listCases({})` — the **200 earliest-due cases only**. Clients past row 200 are silently
  never chased. That is a correctness bug, not a UI one.

`q` becomes a real SQL predicate over company name and external reference, keyset
pagination replaces the bare limit, and metrics are computed by their own aggregate query
rather than by counting a truncated page.

---

## B-4: The daily workspace

Navigation is thirteen destinations across Operations / Messaging / Administration, with
no global search and no notion of "what do I do today".

Default navigation becomes 今日工作、客戶與案件、文件審閱、訊息, with manager and admin
controls kept separately available and every existing route retained. Five work views:
今日要追、新收到文件、等我覆核、可以交件、回件與異常. A view whose capability is not yet
released shows its real manual status and never fake completions.

Two specific defects go with it:

- `index.tsx:264-285` renders the red "Requires immediate attention" panel
  **unconditionally**, so with zero overdue cases it says, in full alarm styling,
  "0 annual returns are overdue."
- Work-queue rows show `companyId.slice(0, 8)` and `ownerId.slice(0, 8)` — raw UUID
  prefixes where the company and staff names belong — and the queue read has no `LIMIT`
  at all while filtering and counting in the browser.

---

## B-5: Foundation for person-level requirements

Confirmed case parties and versioned requirement instances, including person/entity
applicability, extending the existing checklist rows rather than competing with them.
Evidence links so one requirement may have several documents and one document may support
several requirements with explicit page ranges.

The legacy backfill is conservative: only unambiguous existing evidence is mapped, all
historical ids and decisions are preserved, and anything unresolved is flagged for review.
A generic identity requirement is never split into guessed directors.

---

## Testing

Per repo convention: pure domain logic dependency-injected and DB-free; repository
behaviour in `describe.skipIf(!databaseUrl)` integration tests registered in
`src/test/db-integration-files.ts`; route-dir tests keep the leading `-`.

The workbook fixture committed is **sanitized** — real structure and every edge case
above, invented company names and client ids. The original is never committed.

`BLOCKED_INTEGRATION: local-postgres` still applies: integration tests run in CI.

## Out of scope for Phase B

- OCR, extraction and AI findings (Phase C).
- Real media intake from WhatsApp (Phase D); B delivers the tracked manual path.
- Package manifests and folder returns (Phase E).
- Any automatic customer message. Historical replay sends nothing.
