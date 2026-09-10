# Kossilon Phase A — Safe, usable staff document workflow (Design)

## Overview

Phase A of the Kossilon implementation plan. Outcome: an authorized staff member can
upload a file, see its actual processing state, open a safe pending file, make a
reasoned review decision and find the result again — and no ordinary action needs a UUID.

Every problem below was re-verified against this branch (`codex/kossilon-phase-a`,
branched from `main` = `fa02046`, which is the audit's own baseline commit — there is no
source drift to reconcile). Line numbers are from this branch; locate anchors by
surrounding text before editing.

The four work packages are independent of each other except that A2's job table is what
A3's "retry" affordance acts on. A1 and A4 touch no shared code.

---

## A1: By-ID document operations apply no object scope

**Problem.** `documentFiltersForActor` (`documents/server-fns.ts:204-218`, added by P0-5)
narrows _list_ reads to the actor's team, and `documentRows`
(`documents/repository.ts:243-256`) implements that by joining
`companies c on c.id = d.company_id` and filtering `c.assigned_team_id`.

No by-ID operation applies it. They all route through `authorizeCompany`
(`documents/server-fns.ts:60-66`), which for any non-Client actor is exactly
`assertStaffAccess(candidate)` — "is this an active, non-Client account with a
`userId`" (`auth/authorization.ts:12-22`). It never looks at _which_ company.

Concretely, an active Staff actor on Team A can, knowing only a UUID:

| Operation                                                     | Guard today                                                   | Exposure                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `downloadDocumentForActor` (`server-fns.ts:183-200`)          | `authorizeCompany` → `assertStaffAccess`                      | Download any company's document bytes                                                      |
| `reviewDocument` (`server-fns.ts:326-348`)                    | `assertStaffAccess` + `authorizeCompany`                      | Approve or reject another team's evidence, writing a `timeline_events` row as the reviewer |
| `scanQuarantinedDocumentForActor` (`server-fns.ts:156-181`)   | `assertStaffAccess(actor)` only — **no company check at all** | Drive another team's scan lifecycle                                                        |
| `createDocumentUploadIntentForActor` (`server-fns.ts:94-122`) | `authorizeCompany`                                            | Create an intent against any company                                                       |
| `finalizeDocumentUploadForActor` (`server-fns.ts:124-154`)    | `authorizeCompany`                                            | Finalize into any company                                                                  |

The same shape was already found and fixed once for annual-return cases. The comment at
`annual-return/permissions.ts:153-159` records it verbatim: detail reads "used to apply
no scope at all … a Staff actor who could not see another team's cases on the board
could still read any of them in full by passing the case id."

**Fix.** Give documents the by-ID counterpart that annual-return already has, in the
same shape, in a new `src/features/documents/authorization.ts`:

```ts
export type DocumentAccessSubject = {
  companyId: string;
  companyTeamId: string | null;
  caseId: string | null;
  caseOwnerId: string | null;
  caseReviewerId: string | null;
};

export function isDocumentVisibleToActor(actor, subject): boolean;
export function assertDocumentAccess(actor, subject): void; // throws `Forbidden: `
```

Rules, chosen to mirror `documentFiltersForActor`'s existing list semantics so a by-ID
read can never return what the list would have hidden:

- inactive → `Forbidden: inactive users cannot access documents.`
- `Client` → not decided here; the caller keeps using `requireClientCompanyAccess`,
  which checks `client_company_memberships` server-side. Unchanged.
- `Admin` → allowed (matches `documentFiltersForActor` returning `{}`).
- `Manager`/`Staff` with no `teamId` → `Forbidden: staff actor has no assigned team.`
  (the exact string `documentFiltersForActor:215` already throws).
- `Manager`/`Staff` → allowed when `subject.companyTeamId === actor.teamId`.
- **Plus** allowed when the document is case-bound and `actor.userId` is that case's
  `ownerId` or `reviewerId`, whatever team it belongs to.

