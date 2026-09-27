# T22 work-queue bulk assignment slice (in progress)

This local slice connects production work-queue selection to the existing T09 `assign` preview/commit/runner. It does not complete T22's annual-return case, client, tags or cross-surface assignment scope. Demo has no bulk controls. No production data, recipient, access role or deployment was changed.

## Local behavior

The shared selection state deduplicates IDs across pages, caps the selection at 1000, clears it when the view/filter/search changes, and selects only final `failed` items for a new preview. The sticky toolbar exposes selection and clearing. The work-queue dialog lists each currently loaded item's old owner/team and proposed owner/team; it calls the T09 server preview before commit. The preview reports eligible, skipped and conflict counts. Commit uses one stable idempotency key, and the existing T09 runner rechecks each item's current actor scope/version/assignee rules and invokes the single-item assignment service in the same transaction as attempt evidence. The operation ID is saved in the work-queue URL; progress can be reopened after navigation. Results export uses the existing authorized T09 CSV endpoint, which neutralizes spreadsheet formulas.

Only selected work-item IDs are sent to preview. The current work queue loads its authorized open/in-progress/blocked rows; it has no cross-page server cursor. The toolbar therefore says **current view** and does not claim to select every matching row in the database. An operation queued in the UI requires the existing authorized maintenance scheduler to run; downloading a partial result is not proof that all assignments completed.

## Local evidence

- `t22_scenario_1`: missing selection module RED, then 401 distinct cross-page IDs, filter reset and failed-only retry GREEN 1/1.
- Focused selection plus existing work-queue case-link/audit regression: 3/3 files, 7/7 tests.
- Typecheck and build passed; lint zero errors with one existing `react-refresh/only-export-components` warning in `src/routes/work-queue.tsx`.
- No production runtime or browser session with a real Admin/Manager profile was available. The local checks prove code and contract behavior, not a live scheduler or deployed batch.

## Remaining T22 work

1. Add a versioned annual-return case assignment handler that calls the existing single-case `assignOwner` transaction per item, including linked active work items, and returns individual cross-team/inactive-owner/locked-case decisions. Do not treat T09 work-item assignment as a case-owner change.
2. Add case/client page and all-matching filter selection with bounded server snapshots, complete preview of old/new owner and team, and explicit retry of only failed items. Keep filter changes from silently broadening selection.
3. Add authorized tags and CSV export on the case/client surfaces. Verify formula neutralization and row authorization with the real selected scope.
4. Run the named `t22_scenario_2`, full disposable-Postgres suite, browser interaction and remote CI. Keep the task `in-progress` until those gates pass.
