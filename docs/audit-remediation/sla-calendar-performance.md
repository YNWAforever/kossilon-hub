# B08: SLA calendar CPU / T21, T22

This is a local performance follow-up to F09/F18 and the retained Windows NAR100
timeout. Base main: `a0b753e4c4bce4c410dcb58cfc381039c82f0c65` (PR118 normal merge).
It does not add F01–F20 runtime acceptance or change the original 50 UAT.

## Actual cause and repair

The original single-row service reads the business calendar then calls
`snapshotSla`, separately computing warning and due timestamps. Calendar arithmetic
constructed the same `Intl.DateTimeFormat` for every scanned minute, including
closed weekends. Actual local Postgres observation showed `ClientRead` after the
holiday query. A driver dispatch profile measured 64.076s across those 100 gaps.
These are elapsed dispatch-to-next-dispatch intervals, including client processing
and network; they are not exact server SQL execution times or proof of JIT cost.

One formatter is now created per `addBusinessMinutes` invocation. Each actual
instant is still formatted, preserving timezone/DST and minute arithmetic. There
is no global formatter/result cache, changed calendar/clock, SQL/domain/permission
shortcut or bulk transaction. NAR continues to use the existing single-row service.

## RED / GREEN and paired measurements

Actual Windows Node24.18.0, i5-12500/12 logical CPUs/34,033,348,608 reported RAM bytes.
The machine has other workloads; this is one paired synthetic sample, not cold
cache, throughput, p95 or an accepted production/platform SLO.

| Workload | Before | After | Evidence / scope |
| --- | ---: | ---: | --- |
| Fixed Saturday-start 100 independent SLA snapshots | 52,932.944ms | 4,435.5614ms | Same runtime/input/output SHA256; all hand-checked timestamps match |
| Original NAR100 test body, same localhost DB and profile method | 75.21s | 20.53s | 100 applied/0 pending, unchanged 120s limit, both normal cleanup |
| Gap after 100 holiday-query dispatches | 64,076.302ms | 6,589.218ms | Same 4,358 total SQL dispatches; includes application processing |

Pure benchmark command: `node node_modules/tsx/dist/cli.mjs scripts/benchmark-sla-calendar.ts`.
`node` was the resolved `C:/Program Files/nodejs/node.exe`; the script records its
actual version, host, source hash, fixed input hash and exact output hash. Its build
field is the baseline Git HEAD while the repaired source is uncommitted, so the
calendar source SHA separately identifies the measured implementation.

Input SHA256: `9928e1575171f051ed9df37ea8c7af6229f3785f2c9632c15a23d024fb64bcc4`.
Output SHA256: `81f08b457009b2d5e1056bd8cf3b6f16043be5a3cb50d1ef73cf416d6f581eb5`.

The new real workload deliberately uses the existing ordinary30s test lifetime:
baseline3files1FAIL16PASS (timeout,31.43s) ->3files17PASS0fail0skip (5.84s).
It checks independent policy identities and literal Monday warning/due timestamps,
yields between snapshots and drains on cancellation. It does not assert constructor
counts, mock outputs or an invented business response budget. Added date contracts
cover spring/fall DST, non-hour offset/partial seconds and invalid-timezone zero time.

Original NAR command: `node node_modules/vitest/vitest.mjs run src/features/nar-import/apply.integration.test.ts -t 'finalizes exactly 100 applied rows'`.
Both measured focused runs explicitly name-filter21 tests. Temporary parameter-free
driver debug instrumentation was byte-for-byte restored; the production SQL/test
contract is unchanged. Unlike the pure CPU comparison, these fixture UUIDs and
work-item start times are generated afresh; this is not an identical domain dataset.
Scoped companies/users/batches/templates were actually0 after both runs.

Focused real PostgreSQL/calendar/work-item verification:5files44PASS0fail0skip27.87s,
including all22NAR contracts and both independent-worker paths. Typecheck exit0;
whole-project lint0errors/1existing work-queue Fast Refresh warning. Missing Windows
`.cmd` formatter shim was a setup failure; the installed native entry then passed.
The incorrect diagnostic table name `sla_policy_versions` was rejected; the actual
local `sla_policies` read and scoped cleanup checks succeeded. Neither setup failure
is substituted for the actual timeout RED or a successful verification gate.

## Evidence and remaining gates

Actual commands, log/result SHA256 and owned fixture identities are retained in
`evidence/2026-10-03-sla-calendar-performance.json` and the ignored owned artifact
directory `.worktrees/audit-nar-apply-performance-20261003/`.
Unfiltered fresh-DB WindowsNode24.18.0/Postgres17 full suite:235files2214PASS0fail/
0skip201.53s. Actual NAR synthetic companies/users/batches all0 after the suite.
Exact-head Linux22/24 full CI, sole branch review, normal merge/main CI and
preview/live observations are recorded in the delivery PR after occurrence.
Focused passes never substitute for those gates.

Original30s/120s/10s limits are unchanged. This confirms a calendar allocation
bottleneck; it does not establish that every historical NAR timeout, Today loading
or share-transfer timing failure has this cause. Earlier failure DBs/logs remain.
The minute scan and its original unreachable-calendar upper bound remain unchanged.

Source50 migration IDs versus last-observed production66 historical IDs remains
unreconciled;0new migration/provider/production writes. Original50 UAT remains
19 LOCAL ONLY pass/31blocked/0not_run. Main Git deployments stay held; formalNO_GO.
DB/data/DDL/app-role/lineage/recovery, isolated staging/fresh controlled Auth,
genuine R2/scanner/OCR-AI/WOZTELL/handoff, three native ticks and accepted performance
budgets retain their named owners in the existing release/environment runbooks.