That last clause is deliberate and is not scope creep. `getAnnualReturnActionPermission`
(`permissions.ts:84`) already lets an owner or reviewer act on a case across teams, and
`isAnnualReturnCaseVisibleToActor:174-179` carries a comment explaining that deriving
visibility from the board scope alone produced "a case an actor could mutate but could
no longer open." Documents attached to such a case would reproduce that bug exactly.
The plan's A1 text asks for the same thing: do not "blindly restrict legitimate
assigned reviewers."

**Case-less documents** (`documents.case_id is null` — permitted by the schema) have no
case to inherit from, so they fall through to the company-team rule alone. That is the
explicit company-level policy the plan requires; it is not a gap.

**Where the subject comes from.** Authorization must never trust a client-supplied
company or case. The repository gains two reads that resolve the subject server-side
from authoritative rows:

- `getDocumentAccessSubject(documentId)` — joins `documents` → `companies` → left-joins
  `annual_return_cases`.
- `getIntentAccessSubject(intentId)` — the same for an upload intent.

Every by-ID server fn loads the subject, calls `assertDocumentAccess`, and only then
acts. `createDocumentUploadIntentForActor` resolves its subject from the supplied
`companyId` (plus `caseId` when given) — `createUploadIntent` already validates
case-belongs-to-company and replacement-document scope inside its transaction
(`repository.ts:268-289`), which is correct and stays.

**Background workers.** `runFirmMaintenance` deliberately bypasses actor derivation —
`maintenance.ts:14-21` explains that a scheduler has no request to derive one from. The
scan worker keeps that property but does not gain universal reach: the claimed
`document_scan_jobs` row _is_ its scope, and it may touch only the intent that row names.
No client-supplied identifier reaches the worker.

**Not touched.** `assertDocumentCompanyAccess` (`repository.ts:93-101`) is exported but
has no production callers; it is left alone rather than deleted in a security change.

---

## A2: The upload, quarantine and scanning lifecycle loses files and fakes safety

Four distinct defects, all live.

### A2.1 — Live mode is handed the deterministic test scanner

`loadDefaultDocumentContext` sets `scanner: createDeterministicDocumentScanner()`
unconditionally (`server-fns.ts:59`), while resolving storage per provider mode two
lines above. The deterministic scanner (`scanner.ts`) returns
`{ status: "clean", providerReference: "fake-clean-<checksum12>" }` for **every** input
except two magic content types (`application/x-test-malware`,
`application/x-test-scan-retry`). In live mode, real malware is marked `available`.

**Fix.** A `createDocumentScannerForProviderMode(providerMode, config)` selector that
mirrors `createDocumentStorageForProviderMode`'s existing shape (`server-fns.ts:12-21`):

- `local` → the deterministic scanner (its only legitimate home, plus explicit tests).
- `simulated` → the deterministic scanner, which is honest: `simulated` is already gated
  to the `kossilon-demo` firm (`provider-mode.ts:11-13`) and migration 0022 established
  that a simulated result must be _recorded as_ simulated, not inferred.
- `live` → a real content-inspecting adapter, or **throw**. Live must never silently
  fall back; a missing scanner blocks release rather than granting it.

The live adapter (`documents/live-scanner.ts`) reads the exact stored bytes for the
object key, submits them to the configured provider, and records the provider's own
reference plus the checksum it scanned. It is implemented and contract-tested against a
stub transport now; the real provider is `BLOCKED_INTEGRATION: malware-scanner-provider`
and the capability stays disabled, resolved through its own accessor rather than
`getFirmRuntimeEnv()`'s all-or-nothing gate.

Scanner unavailable or timing out is `failed` + retryable → the document stays
quarantined and retries. It is never `clean`. Malware rejection and infrastructure
failure stay distinct outcomes — `DocumentScanResult` already models this correctly
(`types.ts`), and that discriminated union is kept.

### A2.2 — A successfully received file is deleted 15 minutes after the intent was created

