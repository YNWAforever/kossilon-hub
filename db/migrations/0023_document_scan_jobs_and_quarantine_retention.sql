-- 0023: stop deleting received evidence, and stop reading a fake scan as safety.
--
-- Three separate defects share this table, so they share one migration.
--
-- (1) One timestamp governed two unrelated facts. `expires_at` is set to
--     now + 15 minutes when an upload *intent* is created
--     (documents/server-fns.ts createDocumentUploadIntentForActor), which is a
--     reasonable window for "the browser never came back with the bytes". But
--     expireUploads swept `status in ('created','uploaded','quarantined')` and
--     src/server/maintenance.ts then deleted the R2 object for every row it
--     returned -- and 'quarantined' is precisely the status a SUCCESSFULLY
--     RECEIVED file holds (finalizeUploadIntent sets it). A client who uploaded
--     at minute 14 lost the bytes at minute 15. The documents row created in the
--     same finalize transaction survived, pointing at an object key that no
--     longer existed; recordScanResult matches only status='quarantined' so it
--     could never be scanned, and downloadDocumentForActor requires
--     status='available' so it could never be read. The checklist still showed
--     it as received. The old cleanup index encoded the bug in its own predicate.
--
--     quarantine_retention_until separates the two. It is nullable because rows
--     that were never received genuinely have no retention window, and because
--     an existing quarantined row's true receipt time is knowable (uploaded_at)
--     while a created row's is not.
--
-- (2) Nothing ever scheduled a scan. scanQuarantinedDocument had zero production
--     callers -- no UI, no cron, no queue -- so a received document sat
--     quarantined until a human issued the API call by hand, and (1) deleted it
--     first. document_scan_jobs makes the work durable and enqueued inside the
--     same transaction as the finalize that creates the document, so a crash
--     cannot leave a received object with no outstanding work.
--
--     The mechanics are notification_outbox's, deliberately: claim with
--     `for update skip locked`, increment attempt_count at claim time and use it
--     as a fencing token in every terminal write, exponential backoff via
--     next_attempt_at, and a visibility timeout that reclaims rows stranded by a
--     Worker killed mid-scan. That queue is proven in this codebase and its
--     failure modes are already documented in src/features/notifications/outbox.ts.
--     A separate table rather than rows in notification_outbox because that
--     table's channel check constrains it to email/whatsapp/in_app and its
--     redaction constraint is built around a recipient and a payload; a scan job
--     has neither, and widening those to fit would make the enum lie.
--
-- (3) Live mode was handed the deterministic test scanner
--     (documents/server-fns.ts passed createDeterministicDocumentScanner()
--     unconditionally), which returns 'clean' for every input except two magic
--     content types. Every clean verdict it ever wrote is therefore evidence of
--     nothing. Those rows are identifiable with certainty by their provider
--     reference prefix, the same way 0022 classified simulated:%/local:% outbox
--     rows, so scan_verdict_source can be backfilled rather than guessed.

alter table document_upload_intents
  add column quarantine_retention_until timestamptz;

-- Where the verdict came from. NOT a new `status` value: status already encodes
-- the lifecycle and every consumer switches on it, so adding a safety dimension
-- there would silently reroute them (the same reasoning 0022 recorded for
-- notification_outbox.delivery).
alter table document_upload_intents
  add column scan_verdict_source text
  check (scan_verdict_source is null or scan_verdict_source in ('provider', 'deterministic'));

-- Partial backfill. Pre-fix rows are self-describing: createDeterministicDocumentScanner
-- mints 'fake-clean-<checksum12>' and 'fake-rejected-<checksum12>' into this
-- column and nothing else ever wrote those prefixes, so those rows are certain.
--
-- Everything else stays NULL and is treated as unknown safety, not as verified
-- safety. A non-null reference with an unrecognised prefix is NOT assumed to be
-- a real provider's: no real scanner has ever been configured on this codebase,
-- so such a row would be an unexplained value, and guessing 'provider' would
-- manufacture exactly the false evidence this column exists to prevent.
update document_upload_intents
set scan_verdict_source = 'deterministic'
where scan_provider_reference like 'fake-clean-%'
   or scan_provider_reference like 'fake-rejected-%';

-- Give already-received rows a retention window measured from when they were
-- actually received, not from now, so a file quarantined three weeks ago is
-- surfaced for escalation immediately instead of being handed a fresh 14 days.
-- coalesce covers rows written before uploaded_at was populated.
update document_upload_intents
set quarantine_retention_until = coalesce(uploaded_at, created_at) + interval '14 days'
where status = 'quarantined';

-- Rows that were expired *while quarantined* are the data-loss victims of (1).
-- They are deliberately NOT repaired here: their bytes are gone from R2 and no
-- migration can bring them back. Resetting status would fabricate a clean
-- record of a file that no longer exists. They are found by the reconciliation
-- query in docs/implementation/kossilon/migration-and-recovery.md and handled by
-- a human, which is the only honest option.

create table if not exists document_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references document_upload_intents(id) on delete restrict,
  -- The exact content this job is a verdict about. A replacement upload produces
  -- a new checksum and therefore a new job; a result arriving for a checksum the
  -- intent no longer carries is history, never a current verdict.
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null default 'initial' check (reason in ('initial', 'rescan', 'retry')),
  idempotency_key text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_scan_jobs_attempts_check check (attempt_count <= max_attempts)
);

-- Mirrors notification_outbox_retry_idx. Covers both claimable sets: due
-- pending/failed rows, and processing rows stranded past the visibility timeout
-- (which is an updated_at comparison, hence updated_at in the index).
create index if not exists document_scan_jobs_claim_idx
  on document_scan_jobs (next_attempt_at, updated_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index if not exists document_scan_jobs_intent_idx
  on document_scan_jobs (intent_id, created_at desc);

-- Enqueue every already-received file that has no verdict yet, so the durable
-- worker picks up the backlog that (2) left stranded rather than requiring a
-- human to notice each one. on conflict do nothing keeps this migration
-- re-runnable against a database where some jobs already exist.
insert into document_scan_jobs (intent_id, checksum_sha256, reason, idempotency_key)
select id, checksum_sha256, 'initial', 'scan:' || id || ':' || checksum_sha256
from document_upload_intents
where status = 'quarantined'
on conflict (idempotency_key) do nothing;

-- Enqueue a genuine re-scan for every file whose only clean verdict came from
-- the deterministic scanner. Their bytes and every historical staff decision are
-- preserved untouched; what changes is that the fake verdict no longer counts as
-- verified safety. These jobs stay pending until a real scanner is configured,
-- which is the accurate state -- not a failure.
insert into document_scan_jobs (intent_id, checksum_sha256, reason, idempotency_key)
select id, checksum_sha256, 'rescan', 'scan:' || id || ':' || checksum_sha256 || ':rescan'
from document_upload_intents
where scan_verdict_source = 'deterministic'
  and status = 'available'
on conflict (idempotency_key) do nothing;

-- Replace the cleanup index whose predicate encoded the bug. The sweep now
-- covers only uploads that were never completed; received files are governed by
-- quarantine_retention_until and are never deleted by it.
drop index if exists document_upload_intents_cleanup_idx;

create index if not exists document_upload_intents_cleanup_idx
  on document_upload_intents (expires_at)
  where status in ('created', 'uploaded');

create index if not exists document_upload_intents_quarantine_retention_idx
  on document_upload_intents (quarantine_retention_until)
  where status = 'quarantined';
