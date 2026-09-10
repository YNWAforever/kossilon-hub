# Phase A report — Safe, usable staff document workflow

| | |
|---|---|
| Branch | `codex/kossilon-phase-a` (from `main` = `fa02046`, the audit baseline) |
| Starting commit | `fa02046` |
| Ending commit | `9f2c76e` |
| Spec | `docs/superpowers/specs/2026-09-10-kossilon-phase-a-document-safety-design.md` |
| Migration | `0023_document_scan_jobs_and_quarantine_retention.sql` (**not applied to any database**) |
| State | `CODE_COMPLETE` · `INTEGRATION_VERIFIED`: no · `RELEASE_READY`: no |

## 1. What was actually wrong, and what changed

### A1 — by-ID operations applied no object scope

`documentFiltersForActor` narrowed *list* reads to the actor's team, but every
by-ID operation went through `authorizeCompany`, which for a non-Client actor was
exactly `assertStaffAccess` — "is this an active staff account", with no notion of
*which* company. An active Staff actor on any team could download any company's
bytes, approve or reject another team's evidence and be recorded as its reviewer,
and drive any scan lifecycle: `scanQuarantinedDocumentForActor` had no company
check at all.

`src/features/documents/authorization.ts` supplies the by-ID counterpart that
`annual-return/permissions.ts` already had, including its deliberate cross-team
escape hatch — whoever may act on a case may read its evidence, or an assignment
across teams yields a case an actor can mutate but cannot open. Subjects are
resolved server-side from `companies` and `annual_return_cases`; nothing
authorizes against a client-supplied company or case.

### A2 — the lifecycle lost files and faked safety

Four distinct defects, each independently sufficient to lose or mis-release
evidence.

1. **Live mode was handed the deterministic test scanner.** `server-fns.ts`
   passed `createDeterministicDocumentScanner()` unconditionally while resolving
   *storage* per provider mode two lines above. Real malware was marked
   `available`. Now a selector mirrors the storage one and **throws** for live
   rather than falling back — a missing scanner has to block release, never grant
   it.
2. **A received file was deleted 15 minutes after the intent was created.**
   `expireUploads` swept `status in ('created','uploaded','quarantined')` and the
   maintenance pass deleted the R2 object for every row it returned — and
   `quarantined` is precisely the status a *successfully received* file holds. The
   `documents` row survived pointing at a deleted key, could never be scanned
   (`recordScanResult` matches only `quarantined`) and could never be read
   (`downloadDocumentForActor` requires `available`), while the checklist still
   showed it as received. `quarantine_retention_until` now governs received bytes
   and escalates instead of deleting; the sweep is narrowed and additionally
   refuses any row with a document attached.
3. **Nothing ever scheduled a scan.** `scanQuarantinedDocument` had zero
   production callers — no UI, no cron, no queue. `document_scan_jobs` is enqueued
   in the same transaction as the finalize that creates the document and drains
   through the existing `runFirmMaintenance` pass.
4. **Legacy artificial-clean verdicts.** Rows the fixture scanner passed are
   identifiable by their provider-reference prefix, so `scan_verdict_source` is
   backfilled rather than guessed. `deterministic` and `NULL` both mean unknown
   safety: the bytes and every historical staff decision are preserved, the fake
   verdict grants nothing, and a genuine re-scan is queued.

### A3 — the review workspace was unusable

The Download button rendered only for `available && verified`, so the one state
where a reviewer must look at a file — pending review — was the only state with
no way to open it. The production case filter existed only inside the demo
branch. Rejection sent one fixed string. Three fields wanted UUIDs typed into
text boxes. The client portal reported a batch through a single shared banner.

All are fixed; see the commit message on `9f2c76e` for specifics.

### A4 — the broad-category dead end

`createUploadIntent` refused any new intent when a *verified* document already
existed for `(company, case, category)`, and `category` is one of eight broad
buckets with no notion of a person — so once director A's HKID was verified,
director B's could not be uploaded at all, and `replacementDocumentId` was no
escape because it requires the prior document to be `rejected`. The immutability
that guard reached for is already enforced where it belongs, on `reviewDocument`'s
pending-only check.

### Beyond the audit

The reconciliation found one defect the audit did not: the fixture scanner's
`rejected` and `failed` branches keyed off content types
`validateDocumentUploadRequest` makes impossible to persist, so **both branches
were dead in every provider mode** and the scanner was an unconditional "clean"
stamp. Its tests passed by calling `scan()` directly with inputs the real path
cannot produce. Fixed, and the runbook's step 5 is now performable.

## 2. Files changed

| Area | Files |
|---|---|
| New policy | `documents/authorization.ts`, `documents/safety.ts` |
| New scanning | `documents/live-scanner.ts`, `documents/scan-jobs.ts`, `documents/scan-worker.ts` |
| New review support | `documents/rejection-reasons.ts`, `annual-return/components/scoped-pickers.tsx` |
| Changed | `documents/{repository,server-fns,scanner,types}.ts`, `server/{cron,maintenance,runtime-env}.ts`, `server/db/schema.sql`, `annual-return/{repository,server-fns}.ts`, `annual-return/components/production-case-detail.tsx`, `routes/{documents,portal}.tsx`, `test/db-integration-files.ts` |
| Migration | `db/migrations/0023_document_scan_jobs_and_quarantine_retention.sql` |