This is worse than the audit states.

`createDocumentUploadIntentForActor:120` sets `expiresAt = now + 15 minutes`. That single
timestamp then governs two unrelated things.

`expireUploads` (`repository.ts:383-388`) runs
`update … set status = 'expired' where expires_at <= now and status in ('created','uploaded','quarantined')`
— **`quarantined` is in that list**, and `quarantined` is precisely the status a
_successfully received_ file holds (`finalizeUploadIntent:322` sets it). `maintenance.ts:94-99`
then deletes the R2 object for every returned row.

So: a client uploads at minute 14, the cron ticks at minute 15, and the bytes are
deleted. The `documents` row created inside the same finalize transaction
(`repository.ts:315-320`) survives, now pointing at an object key that no longer exists.
`recordScanResult` matches only `status = 'quarantined'` (`repository.ts:353`), so the
file can never be scanned; `downloadDocumentForActor:191` requires
`uploadStatus === 'available'`, so it can never be read. The evidence is gone and the
checklist still shows it as received.

The index encodes the bug in its own predicate —
`document_upload_intents_cleanup_idx … where status in ('created','uploaded','quarantined')`
(`0006:259-261`).

**Fix.** Separate the two facts, because they have different owners and different
horizons:

- `expires_at` keeps its meaning: _an upload that was never completed_. The sweep
  narrows to `status in ('created','uploaded')`.
- A new `quarantine_retention_until timestamptz` is set at finalize time, generously
  (14 days), and governs received-but-unscanned bytes. Reaching it does **not** delete
  evidence; it raises an operational escalation and the file remains recoverable.

A received file waiting more than 15 minutes therefore survives, shows an actionable
state, and completes after retry. The old expiry behavior is never restored as a
rollback (see `migration-and-recovery.md`).

**Repair of existing rows** is conservative: quarantined rows get a retention window;
rows already marked `expired` while quarantined are reported through a reconciliation
query, not "repaired" by fabricating bytes or resetting status to clean. Where the R2
object is genuinely gone, that is recorded as gone.

### A2.3 — Nothing ever schedules a scan

`scanQuarantinedDocument` has **zero production callers**. A repo-wide grep returns only
its own definition (`server-fns.ts:287`), its `*ForActor` core, and two test references.
No UI button, no cron pass, no queue. A received document is quarantined until a human
issues the API call by hand — and A2.2 deletes it first.

**Fix.** A durable job, enqueued in the _same transaction_ as the finalize that creates
the document, so a crash cannot leave a received object with no work outstanding
(plan §10.4: persist intent before external work).

New table `document_scan_jobs`, mirroring `notification_outbox`'s proven mechanics
rather than inventing a second queue:

| Column                                  | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `intent_id`                             | the upload intent to scan                                       |
| `checksum_sha256`                       | the exact content version this job is for                       |
| `idempotency_key` unique                | `scan:<intent_id>:<checksum>` — one job per content version     |
| `status`                                | `pending` / `processing` / `succeeded` / `failed` / `cancelled` |
| `attempt_count`, `max_attempts`         | claim-time increment; the **fencing token**                     |
| `next_attempt_at`                       | exponential backoff, reusing `nextRetryAt`'s curve              |
| `last_error_code`, `last_error_message` | operator-visible failure detail                                 |

`claimDue` uses `for update skip locked`, increments `attempt_count` at claim, and
reclaims rows stranded in `processing` past a visibility timeout — exactly
`outbox.ts:210-236`. Every terminal write matches on `attempt_count = ${claimed}` and
returns `false` when superseded, so an expired worker cannot overwrite a newer worker's
result (`outbox.ts:157-167` documents why this fence exists; the same reasoning applies
verbatim here).

Results are applied only if still applicable: `recordScanResult` additionally verifies
the intent's current `checksum_sha256` still equals the job's. A late result for
superseded content is retained as history, never as a current verdict.

