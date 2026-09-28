# T13 payment reconciliation: local evidence and release gate

T13 keeps `payments` as the canonical invoice and paid status. A monthly workbook date remains a `nar_import_payment_observations` row in `pending_review`. Reviewing a payment document verifies its bytes and category; it does **not** mark the invoice paid. An authorized staff member selects the case and current reviewed payment proof, then explicitly confirms invoice reference, amount and currency. The server checks the active staff/case assignment, observation revision, company and case, current proof version, genuine provider scan with matching stored-byte hash and size, document review, exact invoice, integer minor-unit amount and currency. The single service writes the observation, unique proof/payment allocation, canonical payment change and before/after audit in one transaction. An exception records its reason and leaves the canonical status pending. The UI displays the stored reason to authorized staff. Reject requires a reason. Batch adapters must invoke this same `reconcilePaymentForActor` per item with the saved expected revision and actor, inside each item's durable transaction; T19 owns the bulk UI and runner adapter.

The old direct case payment selector no longer offers `Payment received`; the repository also denies a direct paid transition without a current reconciled allocation. The production payment page distinguishes `Verify proof` from `Match payment`. The demo route remains read-only. Partial/overpayments, currency mismatch, duplicate invoice reference, proof reuse and payment reuse are exceptions; this slice has no allocation split or currency conversion. `payments.amount` is the existing whole-HKD integer, converted to minor units by multiplying by 100 for exact comparison. Missing invoice/amount is never estimated. Payment status and readiness update only after the domain service completes. No provider payment feed was called.

## Local verification

- RED: document review auto-marked payment received; direct `updatePayment` accepted a same-case verified document without invoice/amount allocation. The named T13 scenarios reproduced both before implementation.
- GREEN: local PostgreSQL 17 integration tests cover pending import date, same-transaction exact match, partial/overpayment/currency exceptions, stale revision and inactive actor; policy tests cover foreign-company proof, duplicate reference/proof/payment allocation; production UI interaction requires explicit confirmation. The direct-paid RED test now refuses the old command.
- A second, empty disposable database migrated 0001–0040 successfully. The guarded 0040 reversal on that empty database changed the inspector to `behind` / `canRelease=false`; reapplying 0040 restored `current` / `canRelease=true`. `db:inspect` returned `ledgerState=current`, no missing/unknown/definition mismatch and `canRelease=true` for **that local database only**.
- Full local suite: 195/195 files and 1792/1792 tests. The added database-side staff revocation assertion was rerun afterwards in its focused 6/6 T13 suite. Typecheck and build passed; lint had zero errors and one pre-existing Fast Refresh warning. All 13 dev-server routes passed when rerun without competing build jobs (the first concurrent run timed out on three routes). `verify:firm --dry-run` performed 38 reads and zero network calls or writes, with external dependencies blocked. No live scanner, actual bank confirmation, production DB migration, recipient send or deployment has been performed.

## Production gate

Production read-only T00 found migrations 0021–0033 absent and an unknown legacy `0006_client_register.sql`; the deployed DB binding remains unverified. Before any separately authorized change, identify the exact target DB/branch and deployed SHA, inspect ledger and catalog, take and verify a backup/restore point, rehearse the exact upgrade path, then apply forward SQL 0040 only after 0039. Confirm no automatic `Payment received` transition from imported dates or proof review. Pilot with an authorized staff account and non-sensitive test payment evidence; confirm an inactive/out-of-scope actor, stale revision, wrong-company proof, duplicate allocation, partial amount and currency mismatch fail closed. Confirm before/after audit and readiness only on a genuine match. These local checks do not grant production mutation or deployment authority.

## Guarded reversal preview

Stop reconciliation consumers before reversal. Never run this if a T13 audit event or allocation exists; preserve evidence and reconcile forward. The SQL below retains T11 observation rows and is only safe while all new observation fields are untouched. On the empty local rehearsal DB it may reverse 0040, after which the inspector must report the ledger behind. A later app build that requires 0040 cannot be deployed against that state.

```sql
begin;
lock table payment_proof_allocations, payment_reconciliation_events,
  nar_import_payment_observations in access exclusive mode;
do $guard$ begin
  if exists (select 1 from payment_proof_allocations)
    or exists (select 1 from payment_reconciliation_events)
    or exists (
      select 1 from nar_import_payment_observations
      where revision <> 1 or invoice_ref is not null or amount_minor is not null
        or currency is not null or proof_version_id is not null
        or reviewed_by is not null or reviewed_at is not null
        or decision_reason is not null or status = 'exception'
    )
  then raise exception 'T13 evidence exists; retain schema and reconcile forward';
  end if;
end $guard$;
drop table payment_proof_allocations;
drop table payment_reconciliation_events;
drop index nar_import_payment_observations_matched_invoice_uidx;
alter table nar_import_payment_observations
  drop constraint nar_import_payment_observations_status_check;
alter table nar_import_payment_observations
  add constraint nar_import_payment_observations_status_check
  check (status in ('pending_review','matched','rejected'));
alter table nar_import_payment_observations
  drop column revision, drop column invoice_ref, drop column amount_minor,
  drop column currency, drop column proof_version_id, drop column reviewed_by,
  drop column reviewed_at, drop column decision_reason;
delete from schema_migrations where id = '0040_payment_reconciliation.sql';
commit;
```
