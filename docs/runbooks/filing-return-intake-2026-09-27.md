# T16 return intake, reconciliation and source quarantine

T16 preserves source object identity plus byte hash, keeps the internal return adapter read-only and disabled until its protocol is known, and provides a manual receipt intake path on the production case page. Manual intake requires an existing same-case receipt version with human review, a genuine provider scan and exact stored-byte readback. An external claim of accepted/rejected/partial is recorded separately from package submission and from a human match decision. An unmatched or ambiguous return stays open. A missing manifest hash can be matched only with a named human reason after exact external reference, case and proof checks. Confirmed accepted returns close their exception; rejected and partial returns stay open. Neither intake nor reconciliation sets Filed or Completed.

The source contract lists by cursor and reads objects without deleting remote files. Objects are stored in a private quarantine key. A rejected scan is unsafe; missing or deterministic clean scans remain pending. Only a genuine provider verdict with exact hash, size and private storage readback can mark verified. Source object plus hash is unique, so the same file reread is one row and changed content at the same name is another. A page cursor advances only after every stable object is staged under a lease. A failed read or partial upload leaves the cursor unchanged; replay is idempotent. The live internal-server adapter returns unavailable because no protocol, credentials or test-folder authority has been supplied. Manual intake never updates the source cursor or claims a successful source sync.

## Local evidence

- Named T16 scenarios went RED 3/3 on the stubs. Pure/source GREEN 17/17 with existing handoff tests.
- Disposable PostgreSQL 17 migration 0043 applied after 0042; source interruption/unsafe/changed-content test passed. Manual return DB tests passed 6/6, including conflicting replay, wrong receipt category, stale revision, accepted human reconciliation, partial and unmatched exceptions, missing-hash reason and no early Filed state. Production case and Today view interaction/domain tests passed 25/25.
- db:inspect on the disposable DB showed current, no missing/unknown/definition mismatches and all eight capabilities ready. On a second disposable DB, the empty-only SQL below rolled back 0043 (behind, returns capability false, canRelease false), then migration reapplied to current. With one test cursor present, the same SQL raised its evidence-preservation exception and did not remove the cursor. The test cursor was deleted explicitly. Schema release status is local only.
- Final full suite passed 202/202 files and 1820/1820 tests with both local database variables. Typecheck and build passed; lint reported 0 errors and the existing one Fast Refresh warning. The default 30-second dev-route verifier timed out during cold startup on this host; an otherwise identical temporary 120-second copy passed 13/13 routes with no import-protection violation and was removed. verify:firm --dry-run performed 38 reads, 0 network calls and 0 writes.
- External source sync, live scanner, actual registry return and staff pilot remain unverified. No production DB, remote source, external recipient or deployment was changed.

## Production gate

T00 read-only comparison found deployed audit SHA 3af665418dae4afe14ce91dd194fdfecde10dda4 and observed Neon ledger 21/33, unknown legacy 0006_client_register.sql and migrations 0021–0033 absent. Exact deployment DB binding is unverified. Before separately authorized production migration, verify binding, reconcile ledger provenance, backup/restore, row counts and locks, then apply 0021–0043 in order. Pilot manual intake with an authorized staff reviewer, a non-sensitive genuine receipt and real provider scan/R2 readback. The internal source remains blocked until protocol, scoped read-only account, stable-object semantics, test folder and scanner are provided and independently exercised. Do not report an empty exception queue as external source success while sync is blocked.

## Guarded reversal preview

Stop return consumers. Reversal is valid only if no new return source cursor/object and no new handoff return intake/reconciliation exists. Preserve real returns and repair forward otherwise. This SQL is for an empty disposable rehearsal, not production authorization.

```sql
begin;
lock table handoff_returns,filing_return_source_objects,filing_return_source_cursors
  in access exclusive mode;
do $guard$ begin
  if exists (select 1 from filing_return_source_cursors)
    or exists (select 1 from filing_return_source_objects)
    or exists (
      select 1 from handoff_returns
      where source_kind is not null or source_object_id is not null
        or reconciliation_decision is not null
    )
  then raise exception 'T16 return evidence exists; preserve and repair forward';
  end if;
end $guard$;
drop index handoff_returns_case_open_idx;
drop index handoff_returns_source_identity_uidx;
alter table handoff_returns
  drop constraint handoff_returns_manual_evidence,
  drop column case_id,
  drop column company_id,
  drop column return_year,
  drop column source_kind,
  drop column source_object_id,
  drop column source_version,
  drop column source_sha256,
  drop column document_version_id,
  drop column external_reference,
  drop column manifest_sha256,
  drop column candidate_handoff_ids,
  drop column match_state,
  drop column revision,
  drop column reconciliation_decision,
  drop column reconciliation_reason,
  alter column handoff_id set not null;
drop table filing_return_source_objects;
drop table filing_return_source_cursors;
delete from schema_migrations where id = '0043_filing_return_intake.sql';
commit;
```

## Accepted internal return completion follow-up (2026-09-29)

The local completion path now admits a named human-reconciled accepted internal return only when the stored source object ID, version, SHA-256 and verified scan state match. The C2 case preview re-reads the actual stored bytes; the production completion handler checks that preview before the repository's locked database gate. A deleted object blocks the preview, and a source demoted to unsafe blocks the repository mutation. The disposable-Postgres journey is recorded in the T29 release runbook. No live source protocol, credentials, scanner or R2 return has been used.