The maintenance pass gains a `drainDocumentScanJobs` step alongside the existing ones in
`cron.ts`, so the scan queue is driven by the same trigger-agnostic entry point as the
outbox — not a new scheduler. Scanning never happens inside a single HTTP request across
all documents.

### A2.4 — Finalize races the expiry sweep

`finalizeUploadIntent` takes `for update` and re-checks expiry inside its transaction
(`repository.ts:307-314`) — that half is already right. `expireUploads` does not: it is a
bare `update … where expires_at <= now` with no row lock, and `maintenance.ts` deletes
the bytes **after** that statement commits, outside any transaction covering the object.

With `quarantined` removed from the sweep (A2.2), a finalize that commits first makes
the row `quarantined` and the sweep no longer matches it. To close the remaining window
where the sweep commits first, the sweep additionally re-checks authoritative receipt
state immediately before deletion: a row whose `document_id is not null` has received
evidence attached and its bytes are never deleted, whatever its expiry said. A
previously expired intent alone is not deletion authority.

Both orderings are tested, not just ordinary replay.

### A2.5 — Legacy artificial-clean verdicts

Rows scanned by the deterministic scanner are identifiable with certainty by their
provider reference prefix (`fake-clean-`, `fake-rejected-`) — the same technique
migration 0022 used to classify `simulated:%` / `local:%` outbox rows.

A new `scan_verdict_source` column records `provider` / `deterministic`, backfilled by
prefix, left `NULL` where genuinely unknown (0022's precedent: recording "unknown"
honestly beats defaulting to a value an auditor would read as evidence).

`deterministic` and `NULL` mean **unknown safety, not verified safety**. Unknown-safety
documents keep their bytes and every historical staff decision, are excluded from
client-facing release and from new business approvals, and have a genuine re-scan
enqueued. They remain readable by an Admin behind an explicit "safety not verified"
banner so an operator can still handle an incident — a corrected, narrower policy, not a
grandfathered permission. Because the live scanner is blocked, that re-scan stays
`pending`; the runbook records what clears it.

---

## A3: Production review and uploading are unusable

**Problem, as rendered.** In `ProductionDocumentsSection` (`routes/documents.tsx:413`):

- The Download button renders only when
  `document.uploadStatus === "available" && document.reviewStatus === "verified"`.
  Verify and Reject render for `available && pending`. So the one state in which a staff
  member must look at the file — **pending review** — is the one state with no way to
  open it. Staff approve or reject blind.
  The server is not the constraint: `downloadDocumentForActor:191` checks only
  `uploadStatus === 'available'` and says nothing about review status.
- The production section has **no company or case filter**. The case `<select>` exists
  only inside the `dataMode === "demo"` branch (`documents.tsx:174-190`) and lists demo
  cases. In production the filter is reachable only by typing `?caseId=<uuid>` into the
  URL — which is why the section's own fallback copy, "Filter to one production case to
  review checklist evidence," names an action the UI does not offer.
- Rejection reason is the hardcoded string `"Rejected during staff review"`.
- A row shows filename, category, upload status and review status only — no version,
  source, person, requirement mapping or uploader.

**Fix.**

- **Scan status and business review status are separated in the UI** as they already are
  in the data. A `available` + `pending` + genuinely-scanned document gets a
  **Preview/Open** action. Unknown-safety documents (A2.5) do not, and say why.
- Production company and case **filters**, plus an "Open review" action that carries the
  right case, so the checklist-item selector is reachable without URL editing.
- **Structured rejection reasons**, as the plan enumerates: missing page, missing
  required signature, unreadable, wrong person, wrong company, wrong year, outdated
  proof, incomplete fields, other-with-note — plus a separately editable client-facing
  explanation. Stored alongside the existing free-text reason rather than replacing it.
- **Named staff picker replaces Owner ID**, and **scoped document selectors with visible
  filenames replace payment/receipt UUID fields**, in
  `annual-return/components/production-case-detail.tsx`.
