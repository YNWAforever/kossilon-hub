# B07: failed NAR test fixture lifetime

Local test reliability follow-up to T22/B06. Base `baaa1a2b1e6fd17985e81e16d4c0761a7098de0b`.
This changes tests and their helper only; it is not a new F01–F20 product/runtime acceptance.

## Reproduction and correction

Actual Windows Node24.18.0/Postgres17, a uniquely owned localhost database:

- Original NAR fixture: controlled 1000ms timeout exited1 before its 5s body unwound;
  scoped company1/batch1/users2/template1 remained. The original failure database/logs are retained.
- Baseline helper and failed-child regressions: 2files,5FAIL/1PASS,exit1,11.43s.
  Tagged/unsafe writes and transaction/savepoint commits still occurred after cancellation.
- Initial implementation: 6PASS/0fail/0skip,16.15s, fresh owned database.
- Installed postgres.js deferred execution and callback-array contract inspection exposed two further gaps;
  assertion RED2/5name-filtered,0.855s, then all8 regressions GREEN/0fail/0skip,13.02s.
- Parent regression requires actual child exit1 and original timeout text, rejects hook/unhandled-rejection errors,
  and queries only the child UUIDs to require company0/batch0/users0/template0.
  The failed child is never counted as a full-suite PASS or genuine provider/UAT acceptance.

The test-only proxy checks SQL calls, captures each lazy query's signal and checks consumption,
wraps transaction/savepoint callbacks, preserves query-array results and throws before commit/release on abort.
It does not retry or cancel an already-started database operation. Teardown uses the original client.
`onTestFinished` awaits the original fixture body and cleanup before normal pool shutdown.
Independent cleanup failures remain failures; only the exact runner cancellation reason is suppressed by the drain hook.

Original30s/120s test and10s hook budgets remain unchanged. A body/SQL/cleanup that cannot settle
within those budgets is still a failing diagnostic, not guaranteed cleanup under an indefinite hang.
NAR100 latency and Today timing remain unresolved. The Windows unfiltered diagnostic started before
the deferred-query correction and is not final-head acceptance; it already reproduced share-transfer and NAR100 timeouts.
Final exact-head Linux Node22/24 complete CI and sole independent review are required before source merge.

## Evidence and release boundary

Raw local logs/result files and unique DB identity are in ignored `.worktrees/audit-windows-reliability-20261003`;
tracked SHA256 receipts: `evidence/2026-10-03-fixture-lifetime.json`.
The PR carries final exact-head/main CI and preview/read-only production receipts once observed.

Original50UAT remains19 LOCAL ONLY pass/31blocked/0not_run. Its CSV is unchanged.
Source50 SQL migration IDs versus last-observed production66 historical IDs remains divergent.
Production is still **NO_GO**, main Git deployments held. No SQL/env/deploy/send/invite/grant/provider write.

DB/data/DDL owners still need attribution, actual application-role/credential consumers, historical lineage
and genuine recovery rehearsal; Auth/provider/business owners still need the isolated origin,
existing controlled accounts and genuine R2/scanner/OCR-AI/WOZTELL/handoff/31UAT evidence.
See `runtime-parity-and-db-owners.md`, `historical-release-runbook.md` and `release-checklist.md`.
