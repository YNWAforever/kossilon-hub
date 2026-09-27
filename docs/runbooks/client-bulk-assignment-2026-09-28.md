# T22 client register bulk owner assignment (local slice)

This slice extends the existing T09 durable preview, commit and per-item runner with `clientAssign`. The production client register now has 50-row pages, selection of the current page or all rows matching the current filter, exclusions, a sticky selection toolbar, owner/team preview, explicit queue approval, operation progress, cancel, failed-only retry and authorized operation-results CSV. Filters, page and operation ID stay in the client URL. Demo stays read-only.

The server resolves filter selections under the authenticated Admin/Manager scope and freezes at most 1000 client IDs with their assignment revisions. Explicit IDs outside scope return a forbidden decision without owner, team or revision metadata. The preview lists the first 50 old/new owner and team decisions; it expires after 15 minutes. Commit rechecks actor and preview hash and uses T09's idempotency key. The runner rechecks actor, scope, target staff profile, active target team and revision for each item. It calls the existing `updateClient` domain service inside the same transaction as the timeline event and bulk attempt result. A failed item does not block other eligible items. A simulated failure after domain write rolled back the transaction; resume wrote one client audit event.

## Schema and rollback

- `0050_client_assignment_revision.sql` adds a positive client assignment revision. The single-client form sends its observed revision; stale edits cannot silently overwrite a newer owner/team change. A changed owner/team increments the revision.
- `0051_bulk_client_assign_action.sql` registers `clientAssign` in T09's preview and operation action constraints.
- Both migrations were applied only to disposable PostgreSQL. An isolated clone successfully rolled back 0051 then 0050 and reapplied both. Synthetic assignment evidence made the 0050 rollback refuse; a synthetic `clientAssign` preview made 0051 refuse. The failed transactions left no synthetic rows. The clone's schema inspection returned ledger `current`, no missing/unknown/definition mismatches and 11 ready capabilities.
- Guarded SQL is in `client-assignment-rollback-0050.sql` and `bulk-client-assign-rollback-0051.sql`. Production DB, legacy 0006 ledger and 0021–0051 rollout need separate read-only reconciliation and authorized mutation planning before any deployment.

## Local verification

- RED: stale single-client edit overwrote the newer owner; GREEN: client repository 35/35 tests on disposable PostgreSQL.
- RED: client bulk handler was absent, so the per-item client scenario failed; GREEN: 3/3 assignment-handler tests proved eligible, cross-team, inactive-target and stale-revision decisions.
- Durable clientAssign repository test passed with scoped filter and exclusion, redacted forbidden row, duplicate commit returning the same operation, mixed success/forbidden results, and crash/retry without duplicate audit.
- Client register interaction test passed with 51 clients across two pages, filter-change selection reset and all-matching exclusion. Existing demo route regression passed.
- Full disposable-Postgres suite: 212/212 files, 1866 passed, 2 skipped with `TEST_DATABASE_URL` and `DATABASE_URL` bound to local Docker and `DATABASE_SSL=false`. Typecheck and build passed. Full lint had zero errors and one existing Fast Refresh warning in `src/routes/work-queue.tsx`. `verify:firm --dry-run` made 38 reads, zero network calls and zero writes; provider and browser checks remained blocked.

The operation-results CSV endpoint returns fixed operational identifiers and reason codes, not client fields; it checks actor ownership and neutralizes spreadsheet formulas. A separate client-data CSV export and tag action are still open T22 scope. No production scheduler, authenticated live browser or provider runtime was available for this local slice.
