# R12 — Operations observation freshness and Hong Kong time

Scope: follow-up audit on main `da82677bdeb35b9255425be61bd66abd295f5cc1`.
New findings F23 (unlabelled UTC timestamps) and F24 (stale cached health).
This is a source fix; it does not clear R01–R11 or production release gates.

## Reproduced problem

`repository.ts` normalizes operational timestamps to UTC ISO strings. The
Operations route sliced those strings without timezone conversion or a label.
For example, `2026-10-07T16:05:00.000Z` displayed October 7 16:05 rather than
Hong Kong October 8 00:05. Queue ages, last run/success and schedule rows used
that treatment; capability verification used raw ISO text.

The route did not poll. Server-derived health could remain green on an open
page after the scheduler became stale. Query retains cached data after a
refresh error; the route continued rendering it alongside an error message.

## Change

- Reuse the existing browser-safe `formatHongKongTimestamp` formatter for all
  operational timestamps; explicitly label Hong Kong time.
- Refresh each minute while the page is active and on window focus. Keep
  production reads disabled in demo mode. No background polling override.
- Add a manual refresh button and loading/paused/error states.
- Render health panels only after a completed successful read. Cached green
  labels remain hidden during refetch/reconnect, errors and paused requests.
  The last successful read time remains visible and is explicitly distinct
  from scheduler/provider success. Brief panel replacement during refresh is
  intentional so an unresolved read does not appear current.
- Preserve the server-derived state, existing staff authorization and unknown
  queue/dispatch semantics. No client-computed health or external side effects.

## Verification

Initial focused baseline: 4 files / 55 tests passed.
Initial test-harness failures were retained separately from the meaningful
RED: after allowing the lazy route to mount, 4 new behavioral tests failed
and the demo-mode test passed against unchanged source.

After the first fix, 5 files / 60 tests passed. A read-only independent reviewer
found one Important reconnect edge: a paused request switched to fetching and
temporarily restored the cached green state before receiving a response.
The added offline → reconnect → deferred-response test failed (1 fail / 5 pass)
before the final view gate, then passed. Final focused result: 5 files /
61 tests passed, including all 6 new route interaction cases.

The initial implementation attempted to import a Button component not present
in this repository. Typecheck and the test transform caught it; the final
implementation uses the repository's native-button pattern.

Typecheck, lint and production build passed on the final source. Lint retains
the pre-existing `work-queue.tsx` Fast Refresh warning. The full local test
command skips database tests when TEST_DATABASE_URL is absent; those skips are
not genuine database or provider acceptance. Exact counts are recorded in the
PR and the accompanying audit evidence pack.

Read-only release verifier remains `productionReleaseGate=NO_GO`: original
50 UAT retains 19 historical LOCAL ONLY passes and 31 blocked cases.

## Review and release boundaries

Review: zero Critical, one Important reconnect finding, addressed by the
regression and final view gate. Live provider health, deployed session
revocation and native cron operation were outside that local review.

Production alias inspection still identifies `aa5d3cb` / deployment
`dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`. PR124 is now merged into the dedicated
maintenance base, not main; merge does not prove deployment. The current
browser is signed out; no new authenticated business UAT is claimed.

No DB migration, dependency update, production deployment, role change,
provider message or scheduler trigger is included. This main-based change
must follow the existing historical-schema release process; do not cherry-pick
it into the isolated security patch without separate compatibility review.
Rollback is an ordinary revert of this source commit; no data rollback needed.

## 2026-10-09 dependency integration correction

Original head58860eb and its exact Operations route/six regression bytes retained. Its run37678792755 failed both existing low audit gates before tests. Ordinary merge6a3f61f incorporates separately reviewed R13 F25 pins/driver contracts; both published ancestors retained. Fresh npm install0vulnerabilities; actual new localhostPG18.6 full245files/2339PASS/0FAIL/0SKIP including sixOps+ten dependency contracts;50source bodies/seed onlylocal, lint0errors1baselinewarning/typecheck/build0; owned container+volume absence verified. Final master-ledger parenta8b348f adds documents only; executing code hashes stay identical. Full command/hash receipt: evidence/2026-10-09-r12-f25-integration.json.

PR142 stacks on draft143 dependency branch so its Operations changes remain independently reviewable. Own exact-head CI receipt retained in PR142 metadata; do not reuse main/security-candidate CI. RuntimeBLOCKED/releaseNO_GO/mainmergeHOLD; no formal SQL/deploy/role/send/tick and no P1v6 retry. Original50UAT immutable and0new genuine PASS.
