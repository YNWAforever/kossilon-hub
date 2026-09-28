# T06 delivery attempts: review and release evidence

This runbook covers the local implementation on `codex/kossilon-delivery-safety`. No production schema change or live send has been performed.

## Boundary

`claimDeliveryAttempt` atomically selects a client-origin, active-company, non-redacted recipient and writes a unique lease. A claim that expires before `beginProviderCall` may be reclaimed. `beginProviderCall` rechecks origin, recipient, state, attempt number, and lease token, then commits `send_started` before the transport runs. An accepted or simulated outcome is recorded atomically with the outbox. A timeout, ambiguous provider response, or missing durable outcome becomes `needs_reconciliation`; it is excluded from automatic claim. Only an explicit WOZTELL unreachable-recipient rejection (`err_code=100` in the current transport) is considered a definite rejection eligible for a new attempt under the same logical key. Resend's stable header continues to use the outbox idempotency key. WOZTELL has no idempotency header in this integration, so this protocol does not claim external exactly-once delivery.

## Local evidence

- Four named T06 scenarios were RED before implementation. Focused dispatcher/runtime/Postgres tests: 47/47 GREEN, including concurrent claim and origin lookup failure.
- Disposable PostgreSQL 17: migration `0034_notification_delivery_attempts.sql` applied; `npm run db:inspect` reported current ledger, no missing or unknown entries, and `canRelease: true` for that local database only.
- Full disposable-Postgres suite: 186 files / 1745 tests passed. Lint: 0 errors, one pre-existing fast-refresh warning. Typecheck and build passed. `verify:firm -- --dry-run` passed its local structure/migration/cron checks with zero network calls and zero resource writes; live bindings and external providers remained blocked. GitHub PR #71 exact-head CI passed before its merge into the nonproduction integration branch. Later PR #95 CI passed the full disposable-PostgreSQL suite through migration 0065. These checks are source and isolated-database evidence; production bindings and provider receipts remain unverified.

## Production read-only preview

Run these against the *identified* target database using a read-only role and record the connection identity separately; never infer it from the app alias:

```sql
select current_database() as database_name, current_user as reader, inet_server_addr() as server_address;
select id, applied_at from schema_migrations where id >= '0032' order by id;
select status, count(*) from notification_outbox group by status order by status;
select count(*) as legacy_processing_unknown
from notification_outbox where status = 'processing';
select count(*) as fixture_pending
from notification_outbox o join companies c on c.id = o.company_id
where c.data_origin <> 'client' and o.status in ('pending','failed','processing');
```

Before applying migration `0034`, reconcile all existing `processing` rows; the forward SQL quarantines them as unknown rather than retrying them. Review provider receipts and case timeline evidence before any manual disposition. The local migration is transaction-scoped by `scripts/db-migrate.ts`. Do not run it against production under this assignment.

## Rollback gate

After any external call begins, reverting code to the old reclaim path can resend an unknown message. A safe production rollback therefore pauses dispatch first and retains both the attempt table and `needs_reconciliation` status while receipts are reconciled. A schema reversal is reviewable only if the following read-only checks all return zero:

```sql
select count(*) as attempts from notification_delivery_attempts;
select count(*) as unresolved from notification_outbox
where status in ('processing','needs_reconciliation');
```

If either count is nonzero, use a forward fix; do not drop the attempt table or restore the old status constraint. If both counts are zero, the *proposed* reversal below can be tested on a cloned database and separately authorized:

```sql
begin;
lock table notification_outbox, notification_delivery_attempts in access exclusive mode;
do $$
begin
  if (select count(*) from notification_delivery_attempts) <> 0
     or (select count(*) from notification_outbox
         where status in ('processing','needs_reconciliation')) <> 0 then
    raise exception 'T06 rollback gate failed';
  end if;
end $$;
drop table notification_delivery_attempts;
alter table notification_outbox drop constraint notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending','processing','sent','failed','cancelled'));
delete from schema_migrations where id = '0034_notification_delivery_attempts.sql';
commit;
```

The forward and reversal SQL were rehearsed on a second disposable PostgreSQL 17 database: migrations 0001–0034 applied, the guarded rollback committed, and both the attempt table and 0034 ledger entry were absent afterward. That database was then removed. The reversal remains a review artifact only. Deployment, production migration, live recipient sends, and runtime acceptance require separate authorization and evidence.

## Annual-return reminder follow-up (#68 comparison)

The integrated T06 outbox already records `send_started` before transport, isolates uncertain outcomes as `needs_reconciliation`, and never automatically retries them. Follow-up commit `cab722b39170ac63ba1317d76a6c3bc59bf06c95` adds the missing annual-return accounting path: the scheduled sweep marks definitely terminal, unsent automated reminders as failed once and retracts their counter; uncertain outcomes get a separate timeline event for human review without asserting non-delivery. A skipped reminder no longer consumes its milestone. Manual WhatsApp reminders require a current company-contact phone, and an idempotent queue replay no longer writes a second compliance record.

Five targeted cases were RED before implementation, then 73/73 affected tests passed on disposable PostgreSQL. The full local database suite passed 228 files/1964 tests before the final replay guard; that guard passed its focused test and still needs exact-head full CI. No live recipient send or production migration was run. The old #68 branch remains unmerged because its current outbox model conflicts with this integration; only the verified missing behavior was adapted.
