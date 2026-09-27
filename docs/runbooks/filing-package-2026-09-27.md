# T14 filing package: local evidence and release gate

T14 separates preparation, human approval and download. Preparation builds the manifest from case requirement instances, the current document versions and page references, genuine provider scan identity, human review decisions and the T13 reconciled payment allocation. The server reads each cited R2 object and verifies actual bytes against the version hash before building a ZIP. The exact canonical manifest is inside the ZIP. `filing_packages` holds immutable manifest, ZIP object key/hash/size and revision; only draft to approved is mutable. Approval uses the existing completion-level case permission (Admin, case team Manager or assigned reviewer), rechecks the current source snapshot and stored artifact, and records an audit event in the same transaction. Preparation uses the operational case permission and records its own audit event. A failed ZIP generation or R2 readback leaves no approved row; an orphaned content-addressed object can be retried or cleaned after review. Repeating a valid draft preparation returns the same revision.

The UI exposes Prepare package, Approve package and Download approved ZIP. The former Submit packet command is gone. Generic status updates cannot set `NAR1 prepared` or `Filed`. Download is an authenticated GET with no-store response, safe filename, current manifest recheck and stored-byte SHA-256 verification. The browser creates a temporary object URL and revokes it after 30 seconds. Download does not record external submission; T15 owns that step. Demo stays read-only.

## Local verification

- RED: the previous manifest ignored payment changes and accepted unknown-safety evidence; the previous Submit packet command changed case status without a package. Named T14 tests reproduced all three.
- GREEN: focused package tests exercise document/requirement/payment hash changes, missing human decision, unknown safety, Client rejection before package lookup, deterministic repeat ZIP reads and tamper detection. Disposable PostgreSQL integration tests run prepare, idempotent retry, approve, two identical downloads, check audit rows, refuse repeat approval, and reject download after requirement or payment revocation. Tests use transaction rollback fixtures; no production data was modified.
- Migration 0041 applied on two disposable PostgreSQL 17 databases. `db:inspect` reported `current`, no missing/unknown/definition mismatch, and `canRelease=true` locally. On the empty second database, the guarded reversal changed the inspector to `behind` and `canRelease=false`; reapplying 0041 restored `current` and `canRelease=true`.
- Final local suite: 198/198 files and 1802/1802 tests, including rollback-only Postgres fixtures. Typecheck and build passed; lint had zero errors and one pre-existing Fast Refresh warning. All 13 dev-server routes and import-protection passed after a bounded 30-second cold-compile allowance (the initial 15-second home-route limit timed out twice). `verify:firm --dry-run` did 38 reads, zero network calls and zero writes. A passing local build or CI does not prove production scanner, R2, DB or filing provider readiness.

## Production gate

T00 read-only production comparison found migrations 0021 to 0033 absent and an unknown legacy `0006_client_register.sql`; the deployed DB binding is unverified. Before any separately authorized production mutation, identify the exact DB branch and deployed SHA, inspect ledger/catalog and migration definitions, verify a backup/restore point, rehearse the full migration path and apply 0041 only after 0040. Confirm the live scanner is configured, returns genuine provider verdicts on exact stored bytes, and R2 readback preserves checksum and size. Pilot with authorized staff and non-sensitive evidence: verify a reviewer can approve, an assigned Staff who is not reviewer cannot approve, another company Client cannot obtain bytes, a revoked payment or replaced document invalidates the package, and no download marks a case Filed or Submitted. Production DB migration, live send, invite and deployment require separate authorization.

## Guarded reversal preview

Stop package consumers first. Never reverse if any package revision exists: preserve approvals, object hashes and audit history, and repair forward. This reversal is safe only while `filing_packages` is empty; it was exercised solely on the disposable local DB.

```sql
begin;
lock table filing_packages in access exclusive mode;
do $guard$ begin
  if exists (select 1 from filing_packages) then
    raise exception 'T14 package revisions exist; preserve approved artifacts and reconcile forward';
  end if;
end $guard$;
drop table filing_packages;
drop function enforce_filing_package_immutability();
delete from schema_migrations where id = '0041_filing_packages.sql';
commit;
```
