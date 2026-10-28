# Backup And Restore Runbook

## REQUIRES EXPLICIT APPROVAL: Rehearsal

1. Create a timestamped logical backup from the approved Neon staging branch.
2. Restore it into an isolated database.
3. Read the restored ledger and full catalog first. Run `npm.cmd run db:migrate` only for a verified contiguous source history. Historical divergent databases must retain the ordinary migrator's refusal and use a separately reviewed, exact-target historical release package. A logical restore may renumber internal dropped-column slots, so re-observe the strict package guard; never bypass a fingerprint refusal.
4. Run the repository integration tests with `TEST_DATABASE_URL` pointing at the restore.
5. Record row counts for `companies`, `annual_return_cases`, `documents`, `document_upload_intents`, `work_items`, `notification_outbox`, and `timeline_events`.

Approval is required before any staging or production backup export, restore, destructive cleanup, or retention-policy change.

## Rollback evidence

Keep the migration identifier, restore timestamp, schema checksum, and test output together. Never place connection strings or access tokens in the evidence bundle.

## Same-version local rehearsal evidence

A synthetic, disposable rehearsal can establish local mechanics while approved Neon staging and production gates remain blocked. It does not replace a provider backup, application-role/RLS test, native Auth/HTTP/browser recovery, object-storage restore or production RTO/RPO acceptance.

- Verify exact repository/HEAD/executing bytes and the owned disposable target before any DB client, fixture, dump, restore or cleanup. Require container/project identity, immutable image, endpoint/port mapping, no shared mounts and actual server/DB/user identity; loopback, a test name or a historical fixed port is insufficient. Old fixed-target historical rehearsal scripts are not authorized by this runbook alone.
- Record precise synthetic record IDs, the real migration ledger and all public row projections plus the complete physical catalog/role contract. Row counts alone cannot detect a value changed in place. Retain correct existing full-row/catalog comparison logic.
- Bind a custom-format logical dump to its SHA256, source version, target/server identity and recovery point. Restore only to a newly verified empty DB, with exit-on-error and a single transaction. Do not replay migrations or seed over a failed or divergent restore.
- Verify complete restored data/catalog and representative application case reads with allowed and denied roles. A GET may perform lazy writes: its actual write point must pass schema admission too. A missing catalog fact must not silently create case parties during readback.
- Counter-check a truncated archive leaves no partial user schema, an equal-row-count data change fails full projections, and missing DDL fails catalog/admission. Preserve original failure output and roll back controlled data/catalog faults.
- Record local elapsed restore plus readback time separately from operational RTO. A source marker committed after the dump demonstrates the backup recovery point and possible lost-write interval; it does not prove a production zero-loss RPO or an SLA.
- Dispose only of the exact owned resources after final identity/data-inventory checks. Whole owned tmpfs disposal can remove immutable synthetic history without disabling retention triggers. Keep the target IDs, archive checksum, timings, raw outcomes, source fingerprints and cleanup proof together.

Current local checkpoint: UC193 and the UC189 GET party-seed prerequisite are recorded under `docs/audit-remediation/cosec-20261024-restore-5aa3e18c/`. Consult its concrete candidate and blockers; the directory name is not an authorization or a success receipt.

## Pre-pilot blocker

Backup readiness remains blocked until an approved Neon staging branch is available for a non-destructive rehearsal. The dry-run verifier records this as the backups blocked gate and performs no export, restore, cleanup, or retention-policy change.
