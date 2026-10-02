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

### B07 verified source checkpoint

Exactsource447928ae83d26c6edc218e48a444a00c45adcacd, CI37048419675: mandatory LinuxNode22.23.3/Node24.21.0 legs plus stableverify allSUCCESS. Each233files2208PASS0fail0skip/realPG17/Bun1.4.2/ChromeDEMO12/all original gates/both audits0. Suites261.92s/272.37s; Chrome34.8s/33.0s. Raw-log SHA256 and every step:evidence/2026-10-03-fixture-lifetime-ci.json. Exactpreview dpl_7ywsNwnSnribtLWxHXH8Jq7fHCYS READY/targetnull/source447928a/Node24.x.

Finalsource localNode24.18/PG17 new uniqueDB: original22NAR contracts plus8 regressions all30PASS0fail0skip170.64s, including100-item finalization within unchanged120s budget. Fresh officialtaskgate actual8PASS9.57s and fullCI status/steps/counts checked; originalUATCSV SHA unchanged. Previous mixed-revision Windows full233files2204PASS4FAIL/679.80s retained: two loaded pre-correction contracts plus share-transfer30s/NAR100120s timeouts. Actual post-timeout SELECT: syntheticNARcompany/user/batch0. FocusedGREEN does not claim a finalWindows full-suite pass or resolve latency/Today diagnostics. Indefinite/in-flight SQL/hook-budget failures remain diagnostic failures. No production acceptance claimed.

B07/T22 local-passing/code_verified; no new F01–F20 runtime acceptance. Final documentation-head CI/sole whole-range review/normal source merge/mainCI/live-alias observations are recorded in PR118 after they occur. Original50 still19LOCALONLYpass31blocked0not_run; source50 versus production last-observed66historic IDs; productionNO_GO/mainGitdeployhold/providerWrites0. Owner/staging/Auth/R2/scanner/OCR-AI/WOZTELL/handoff/native-tick gates unchanged.