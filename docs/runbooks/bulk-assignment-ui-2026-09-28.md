# T22 work-queue bulk assignment slice (in progress)

The annual-return case-owner extension is documented in `case-bulk-assignment-2026-09-28.md`. T22 remains in progress for the client register, work-queue all-matching filters, tags and authenticated browser evidence.

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

1. Add client register bulk assignment with the existing single-client authority and audit path. Keep case-owner assignment separate from a company/client owner change.
2. Complete work-queue all-matching filters and authorized tags without claiming a loaded client-side view is the full database match.
3. Verify the case and work-queue controls in an authenticated browser with a real Admin/Manager profile. No production runtime or provider bindings were available for this local slice.
4. Keep T22 `in-progress` until the client, tag, browser and runtime gates pass. See `case-bulk-assignment-2026-09-28.md` for the versioned case-owner implementation and full local test evidence.
