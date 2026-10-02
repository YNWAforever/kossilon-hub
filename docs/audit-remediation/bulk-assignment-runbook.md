# Bulk owner / reviewer assignment

## Candidate scope

T13 uses the existing annual-return and work-item assignment services. Only current verified Admin or Manager identities may preview or approve a job. Each item re-reads the original approving identity, team, resource scope, active assignee, separation rule and version inside its assignment transaction. The domain mutation, existing audit event and durable item result commit together. This service has no notification or external-provider side effect.

Selections are explicit IDs across loaded pages, or a server-owned immutable filtered snapshot plus explicit exclusions. A changed filter clears selection and preview; an actor change also clears saved-job UI state. Newly matching rows are outside an existing snapshot. Server limits are 5,000 explicit IDs or 20,000 filtered IDs; larger selections require narrower filters. Snapshot and preview expiry is 30 minutes. Approval binds the actor, assignment and frozen payload to an idempotency key. Reusing a key for a different payload fails.

## Process and inspect

1. Select records, choose a current named employee and owner/reviewer responsibility, then preview server counts and refusal reasons.
2. Approve the fixed preview to create a durable job. Creating a job is not a claim that all items succeeded.
3. Inspect the saved job or resume at most 100 items explicitly. Reloading the page permits retrieving the saved job and cursor results. The existing authenticated maintenance pass `runBulkAssignments` also processes one chunk of at most 100 items per tick. Neither the page nor worker automatically retries failed or unknown items.
4. Review succeeded, pending, locked, forbidden, conflict, failed, unknown and cancelled counts independently. Names and IDs disappear from results when current scope is lost. Export includes only currently authorized item results; export is not submission.
5. Cancel stops only pending items after the in-flight transaction has finished. Already committed successes remain. Cancelling a finished job reports zero and retains its state.
6. Explicit retry applies only to failed items with confirmed transaction rollback (Postgres serialization/deadlock). Conflicts require a fresh preview. Unknown SQL assignment outcomes first need explicit reconciliation: an unchanged original aggregate version permits resumption; a changed version remains a conflict. This SQL-only rule must never be reused to retry an external send with an unknown result.

Attempt history and explicit cancel/retry/reconcile actions remain attributed in each item's durable result. Successful items never return to pending. A crashed worker's lease expires after 30 seconds; a new token fences the old worker. Concurrent foreground/background workers share the same job lock and item transactions.

## Migrations and release gates

- `0072_durable_bulk_assignment.sql` adds separate immutable selection/preview and job/item tables. It preserves the notification outbox and historical bulk tables.
- `0073_bulk_maintenance_job_kind.sql` adds this SQL-only job kind to the existing maintenance registry. It recognizes the exact previous or new constraint, rejects unknown physical contracts and retains all registry rows. Both migrations have only been applied to isolated local Postgres.
- Production still requires the T01 physical schema review, a fresh restore point, explicit migration/deployment approval, and exact tenant/database/build validation. Scheduler owner remains controlled by the existing release process; adding code does not activate a scheduler.
- Three fresh native scheduler invocations correlated to platform logs are a separate Operations acceptance gate. Local/manual invocation and injected sessions do not satisfy it. Controlled fresh Auth identities remain an Auth-owner dependency.

## Rollback and compensation

Pause the candidate's scheduler through the approved Operations process and stop creating new jobs before a code rollback. Preserve snapshots, previews, jobs, results, versions and domain audit events. Do not delete successful assignments or rewrite the migration ledger. A previous build does not recognize `0072`/`0073`; review its schema gate before selecting it as the rollback build.

To reverse a successful assignment, create a fresh authorized preview assigning the intended former user against current versions. Review intervening work and current separation/eligibility; this is a new attributed assignment, not deletion or a replay of the old job. Unknowns and conflicts remain visible until reconciled or superseded by a reviewed new preview.
