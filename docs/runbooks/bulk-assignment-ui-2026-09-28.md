# T22 work-queue bulk assignment slice (in progress)

The annual-return case-owner extension is documented in `case-bulk-assignment-2026-09-28.md`. T22 remains in progress for the client register, tags and authenticated browser evidence.

This local slice connects production work-queue selection to the existing T09 `assign` preview/commit/runner. The annual-return case-owner slice is documented separately; the client register and tags remain. Demo has no bulk controls. No production data, recipient, access role or deployment was changed.

## Local behavior

The shared selection state deduplicates IDs across pages, caps the selection at 1000, clears it when the view/filter/search changes, and selects only final `failed` items for a new preview. The sticky toolbar exposes selection and clearing. The work-queue dialog lists each currently loaded item's old owner/team and proposed owner/team; it calls the T09 server preview before commit. The preview reports eligible, skipped and conflict counts. Commit uses one stable idempotency key, and the existing T09 runner rechecks each item's current actor scope/version/assignee rules and invokes the single-item assignment service in the same transaction as attempt evidence. The operation ID is saved in the work-queue URL; progress can be reopened after navigation. The shared progress panel can cancel remaining queued or failed items through T09's authorized cancellation service; already started and completed evidence remains. Results export uses the existing authorized T09 CSV endpoint, which neutralizes spreadsheet formulas.

The work queue's existing server read loads the complete authorized open/in-progress/blocked queue for the chosen Mine/Team/Breached view with no server page cap. The UI now renders 50 rows per page. **Select current view** sends explicit IDs from that page. **Select all matching filter** sends the view, owner, work type, SLA, priority, status and text filter plus exclusions to the T09 server preview. The server repeats the actor-scoped queue read, applies the same shared display predicate, freezes matching IDs and versions in the preview, and persists the exact filter. Preview refuses more than 1000 matches rather than silently truncating. Page and text filter stay in the URL alongside the existing filters and operation ID. A concurrent queue change is handled by T09's per-item preview and runner rechecks. The preview count is authoritative; the UI count is only the currently loaded view. An operation queued in the UI requires the existing authorized maintenance scheduler to run; downloading a partial result is not proof that all assignments completed.

## Local evidence

- `t22_scenario_1`: missing selection module RED, then 401 distinct cross-page IDs, filter reset and failed-only retry GREEN 1/1.
- Queue all-matching preview: a disposable-Postgres RED test failed because the T09 schema refused the new queue filter; GREEN proved the server persisted the filter and applied an exclusion. The same display predicate now runs in UI and server preview; a row added after preview remained outside the committed operation.
- Before the cancellation UI, focused T09/T22 disposable-Postgres and route regression passed 4/4 files, 16/16 tests. The full suite with `TEST_DATABASE_URL` and `DATABASE_URL` pointing only to the disposable database and `DATABASE_SSL=false` passed 212/212 files, 1862 passed, 2 skipped. After wiring the cancellation button, the existing durable cancel test passed 1/1, typecheck and build passed, and formatting passed. The earlier full lint run had zero errors and one existing `react-refresh/only-export-components` warning in `src/routes/work-queue.tsx`.
- PR #87's server-filter head passed GitHub verify and Vercel preview checks; the final cancellation head awaits its own remote checks. No production runtime or browser session with a real Admin/Manager profile was available. The local checks prove code and contract behavior, not a live scheduler or deployed batch.

## Remaining T22 work

1. Add client register bulk assignment with the existing single-client authority and audit path. Keep case-owner assignment separate from a company/client owner change.
2. Add authorized tags to the applicable case, client and work-queue selection surfaces using a versioned per-item domain action.
3. Verify the case and work-queue controls in an authenticated browser with a real Admin/Manager profile. No production runtime or provider bindings were available for this local slice.
4. Keep T22 `in-progress` until the client, tag, browser and runtime gates pass. See `case-bulk-assignment-2026-09-28.md` for the versioned case-owner implementation and full local test evidence.
