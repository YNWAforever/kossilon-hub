# T09 durable bulk core: local evidence and release gate

The first registered action is `assign`. Preview resolves a fixed set of work item IDs and revisions, then applies the existing single-item assignment recommendation/override rules. Commit compares the preview hash, actor scope, expiry and every current revision under database locks. Each scheduled item rechecks the current active profile and team, then calls `assignWorkItemForActor` inside the same transaction as its item result and attempt evidence. A database failure after the business write rolls back the business, audit and item result together; retry runs only safe SQL actions. A changed revision is a conflict and changed authority is forbidden. An all-matching filter stores the selected IDs and does not absorb later rows.

The existing owner-gated maintenance tick discovers up to two operations and runs at most 25 items each per tick. It does not register provider sends. `cancel` stops pending and retryable failed items; it preserves already-started items as evidence. `get` returns counts and per-item states. CSV export uses operational IDs and neutralizes spreadsheet formulas. A disposable-Postgres test reads 1000 saved item results and exports 1001 CSV lines including the header. The action registry exposes only `assign`; the `importApply` adapter depends on T10/T11 and is not activated here.

## Schema and activation

Forward SQL: `db/migrations/0036_bulk_operations.sql` stores previews, operations, items and attempts; `0037_bulk_scheduler_job.sql` adds `runBulkOperations` to the existing scheduled-job check. Fresh `src/server/db/schema.sql` and `EXPECTED_MIGRATIONS` include both. These were applied only to disposable PostgreSQL 17. The T00 read-only production observation found migrations 0021–0033 missing and an unknown legacy `0006_client_register.sql` ledger entry; the target production binding and schema are not reconciled. Do not run `db:migrate` on production until that identity/ledger difference is resolved and the migration is separately approved.

Before any approved runtime activation, review a read-only target identity and migration ledger, count existing operations, confirm the sole scheduler owner and function duration, and verify that the new job does not invoke a provider. Save a SQL preview and operator-approved rollback window. The new scheduler job must remain inert until the target has both forward migrations.

## Guarded rollback SQL for an empty clone

The following rollback is only for a stopped scheduler and tables with **no evidence rows**. Existing operations, items or attempts are business/audit evidence and must be retained. Reverse 0037 first, then 0036. The rehearsal used a second disposable database with migrations through 0037. Both reversal guards rejected deliberately inserted evidence rows. After removing only those synthetic rows, both reversals committed; both bulk tables resolved to null and neither T09 migration remained in that disposable ledger.

```sql
begin;
lock table maintenance_job_runs in access exclusive mode;
do $$ begin
  if exists (select 1 from maintenance_job_runs where job_kind = 'runBulkOperations') then
    raise exception 'T09 rollback blocked: scheduled bulk job evidence exists';
  end if;
end $$;
alter table maintenance_job_runs drop constraint maintenance_job_runs_job_kind_check;
alter table maintenance_job_runs add constraint maintenance_job_runs_job_kind_check check (job_kind in (
  'evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine'
));
delete from schema_migrations where id = '0037_bulk_scheduler_job.sql';
commit;
```

```sql
begin;
lock table bulk_operation_attempts, bulk_operation_items, bulk_operations, bulk_previews
  in access exclusive mode;
do $$ begin
  if exists (select 1 from bulk_operation_attempts) or exists (select 1 from bulk_operation_items)
    or exists (select 1 from bulk_operations) or exists (select 1 from bulk_previews) then
    raise exception 'T09 rollback blocked: bulk operation evidence exists';
  end if;
end $$;
drop table bulk_operation_attempts;
drop table bulk_operation_items;
drop table bulk_operations;
drop table bulk_previews;
delete from schema_migrations where id = '0036_bulk_operations.sql';
commit;
```

No production database, scheduler, provider, recipient, invitation, role or deployment was changed for T09.
