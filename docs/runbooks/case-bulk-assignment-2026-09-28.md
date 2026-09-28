# T22 case-owner bulk assignment, local slice

This slice extends the existing T09 durable preview, commit and per-item runner with a separate `caseAssign` action. It keeps the production demo read-only. No production database, recipient, account permission or deployment was changed.

## Behavior

- The production annual-return board offers current loaded pages and all cases matching its URL filters. The all-matching path pages through the existing case read model with the same query, owner, status, risk and overdue filters. It freezes at most 1000 IDs, applies explicit exclusions, and rejects a scan longer than 100 pages rather than truncating silently. Filter changes clear the selection. The operation ID stays in the URL for progress, authorized CSV and failed-only re-preview.
- Preview persists a 15-minute hash of selected case IDs, assignment revisions and per-item decisions. It shows old/new owner and team for authorized cases. A Manager receives only `CASE_OUT_OF_SCOPE` for a foreign or unavailable explicit ID; owner, team and revision are hidden in preview and operation output. The target must be an active provisioned staff member. For Managers, inactive and foreign-team target IDs share the same `TARGET_UNAVAILABLE` result and do not reveal the target team. Locked cases, inactive targets, cross-team rows and already assigned owners are decided per item.
- Commit rechecks the actor and preview hash, then enqueues only eligible items with a stable idempotency key. One changed case does not block unrelated cases. Each runner item rechecks actor, target, case scope and assignment revision under locks, calls the existing `assignOwner` domain service, and records the domain audit reference in the same transaction. That service synchronizes active linked work items and writes their assignment events. A failed transaction rolls back owner, linked work items and item evidence together; a later runner pass can resume without duplicate audit. Deterministic conflicts are not retried as unknown provider sends.
- The existing authorized CSV endpoint exports only operation IDs, selected resource IDs, fixed state/reason codes, revision numbers for authorized items, and audit references. Formula-like cells are neutralized. It carries no company name, contact details, owner/team metadata or provider payload.

## Schema and rollback rehearsal

- `0048_case_assignment_revision.sql` adds positive `annual_return_cases.assignment_revision`. Single-case assignment also increments it. A stale expected revision refuses to overwrite another assignment.
- `0049_bulk_case_assign_action.sql` enables `caseAssign` in the T09 preview and operation checks.
- Both migrations were applied only to disposable PostgreSQL. The 0048 empty rollback/reapply passed earlier; its nonempty evidence guard refused rollback. The 0049 empty rollback moved the ledger to `behind` with `canRelease=false`, then reapplication restored `current`. 0048 refuses rollback while 0049 exists. A synthetic `caseAssign` preview in a transaction made 0049 rollback refuse; the transaction left zero synthetic previews.
- SQL rollback scripts are `case-assignment-rollback-0048.sql` and `bulk-case-assign-rollback-0049.sql`. Production schema and legacy 0006 migration ledger still require separate read-only reconciliation and authorized mutation planning.

## Test evidence and scope

- RED: stale second case-owner assignment overwrote the first; foreign-team preview exposed owner/team/revision. Both assertions failed for the intended defects before changes.
- GREEN: named `t22_scenario_1` selection; named `t22_scenario_2` per-item authorization and durable mixed batch; linked work item owner/version/event; crash after domain write then resume with one case audit; exact all-matching filter/exclusion and owner/team preview; the foreign-case and foreign-target metadata redaction.
- RED then GREEN: generic commit mistakenly accepted a forged `importApply` preview after adding `caseAssign`; it now accepts only `assign` and `caseAssign`. The approved import apply integration test still passes (focused 3 files, 14/14 tests).
- Focused disposable-Postgres and route regression run: 7 files, 50/50 passed after fixing AuthProvider-dependent rendering and listing the new DB test in the serialized project. The first full-suite pass found those regressions. Final full-suite run: 212/212 files, 1861 passed, 2 skipped. Final typecheck and build passed; lint had zero errors and one existing Fast Refresh warning. `verify:firm --dry-run` made 38 reads, zero network calls and zero writes.
- Remaining T22 scope: client register bulk assignment and tags, work-queue all-matching filters/tags, a real authenticated browser pass and production runtime evidence. Keep T22 `in-progress` until those gates pass.
