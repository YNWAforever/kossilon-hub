# T15 manual external submission: local evidence and release gate

T15 adds an explicit human-recorded external submission after T14 package approval. The production case page selects a current reviewed submission/receipt proof, HKT submission time, destination and external reference. The server checks staff case permission, exact approved package revision and current manifest/artifact bytes, same-case proof with genuine provider scan and matching stored bytes, and plausible time. It writes one manual package_handoffs record and audit event in one transaction. Replay with the same identity returns the existing record; a different live handoff is rejected. Download alone leaves no submission. The recorded_submission state is separate from connector transmission, acknowledgement, Filed and Completed. Demo remains read-only. No external connector is called.

## Local verification

- RED: the named scenarios found that recorded_submission was not treated as already out and the service was a stub (2 failed, 1 passed). GREEN unit 3/3.
- Disposable PostgreSQL integration checks exact-once replay and audit, no handoff after download, HKT to UTC, wrong proof category, wrong revision, preapproval time, unassigned Staff and Client refusal, stale evidence and a newer package invalidating the old approval.
- Component interaction requires a reviewed proof and explicit destination, reference and HKT time. It never updates case status.
- Migration 0042 applied on two disposable PostgreSQL 17 databases, including the final evidence constraint on the second. There db:inspect reported current, zero missing/unknown/definition mismatches, all seven capabilities ready and canRelease=true. On the first disposable database, the empty-only reversal succeeded, db:inspect changed to behind with submissions unready and canRelease=false, and reapplying 0042 restored current with all seven capabilities ready.
- Final full local suite: 199/199 files and 1809/1809 tests passed with DATABASE_URL and TEST_DATABASE_URL both pointing to the same disposable database. An earlier run with only TEST_DATABASE_URL passed 1807 tests and failed two T07 runtime tests because DATABASE_URL was absent; rerunning with both variables passed. After scoped formatting and a Unicode-control validation edit, affected tests passed 14/14, typecheck and build passed, lint had zero errors and one pre-existing Fast Refresh warning, all 13 dev routes and import protection passed, and verify:firm dry-run made 38 reads with zero network calls or writes. These are local gates.
- Local evidence does not prove that the deployed DB has migration 0042 or that any external registry received a file.

## Production gate

T00 read-only comparison found audit deployment SHA 3af665418dae4afe14ce91dd194fdfecde10dda4 and an observed Neon ledger with 21/33 entries, unknown legacy 0006_client_register.sql and migrations 0021–0033 absent. Exact deployed DB binding remains unverified. Before separately authorized production mutation, identify that binding, reconcile legacy ledger, verify backup/restore and migration order 0021–0042, review locks and row counts, and use a maintenance window. A live pilot requires an authorized staff actor, approved current package, non-sensitive external filing and genuine provider-reviewed proof; check registry receipt/return independently. No production DB change, external send, invite or deployment is authorized here.

## Guarded reversal preview

Stop submission consumers. Reverse only if all 0042 columns are empty on every handoff and no T16 return depends on them. If manual evidence exists, preserve identity, proof and audit trail and repair forward. The SQL below is for a disposable local rehearsal only.

```sql
begin;
lock table package_handoffs in access exclusive mode;
do $guard$ begin
  if exists (
    select 1 from package_handoffs
    where package_id is not null or submission_mode is not null
      or destination_label is not null or proof_version_id is not null
      or submitted_at is not null or recorded_at is not null
      or status = 'recorded_submission'
  ) then
    raise exception 'T15 submission evidence exists; preserve records and repair forward';
  end if;
end $guard$;
drop trigger package_handoffs_manual_identity_before_update on package_handoffs;
drop function enforce_manual_submission_identity();
drop index package_handoffs_manual_reference_uidx;
drop index package_handoffs_manual_package_uidx;
drop index package_handoffs_live_uidx;
alter table package_handoffs
  drop constraint package_handoffs_manual_evidence,
  drop constraint package_handoffs_transmission_agrees,
  drop constraint package_handoffs_status_check,
  drop column package_id,
  drop column submission_mode,
  drop column destination_label,
  drop column proof_version_id,
  drop column submitted_at,
  drop column recorded_at;
alter table package_handoffs add constraint package_handoffs_status_check
  check (status in ('prepared','transmitted','acknowledged','returned','failed','cancelled'));
alter table package_handoffs add constraint package_handoffs_transmission_agrees
  check (
    (status in ('prepared','failed','cancelled') and transmitted_at is null)
    or (status in ('transmitted','acknowledged','returned') and transmitted_at is not null)
  );
create unique index package_handoffs_live_uidx on package_handoffs (case_id)
  where status in ('prepared','transmitted','acknowledged');
delete from schema_migrations where id = '0042_manual_package_submission.sql';
commit;
```