## 3. Commands actually run, and their results

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass — 0 errors, 1 pre-existing warning in `routes/work-queue.tsx` |
| `npm run test` | **1033 passed, 152 skipped, 0 failed** (135 files) |
| `npm run verify:firm -- --dry-run` | Offline gates pass: `strict-data-mode`, `local-provider-mode`, `migration-schema`, `neon-auth-capability`, `cron`, `dry-run safety` (33 reads, 0 network calls, 0 writes). `BLOCKED`: database, storage, malware-scanner, whatsapp, email, backups, browser-evidence, live bindings, external provisioning |
| `npm run db:migrate` | **Not run.** No authorization was given for any non-local `DATABASE_URL`, and no local database exists |

The baseline flake noted in `baseline-and-decisions.md` (`vite.config.test.ts`
timing out at Vitest's 15 s default on this machine) passed on the final run. It
is timing-dependent, not fixed by this work.

152 skipped is up from the 141 at baseline: the 11 new tests in
`documents/repository.integration.test.ts` are skipped for want of
`TEST_DATABASE_URL` and run in CI.

## 4. Migration status and recovery

`0023` is **written but never executed**. It is forward-only, wrapped in a
transaction by `scripts/db-migrate.ts`, and re-runnable (`if not exists`,
`on conflict do nothing`).

It adds two nullable columns and one table, so it is expand-only and safe against
existing data. Its backfills are conservative:

- `scan_verdict_source` is set only where the provider reference carries a prefix
  nothing but the fixture scanner ever wrote. Everything else stays `NULL` and is
  read as unknown, never as verified.
- `quarantine_retention_until` is measured from actual receipt, so a file
  quarantined three weeks ago surfaces for escalation immediately rather than
  being handed a fresh 14 days.
- Rows expired *while quarantined* are the data-loss victims of the old sweep.
  They are deliberately **not** repaired: their bytes are gone from R2 and
  resetting status would fabricate a record of a file that no longer exists. They
  need the reconciliation query and a human.

**Never roll this back to the old behavior.** The predicate it replaces is the
one that deleted received evidence.

## 5. Integration evidence

None for the parts that need a real provider. Stated plainly:

| Capability | State |
|---|---|
| Live malware scanning | `BLOCKED_INTEGRATION: malware-scanner-provider`. The adapter is implemented and contract-tested against a stub transport across nine cases (clean, infected, unreadable object, checksum mismatch, transport failure, timeout, 5xx, 4xx, malformed response). **It has never run against a real vendor.** |
| Repository SQL | `BLOCKED_INTEGRATION: local-postgres`. 11 new integration tests written; skipped locally, run by CI. |
| Scheduled execution | `BLOCKED_INTEGRATION: deployment-runtime`. The Cloudflare bridge is real (`src/server/nitro-scheduled.ts` registers `cloudflare:scheduled` → `runFirmMaintenance`, and `wrangler.template.jsonc` declares `*/5 * * * *`), but whether the deployed runtime is Cloudflare or Vercel is not determinable from source. |
| Browser walkthrough | Not performed. Requires an authorized login against a real environment; a fixture demo would not be evidence. |

## 6. Acceptance gate status

| Gate | Status |
|---|---|
| Unauthorized direct-ID download/review/upload fails; authorized owner/reviewer still work | Code complete, 18 unit tests + wiring tests. Needs a browser walkthrough. |
| A received file survives a >15-minute scanner outage and completes after retry | Code complete; unit-covered in `scan-worker.test.ts`, DB-covered in CI |
| Live mode cannot use the deterministic scanner; a missing scanner cannot release evidence | **Verified** — `scanner-selection.test.ts` asserts live throws under every option combination |
| Finalize replay and worker replay create one version and one effective outcome | Code complete; DB test in CI |
| Finalize/expiry concurrency cannot accept and delete the same file | Code complete; both orderings tested, in CI |
| Legacy artificial-clean results do not bypass genuine scanning | **Verified** — `safety.test.ts` |
| Staff can inspect a safe pending file, decide with a reason, see the event | Code complete. Needs a browser walkthrough. |
| Staff assign a named person and select a proof document without UUIDs | **Verified** — `production-case-detail.interaction.test.tsx` |
| A second director's identity upload is accepted as separate evidence | Code complete; DB test in CI |

No gate is claimed as passed on the strength of code alone where it needs a
database, a provider or a browser.

## 7. What Phase A did not do

- Person-level requirement slots (Phase B/C). An extra document in an
  already-satisfied category is unassigned evidence a human must map.
- Applying `0023` to any database.
- Any browser evidence.
- Any change to the `documents.verification_status` enum; structured rejection
  reasons live alongside it.

## 8. Next phase

**Phase B — monthly NAR intake and daily case operations.** Its dependency (A) is
code-complete. The supplied workbook contract is already verified cell-by-cell
(see `baseline-and-decisions.md` §3, including three facts the plan does not
record). The first blocking constraint to design around is that `companies`
requires `cr_number`, `br_number`, `incorporation_date`,
`annual_return_basis_date`, `registered_office`, `company_secretary`,
`assigned_owner_id` and `assigned_team_id` — all `NOT NULL` — none of which the
workbook supplies, which is exactly why unresolved rows must stage rather than
create companies.
