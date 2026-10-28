# Today failed-refresh recovery

Baseline: bb5c9d34d1f4ec0864cc65f7ba66653752218af0, draft PR #147, branch codex/cosec-20261023.

Today already offered explicit retries, but cached annual-return/other-business rows and case links remained visible after a denied refresh; cached totals also remained in view labels. Retry clicks could cancel and restart a pending read. Those stale rows/links and totals are now hidden while their own read is fetching or failed, with list loading feedback during refresh. Successful empty reads alone show the normal empty state.

Each of the three failed-read buttons is disabled while fetching and uses cancelRefetch:false so same-turn clicks share the pending read. Recovery only reads its own list or metrics; successful independent queries are not refetched, navigation is not invoked and no mutation is replayed. Existing query keys, actor/filter scopes, retained-page cache behavior, first-page navigation, next-page guards and validated return context remain unchanged. Retained data remains cached but cannot expose case links while its current read is unverified.

Three new regression scenarios reproduce cached denial and verify hidden stale annual rows/links, other-business rows/links and metrics, pending/deduplicated retries, fresh totals, successful empty restoration, independent read counts and no navigation. Before repair all three failed (3 failed / 4 passed). Final focused Today/work-queue/work-view tests pass. Focused read-only review reported no important issues. Tests use JSDOM with mocked read RPCs and a controlled active actor; there are no real server, storage or database operations.

This is bounded Today read/display recovery, not a repair to standalone work-queue mutation/retention protocols, queue scheduler freshness, SLA semantics, Hong Kong calendar approval, duplicate-open navigation across tabs or upload reload/lost-intent recovery. Real Auth/session/HTTP/RLS, queue data accuracy, complete daily-use journeys, device/accessibility and load performance remain Native gates. Displayed deadline values still depend on the existing server/calendar rules.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. Same-candidate artifact/required CI/security/DB/Auth binding, complete Today-to-case/action/readback journeys, actual storage/scan/restore, approved calendar/UC134, scheduler, device/performance and provider/filing gates remain outstanding. Original acceptance rows and approvals are unchanged. Historical build receipts do not bind this source. No build, DB integration, hosted CI green, Native execution, deploy/promote or production Vercel/Neon changes occurred. PR #147 remains draft and unmerged.

Initial changed-file lint/format checks found test-fixture formatting errors despite the first formatting write. A second formatting pass corrected them; final lint and formatting checks passed. The first broad unit attempt was deliberately stopped (143) while making that correction and is not a completed acceptance run. Original lint/format failures and interrupted unit log are retained. Product behavior did not change for this correction.

Product commit: `bfb3722bdb8abdb42a92b135621cb663c074f2f4` — `fix(today): hide unverified queue results and deduplicate read retries`.

Final local verification: **2,904 passed / 290 unit/component files**; focused **42 passed / 3 files**, included in that total. Typecheck, changed-file ESLint/Prettier and final diff checks exit 0. Existing Vite path-resolution and route-export warnings remain. Commands, fingerprints and original failure/interruption logs: [receipt.json](receipt.json). No product source changes after final checks.
