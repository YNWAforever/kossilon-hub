# Kossilon audit implementation baseline — 2026-09-27

## Scope and provenance

The audit reference is `3af665418dae4afe14ce91dd194fdfecde10dda4`. This implementation branch was created from fetched `origin/main`, which resolves to that same commit. The production alias `https://kossilon-hub.vercel.app` resolves to Vercel deployment `dpl_3eb48Wud1q6eNjYFh1fwBZ1cUSKT`; the corresponding successful GitHub deployment `6683554920` records the same commit. This is a baseline comparison, not a request to reset other checkouts.

The supplied implementation pack's 11 SHA256 checks and the evidence ZIP's 21 internal checks passed. The audit Markdown, rendered HTML, live DOM capture, source excerpts and all ZIP entries were examined. Fourteen source snapshots from the ZIP match current main after line-ending and trailing-newline normalization. The pack manifest describes the original input; `06_EXECUTION_STATUS.csv` is an execution ledger and will change as work proceeds.

PR #68 is **open and conflicting**, with head `76ad310ca8bad75a7ce44c82c9e20db734fd6eaa`. It has not been merged into main. Its outbox safety changes require reconciliation and tests under T06; do not merge the old PR directly. PR #69 is merged. The other local checkouts have not been altered.

## Database and deployment boundary

The read-only Neon inspection targeted project `red-morning-00331124` (Kossilon Hub), branch `br-muddy-mountain-aov8bbku` (`production`), database `neondb`. Its `schema_migrations` ledger contains 21 rows: 20 of 33 expected migrations and an unknown `0006_client_register.sql`; migrations 0021–0033 are absent. This exactly matches the audit's live operations DOM (33 expected, 21 applied, 13 missing, 1 unknown). The branch's direct binding to the Vercel `DATABASE_URL` has not yet been independently verified. The unknown ledger entry is historical: Git commit `092b6ff` contains `0006_client_register.sql`, and its blob equals the current `0008_client_register.sql` blob. Keep the ledger row and verify data/catalog compatibility before a migration. The absence of `service_packages` is expected after migration 0018 and is not evidence of drift.

The inspected production deployment is a Vercel Node.js 24 `__server` function. The local build contains a Cloudflare scheduled hook, but this does not establish that a scheduler runs in production. No production DDL, data change, live message, invitation or deployment was performed.

## K01–K24 disposition at T00

“Still present” means the audited source behavior remains on current main or the read-only schema evidence confirms it. “Needs reproduction” means the runtime/provider or a specific data-dependent case must still be exercised. No finding is classified already fixed: current main and the production deployment use the audit commit.

| Finding | Disposition | T00 evidence / remaining reproduction |
| --- | --- | --- |
| K01 | still present | Neon ledger 21/33, 13 missing and 1 unknown; same live DOM counts; Vercel DB binding remains to verify. |
| K02 | needs reproduction | Document/payment support tables after 0020 are absent on inspected Neon branch; reproduce failing query and distinguish error from empty state. |
| K03 | needs reproduction | Audit live DOM reported WhatsApp unavailable; provider credentials and inbound/delivery runtime remain unverified. |
| K04 | still present | Main retains audited outbox code; PR #68 is open/conflicting, so its safety changes are not part of main. |
| K05 | still present | Audited readiness and dashboard source matches main. |
| K06 | still present | Audited portal deep-link source matches main; reproduce with authorized case and ID variants. |
| K07 | still present | Audited monthly-import implementation matches main; no domain application path evidenced. |
| K08 | still present | Audited company mapping source matches main. |
| K09 | still present | Audited mapping/re-upload source matches main. |
| K10 | still present | Audited import query/error rendering source matches main. |
| K11 | still present | Audited admin route/source matches main. |
| K12 | still present | Audited work-queue UUID labels match main and live DOM. |
| K13 | needs reproduction | SLA source matches main; scheduled policy execution and live breach semantics need runtime evidence. |
| K14 | still present | Audited dashboard and board metric source matches main. |
| K15 | still present | Audited Settings mock-usage source matches main. |
| K16 | still present | Audited pagination source matches main. |
| K17 | still present | Audited submit-packet source matches main. |
| K18 | still present | Audited WhatsApp/document workflow source matches main. |
| K19 | still present | Audited document-analysis source matches main. |
| K20 | still present | Audited static operations integration status source matches main. |
| K21 | needs reproduction | Vercel Node deployment confirmed; Cloudflare scheduled hook in local build does not prove production scheduled runs. |
| K22 | still present | Audited daily-work routes match main. |
| K23 | still present | Audited `listAllCases` and related full-list metrics paths match main. |
| K24 | still present | Audited UI source and live DOM labels match main. |

## Local gate results before changes

- `bun install --frozen-lockfile`: passed, 702 packages installed.
- `npm.cmd run lint`: passed with one existing `react-refresh/only-export-components` warning in `src/routes/work-queue.tsx:34`.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run test`: 166 files passed, 8 skipped; 1522 tests passed, 188 skipped. Database tests are skipped because `TEST_DATABASE_URL` is unset.
- `npm.cmd run verify:firm -- --dry-run`: command passed, but reports blocked database, storage, malware scanner, WhatsApp, email, backups, browser evidence, live bindings and external provisioning. It performed 36 reads and no network calls or writes.
- `npm.cmd run build`: passed. The generated Cloudflare scheduled hook exists in `.output/server/index.mjs`.
- `npm.cmd run verify:dev-server-imports`: **failed twice** at `request /` after the 15-second route timeout. The other 11 routes passed, and neither run found an import-protection violation. Keep this as a baseline gate failure until diagnosed; do not equate the successful build with production readiness.

## Release gates

T01 needs a read-only expected/ledger/catalog report, a disposable local Postgres migration rehearsal, and a rollback script before any production migration approval. T02 needs ID and query-state regression tests. Provider and scheduler checks remain runtime dependencies; CI passing alone cannot close T29.