- **The staff portal renders its upload outcome** (`routes/portal.tsx`): per-file
  progress, result, processing state, retry action and source, with batch intake that
  does not lose per-file errors.
- Completed-case locks and server validation are preserved; only valid state actions are
  exposed, with prerequisites visible before submission.

---

## A4: The broad-category dead end

**Problem.** `createUploadIntent` refuses a new intent whenever any _verified_ document
already exists for the same `(company_id, case_id, category)`:

```sql
select d.id from documents d join document_upload_intents i on i.document_id = d.id
where d.company_id = … and d.case_id is not distinct from …
  and i.category = … and d.verification_status = 'verified' limit 1 for update of d
```

→ `throw new Error("Accepted documents are immutable.")` (`repository.ts:290-294`)

`category` is one of eight broad buckets (`types.ts`: identity, registry, signature,
payment, packet, submission, receipt, other) with no notion of a person. So once
director A's HKID is verified under `identity`, **director B's HKID cannot be uploaded
at all**. The only escape is `replacementDocumentId`, which requires the prior document
to be `rejected` (`repository.ts:287-288`) — useless when it was accepted.

**Fix (containment now; the durable model is B/C).**

Stop reading "a verified document exists in this category" as a prohibition on every
further document in that category. Instead:

- Accepted bytes stay immutable: a new upload never overwrites or supersedes an existing
  document, and never inherits its approval. The immutability that the current guard was
  reaching for is enforced where it belongs — on the existing row, which is already
  protected by `reviewDocument`'s `verification_status !== 'pending'` guard
  (`repository.ts:366-367`).
- Additive uploads are permitted with explicit provenance.
- Until B/C introduce person/requirement slots, an additional document in an
  already-satisfied category is **unassigned evidence requiring staff mapping** — it does
  not auto-satisfy the same checklist item. `reviewAnnualReturnEvidenceAction` already
  requires an explicit `checklistItemId` for checklist categories, so nothing
  auto-attaches.

A second director's identity upload is accepted as separate evidence and does not mutate
the first approval.

---

## Testing

Per repo convention: pure domain logic dependency-injected and DB-free; repository
transaction and concurrency behavior in `describe.skipIf(!databaseUrl)` integration
tests; provider behavior as an isolated contract test. Route-dir tests keep the leading
`-`. `PageHeader` stays the only `<h1>`.

| Gate                                                                           | Test                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Unauthorized direct-ID access fails; assigned reviewers still work             | `documents/authorization.test.ts` (pure) + `server-fns` tests per operation |
| Received file survives a >15-minute scanner outage and completes on retry      | scan-job integration test                                                   |
| Live mode cannot use the deterministic scanner                                 | provider-mode selector test asserting `live` throws                         |
| A missing scanner cannot release evidence                                      | selector + `recordScanResult` mapping test                                  |
| Finalize replay and worker replay create one version and one effective outcome | idempotency-key + fencing tests                                             |
| Finalize/expiry concurrency cannot accept and delete the same file             | integration test running both orderings                                     |
| Legacy artificial-clean results do not bypass genuine scanning                 | backfill + `scan_verdict_source` gating test                                |
| Staff inspect a safe pending file, decide with a reason, see the event         | route interaction test                                                      |
| Named person and proof document selected without UUIDs                         | `production-case-detail` interaction test                                   |
| Second director's identity upload accepted, first approval unchanged           | repository integration test                                                 |

`BLOCKED_INTEGRATION: local-postgres` — no Postgres is reachable this session, so every
integration test above is written and will run in CI, and is reported as **skipped
locally**, never as passed.

## Out of scope for Phase A

- Person-level requirement slots and versioned requirement instances (Phase B/C).
- OCR, extraction and AI findings (Phase C).
- Real media intake from WhatsApp (Phase D).
- Package manifests and returned-file reconciliation (Phase E).
- Replacing the `documents.verification_status` enum wholesale; Phase A adds structured
  reasons beside it rather than migrating every consumer.
