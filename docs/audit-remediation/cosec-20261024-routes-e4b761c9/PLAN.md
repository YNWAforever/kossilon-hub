# UC160 註冊／變更子路由 — e4b761c9

Scope: UC160 / F19 / R15;R22;R26 / LA33 (original relations preserved). Read-only navigation acceptance, production components with local RPC stubs, no native Auth/HTTP/DB acceptance. No push, merge, deploy, production changes or external provider calls.

Intake: authoritative root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`, branch `codex/cosec-20261023`, clean HEAD `36dad48dc30a86329f0afcc2ffb46749be71e94e`. Origin `https://github.com/YNWAforever/kossilon-hub.git`. Read-only remote main `1c57a67213af72bff8d776694e6ed8c986b921db`; historical production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` not accessed. AGENTS/Lovable history rule and RTK read. Plan attachment is a specification, not extra authorization.

Existing coverage: `-nested-route-outlet.convention.test.ts` checks source text; `case-lists.test.tsx` mocks the router; individual detail tests mock Link. Existing fix `43e2b9765cb8174fcd154b94c268c5b73e587373` adds both outlets. UC160 original asks Staff A to open a QA record from the list, then Back, and requires both URL and rendered detail to change. No existing exact interaction coverage found in the known route/domain test directories.

Graph metadata request gave no response after a bounded 15s and was terminated; private indexing/upload was previously rejected by automatic approval review and is not retried or bypassed. Known local paths and narrow literal/config searches are used as fallback.

1. Add real-router interaction regressions for both production route pairs. Verify existing fix; reproduce actual remaining defects before changes. Historical pre-fix browser snapshot may verify the original F19 failure but must not be presented as a new current-SHA defect.
2. Test list/detail URL and content, Back/Forward, copied detail URL, fresh data read, malformed/missing/denied/error recovery, pending read departure and safe return. Check trailing-slash list aliases.
3. Run a fresh isolated local browser harness with real router/history and production components. Gate exact server root/run/header/origin before fixture initialization; block outside requests; no .env or real server functions. This is stub transport, not native API or SQL.
4. Run impacted tests, full unit when resources permit, typecheck/lint/build. Preserve raw failures, source hashes, exact commands and final source-equivalence checks.
5. Deliver CSV with original/native 184 rows unchanged, candidate, blockers, checksums and DELIVERY. All native gaps stay blocked/not-run (70/114/0 PASS).

Resource observations before tests: free RAM 1,390,723,072 bytes (intake, no runtime launched), then 3,153,575,936 bytes; disk free 25,510,830,080 bytes. Fresh gate each stage: focused 1.5GiB, browser/typecheck/lint 2GiB, full unit/build 3GiB. Never stop other work or remove shared resources. Each attempted gate is append-only.

No DB target is required for this route-rendering scenario. No DB client, fixture, migration or SQL cleanup will run. Browser fixture IDs are 合成 and restricted to this run's memory; meaningful business data persistence remains native blocked.
