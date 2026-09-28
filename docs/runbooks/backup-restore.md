# Backup and restore runbook

## Local evidence and scope

T28 rehearsed an upgrade from migrations 0001–0060 to 0061 against a populated disposable PostgreSQL database and checked the new ledger, outbox states and schema capabilities. T29 used a disposable local dump and isolated restore (`kossilon_t29_restore_bc2ab304`): nine table counts matched, `db:inspect` found a current ledger and 12/12 capabilities, and package integration passed 8/8. This did not export or restore a staging or production backup. No joint database and R2 restore has been verified. Production backup readiness is therefore still a release blocker.

## Approval gate for a non-local rehearsal

A named owner must approve the exact database branch, storage bucket, snapshot time, data handling and restore destination before any staging or production export, restore, cleanup or retention change. Keep the destination isolated. Never use a production connection string as the local test target.

1. Record the source database ID, schema ledger, deployment commit, R2 bucket/version policy and timestamp. Record only redacted counts and hashes in the evidence bundle.
2. Create a timestamped logical or platform snapshot under the approved procedure, together with a matching R2 object-version inventory and manifest. Freeze or account for concurrent writes during the consistency point.
3. Restore into an isolated database and isolated object store namespace. Apply only the approved forward migrations. Do not run a data-deleting down migration.
4. Check ledger and schema capabilities; compare counts for companies, annual-return cases, documents and versions, upload intents, packages, handoffs, returns, work items, outbox, provider attempts and timeline events. Check representative document object bytes against recorded version checksums, including quarantined and superseded versions.
5. Run the repository's seeded integration tests against the isolated restore, then a read-only application journey and an authorized document download. Verify a failed/unknown send and a partial return remain unresolved after restore.
6. Record restore start/end, row and object discrepancies, tests, reviewer decision and the exact rollback reference. Only an approved release owner may decide whether to switch traffic.

## Failed migration or release

Stop consumers and external dispatch. Capture the failed migration ID, transaction outcome, outbox state and deployment ID. Rehearse recovery from the named pre-change snapshot in isolation, compare provider receipts to attempts, and preserve unknown outcomes for human reconciliation. Do not replay a send whose provider outcome is unknown. Confirm application compatibility with the restored schema before any deployment rollback.

Keep URLs, keys, document bytes and personal data out of the evidence bundle. The release gate stays NO-GO until the joint DB/R2 restore and provider-outcome checks have actual approved runtime evidence.
