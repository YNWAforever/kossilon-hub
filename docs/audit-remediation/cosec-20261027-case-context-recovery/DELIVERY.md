# Case notes/history read recovery — local continuation

Product commit: `aada9b4b107f5e4c754d76e72eb84b4323ceaa13`.

Baseline: `dcc77d2ee063fe14ca8a65d445cece61579b44f1`, draft PR #147, `codex/cosec-20261023`. Re-read live PR and remaining coverage/blockers. The completed payment, preview, findings, party and case-detail read recoveries are unchanged. This slice addresses the independent case-context lists.

## Bounded repair

Failed notes and audit-history reads displayed errors without in-panel recovery. Reloading the whole case could discard an unsaved note draft and reload unrelated data. Each failed panel now offers its own list retry, disabled during fetching and deduplicated with `cancelRefetch:false`.

A notes retry only calls the notes query; a history retry only calls history. Neither invokes case commands, invalidates other queries, reloads the case or resets the draft. Existing loading/error/empty rendering and query retry policy remain unchanged. A denied cached refresh stays in the error view; repeated failure still allows explicit retry, and a successful empty response alone restores the empty state.

This does not change note-write unknown-result reconciliation, general background-refresh policy, actor/session/cache isolation or persisted audit semantics. No full staff-journey readiness claim is made.

## Evidence

- `red.txt`: **5 failed / 14 passed** before repair.
- `targeted.txt`: first repaired run **2 failed / 48 passed**. Two cached-denial tests asserted before React rendered the query-error notification. They now wait for the visible alert before checking that cached rows are hidden; no production change was needed for this timing correction.
- `targeted-final.txt`: **50 passed / 3 files**, including **5 new cases** across notes/history and both-failed independence, plus existing case-detail/findings/party interactions. Covers pending/deduplicated retries, fresh records, draft preservation, unchanged other-list/case read counts, denied cached data, repeated failure, successful empty recovery, and no case-command replay.
- Focused independent review reported no findings; reviewer ran no tests.
- Tests exercise actual React/TanStack interactions in JSDOM with server boundaries mocked. They prove UI state and read/command payloads, not persisted notes/audit entries, real Auth/HTTP/RLS, navigation or full employee journeys.
- `receipt.json` records final commands, outcomes and file fingerprints. Logs preserve output with trailing blank lines normalized. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Final full local unit/component suite: **2,845 passed / 290 files**, exit 0 (`unit.txt`). Targeted 50 are included, not added again. Typecheck, changed-file ESLint/Prettier and final delta diff checks: exit 0.

## Remaining gates — BLOCKED / NO_GO

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS**. Still required: same-candidate deployed artifact and required CI/security acceptance; actual DB catalog/ledger/application-role compatibility; real Auth/roles, cross-team/account-switch/revocation/session/RLS/HTTP concurrency; complete Today → case → documents/payment → safe action → independent readback → return/reload; actual storage/scan, approved Hong Kong calendar/UC134, scheduler ticks, backup/object restore, accessibility/device/performance and provider/filing receipts or accepted manual handoff.

No deploy/promote, merge, ready-for-review transition, production Vercel/Neon change, DB integration, build, hosted CI green or Native execution is claimed. Original acceptance rows and approval records are untouched. Historical build receipts do not bind this source delta. Delivery is limited to this fix, local tests/evidence, focused commits, push to the same branch and draft PR-description update.
