# T11 monthly import approval and apply: local evidence and release gate

T11 keeps staging and semantic preview separate from an explicit Admin approval and explicit apply request. Approval binds a 15-minute preview hash, actor, batch revision, source row revisions and current case snapshots. Two source rows targeting the same company and return year are rejected before approval. Apply creates one durable `importApply` bulk operation per semantic preview and hash, regardless of the request idempotency key; each item rechecks the active Admin profile, fixed row revision, company, annual-return case status and case update timestamp. The scheduled T09 runner executes one item in one database transaction with its result, audit and attempt evidence. The runner serializes each business write with cancellation.

For a new mapped case, the transaction uses the approved return year and the company's verified basis month/day and assigned active owner. It creates an `Upcoming` case and the existing `annual_return_case` work item with the active SLA policy. It does not invent a checklist template, fee, invoice or payment; staff must complete case setup before document chasing. An existing case only receives an approved due-date candidate when it has no staff progress. `Filed` and `Completed` cases remain terminal. Blank and `(Nil)` cells do not erase human values. A parsed payment date creates a distinct `pending_review` observation, never a `Payment received` status or a payment row. T13 owns reconciliation with payment evidence. Apply does not queue a notification or call a provider.

The Admin screen shows the saved preview, explicit approval and apply actions, operation counts and a CSV result. The CSV identifies every source row and its fixed state/reason/audit reference; its cells are formula-neutralized by T09. A conflict remains a row-level result, allowing other rows to finish. A transient SQL failure rolls back the row's case, work item, payment observation and audit together and can be retried by the scheduled runner. If an operation completes with errors, the batch becomes `failed`. After review, revalidation reopens it and increments the batch revision, creating a new approval/operation; already-applied rows resolve through their unique apply event without a second case or observation. A stale case is never overwritten.

## Local verification

- RED: four named T11 policy scenarios failed before implementation. The disposable-DB fixture then reproduced a real new-case audit defect: SQL NULL in `before_values` blocked a not-null apply event and kept the batch running. The fix records `{caseExists:false}`. A second RED test reproduced a cancelled old operation changing a newly approved batch to `failed`; the runner now transitions only its own active operation and matching batch revision.
- GREEN: four named policy tests and five disposable-PostgreSQL integration scenarios cover same-preview replay with different request keys, crash and resume, a changed case followed by revalidation, duplicate company/year targets, `Filed`/Nil preservation, an unmapped error row, active Admin reauthorization, cancellation and old-operation/new-batch isolation. The fixture exports create/update/skip/error rows with source-row IDs and audit references. No `payments` rows are produced; parsed dates yield exactly one pending observation per applied row.
- Fresh disposable PostgreSQL 17 migrated 0001 through 0039. `db:inspect` returned `ledgerState=current`, no missing/unknown/definition mismatch and `canRelease=true` for this **local** database. An empty-only rollback of 0039 changed the inspector to `behind` and `canRelease=false`; reapplying 0039 restored `current`. The rehearsal database was removed. A synthetic approval made the rollback guard raise its intended exception in a transaction on the shared disposable database; the transaction rolled back and the approval count returned to zero. The shared local integration database remains separate from production.
- Full disposable-Postgres suite: 192/192 files and 1772/1772 tests before the final server-edge authority assertion; its focused test and the old-operation race test were rerun after: 10/10 affected import/bulk DB tests passed. Typecheck/build passed; lint had 0 errors and 1 pre-existing Fast Refresh warning. All 13 dev-server routes, including `/imports`, loaded without an import-protection violation. `verify:firm --dry-run` performed 38 reads and 0 network calls or writes, with external integrations explicitly BLOCKED. Results are not production acceptance.

## Production gate and guarded reversal

Forward SQL is `db/migrations/0039_nar_import_approval_apply.sql`. It creates durable approvals, per-row apply events and pending payment observations. The T00 production read-only observation found migrations 0021–0033 absent and an unknown legacy `0006_client_register.sql`; deployed database binding and provider/runtime ownership were not verified. This migration and the `importApply` scheduled worker require an exact target/ledger reconciliation, backup/restore point and separate production authorization. No production migration, apply, recipient send or deployment was performed here.

Before any authorized production change, record the exact database identity, branch and ledger; inspect the three new table names and current row counts; verify the active SLA policy for `annual_return_case`, scheduler ownership and the import batch/case counts. After migration and an authorized pilot, confirm one approved row per unique source identity, case-year uniqueness, payment observations pending review, no new payment or outbox send, and CSV audit references. Test a stale case and one interrupted row on the authorized pilot scope before enabling larger batches.

Stop the import worker before reversal. The following rollback was rehearsed only on a newly created, empty local database. **Do not drop these tables if they contain approvals, apply events or payment observations; retain evidence and reconcile forward.** The T09 bulk tables may also contain import operations and must be retained independently.

```sql
begin;
lock table nar_import_payment_observations,nar_import_apply_events,nar_import_approvals
  in access exclusive mode;
do $$ begin
  if exists (select 1 from nar_import_approvals)
    or exists (select 1 from nar_import_apply_events)
    or exists (select 1 from nar_import_payment_observations)
  then raise exception 'T11 evidence exists; rollback requires reconciliation, not table drop';
  end if;
end $$;
drop table nar_import_payment_observations;
drop table nar_import_apply_events;
drop table nar_import_approvals;
delete from schema_migrations where id = '0039_nar_import_approval_apply.sql';
commit;
```
