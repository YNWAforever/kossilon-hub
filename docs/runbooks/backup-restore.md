# Backup And Restore Runbook

## REQUIRES EXPLICIT APPROVAL: Rehearsal

1. Create a timestamped logical backup from the approved Neon staging branch.
2. Restore it into an isolated database.
3. Run `npm.cmd run db:migrate` against the restored database.
4. Run the repository integration tests with `TEST_DATABASE_URL` pointing at the restore.
5. Record row counts for `companies`, `annual_return_cases`, `documents`, `document_upload_intents`, `work_items`, `notification_outbox`, and `timeline_events`.

Approval is required before any staging or production backup export, restore, destructive cleanup, or retention-policy change.

## Rollback evidence

Keep the migration identifier, restore timestamp, schema checksum, and test output together. Never place connection strings or access tokens in the evidence bundle.
## Pre-pilot blocker

Backup readiness remains blocked until an approved Neon staging branch is available for a non-destructive rehearsal. The dry-run verifier records this as the backups blocked gate and performs no export, restore, cleanup, or retention-policy change.
