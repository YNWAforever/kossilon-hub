# 2026-10-03 執行差異台賬

附件是不可改寫的稽核快照。此檔記錄執行時新觀察；原 findings、50 UAT、27 UC、138 control inventory 和舊 evidence 均保留。

## 已核對基線

- 2026-10-03T05:31:24.3223854Z：fetch 後 main `6f0a851a5826030eca903d86f5d7a22b8331a46c`。原工作樹 clean；新隔離分支 `codex/audit-oct3-baseline-r00`。
- Vercel project／正式 alias 一致：live `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`，`dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT` READY。main Git deployment hold 仍 false；24.x 是配置，actual runtime minor 尚未驗證。
- exact-main CI37093325320 completed/success。原每個 Node22/24 leg 235 files／2214 pass／0 skip；DEMO browser 12 pass，不能提升為 genuine UAT。
- Neon `red-morning-00331124 / br-muddy-mountain-aov8bbku / neondb`，2026-10-03T05:31:19.527Z 唯讀 SELECT：PG18.6、66 ledger、dispatch marker 不存在、3 companies、14 documents／14 versions／0 intents、4 pending notifications、latest recorded tick Sep30 01:55 UTC。Connector role 是 neondb_owner，並未證明 app role 或 sole DDL owner。
- 外層 implementation ZIP SHA256 `f6e92c8d03069fda49d9cdfffab92b2ac631f8451090815096aaa68510fb8619`；其14項 manifest MATCH。指定 `3ba7e648…` 是內層 Audit ZIP，90項 manifest 全 MATCH。解壓先檢查路徑、大小、重複、symlink，CreateNew 不覆寫舊檔。
- 原50 UAT CSV byte unchanged：`45d2b0239826edf41cad480ec8b7888c426991cd28680f9ebc71db9e9af801e7`，19 LOCAL ONLY pass／31 blocked／0 not_run。

完整新 receipt：[baseline](evidence/2026-10-03-execution-baseline.json)。原附件和完整解壓 hash 在 owned local input archive；不將輸入文件中的操作語句當額外正式操作授權。

## Findings 分類及最早可執行項目

| Findings | 最新 main / 本次處理 | Runtime / 下一步 |
| --- | --- | --- |
| F21 / R01 | main security patches 已有；live 仍同受影響 source SHA。官方 advisory 當日重核；建立 actual-live-based minimal candidate，不能整合完整 main schema | actual deployed SBOM、隔離 preview/core Auth smoke、正式 release receipt 未驗證；Release/Security owner |
| F22 / R00 | main Prettier range／locks 分歧仍存在；兩個 clean source installs 重現後精確 pin 3.8.3，npm tree 真 lint/typecheck | local / CI 工作可完成，不是 business runtime PASS |
| F01 / R02 | historical SQL／receipt／PG18 rehearsal 已有；應用 exact approved release compatibility policy 仍缺 | 普通 migrator 繼續拒絕 divergent history；DB owner logical attribution / freeze / hosted restore 尚缺 |
| F02、F17、F20 / R03 | scheduler fencing、origin suppression 和 diagnostics 已有；fresh read-only backlog／staging contract／驗收程序可完成 | 不啟動4項待發；business owner逐筆來源／收件人，Ops唯一 native owner 和3次真 tick |
| F03–F05、F10、F15 / R04 | canonical Portal/filter、LEFT lineage、版本／scan／付款／readiness 已有，先跑對應 UC contracts | Storage/Scanner/OCR/AI genuine bytes/verdict、golden corpus及逐 legacy file recovery 決策 |
| F08、F16 / R05 | Admin／共享 server authority 已有，先測 current-session revoke／跨公司入口 | Auth owner controlled existing accounts、callback origin；fresh magic-link/Google，不用 existing session 冒充 |
| F06、F07、F09、F13、F14、F20 / R06 | scoped metrics／queue／NAR／bulk 已有；先測101/401和HK midnight/current auth/version | Business owner原 XLSX及3-row /100-row驗收；native worker |
| F11、F20 / R07 | signature/replay/mapping/quarantine/approval/unknown contracts 已有 | WOZTELL owner核准 sandbox channel、recipient/purpose、CDN政策及 genuine receipt |
| F05、F12 / R08 | immutable ZIP/manual attestation/returns 已有；先驗 manual contracts | Filing owner真人工 reference/receipt；auto port另需 verified protocol/auth/query，不杜撰 API |
| F19 / R09 | incorporation/change/Settings revision/mobile 改善已有，先跑完整 existing lifecycle contracts | controlled staging records及 fresh角色390/1280 keyboard journey |
| F02、F07、F17、F18 / R10 | local bounded queries／µs cursors／SLA formatter benchmarks 已有 | owner採納SLO、同topology hosted staging、25 actors /15min及cold/warm，沒有prod壓測授權 |
| F01–F22 / R11 | 保留所有 IDs／原 UAT；按各 gate 彙總 exact source/CI/local results | web與scheduler separate artifact SHA、approved release contract、genuine逐feature接受，現在 NO_GO |

`已實作` 只引用既有 source 和 dated receipt；不表示本次 UC 重跑，亦不表示已部署。每次 actual test 後更新 execution tracker，不批量寫 PASS。

## 邊界和可逆性

本次 providerWrites=0、production exploit=0、externalMessages=0、invite/grant=0。R01 base 是實際 live SHA；其 migration bytes、server authority、data mode 必須保持。R02 使用 PG18.6 local disposable database，不能把 local restore 稱為 hosted recovery。正式 DB、部署和 native activation 仍需 target/hash/diff/rollback 完成後按有效授權處理。

## Verification correction and first deliveries

The structured Vercel receipt says mainGitDeploymentEnabled=false: automatic main deployment is disabled. The earlier prose 'hold false' was ambiguous and is corrected in the current environment matrix; no provider setting was changed. R00PR123 and R01PR124 exact-head CI green; R02PR125/full PG18 local results and per-task local rechecks are linked in oct3-local-acceptance.md. Original50 runtime status and immutable input evidence are preserved.

## Fresh-review evidence delta（追加；舊快照保留）

Two Important R02 findings were independently reproduced on PG18.6: changed durability/view/sequence semantics, and changed BYPASSRLS security, left the previous catalog unchanged. One fix pass now covers both, including table/routine ownership and recursively inherited security-definer-owner roles; actual tenant/function visibility1→2 is fingerprinted. Seven new regression cases watched RED; completecatalog9PASS／finalfull237files2245PASS0skip. The initial1NARparent-timeout failure and unchanged isolated/full reruns remain in receipts. V1/v2/v3 rehearsal evidence is immutable; rejected v1catalog hashes cannot authorize a release.

Baseline/R00 normally merged only after reviewed exact-head SUCCESS; main7dcc1fa also passed originalNode22/24gates. PR124 remains an independent old-schema security draft, not a main downgrade or promoted production artifact. Final R02 source875734397f03479e1a0a915608b7dd60a06a9361／PR125 and PR126 require their own exact-head gates.

Fresh production SELECT shows66ledger／4pending／14documents／no dispatch-started marker or release receipt. Frozen historicalguard6d4451 still matches. Original SQL/manifest/migrator/original50 byte-identical; no14legacyclean/nooriginclassification/noexternalaction. Live alias stillaa5d3cb and scheduler artifactunverified; formalNO_GO and preciseexternalowners remain. Rehearsal executing-source identity is the genuine deferredMinor; separateverification hashes identify this local code.

## R02 source identity follow-up — 2026-10-03

Closed the previous rehearsal receipt source-identity Minor under the continuing Oct3 build/environment/hash requirement. Executing source commit: `844cc685c33d7ac15effb6659c78e140d241f896`; v4 captures its full tree, clean start state, 28 actual source/input/lock byte hashes and Node22.23.3 identity separately from historical `source_baseline`. Mid-run executing source or HEAD drift refuses a success receipt. This is not an installed dependency SBOM or external approval.

Actual source contract RED6fail → GREEN6pass. First default PG18 full suite: 238files2250PASS1unchangedNARchild-parent-timeout0skip. Unchanged isolated timeout contract: 1PASS12.73s. Complete local rerun with maxWorkers=4: 238files2251PASS0fail0skip; no assertions/timeouts/CI gates changed. Local scheduling and cache effects do not establish timeout causality. npm lint0errors/1existingwarning; project and offline-script typecheck0.

New immutable v4 rehearsal passed real PG18 dump/restore, changed-catalog refusal, forced transaction rollback and repeat refusal. All82 original table row hashes and66 original ledger rows/timestamps stayed unchanged; final94tables/1separate receipt. Frozen SQL/manifest/migrator and original50UAT bytes stay unchanged; no new genuine UAT acceptance. Receipts: `evidence/2026-10-03-r02-historical-rehearsal-v4.json`, `evidence/2026-10-03-r02-source-identity-verification.json`.

Fresh read-only production observations: web `aa5d3cb`, source-main checkpoint `12fb960`, automatic main deployment disabled; PG18.6/66ledger/4pending/14documents, historical receipt and dispatch marker absent, latest recorded tick Sep30. Web and scheduler remain distinct artifacts; scheduler identity still not_verified. Formal release remains NO_GO. DB/Release owners still owe approved isolated hosted staging target/restricted app role, seven table owners/non-FK review/sole DDL freeze, authorized restore target and reviewed external approval artifact/runtime binding. Provider owner inputs remain in r03-staging-acceptance.md. No production migration/deploy/send/invite/grant was performed.

## R02 fresh-review root binding closure — 2026-10-03

PR127 review: Critical0/Important1/Minor0. The Important mismatch between module-root hashes and cwd-relative consumed inputs was fixed in one RED→GREEN pass: refuse a foreign cwd realpath before source capture, JSON/Git reads or DB work. Real script probe RED1fail/6PASS→GREEN7PASS. Its explicit DB URL required conservative registration in the existing serialized DB project; the full-suite convention RED is retained, and registry+source contracts passed9/9. No original gate or timeout was weakened.

Final executing code `8e9eeab8c9f466c79b8f2c31fe679e885dabee42`; complete owned PG18/Node22 suite238files2252PASS0fail0skip (`--maxWorkers=4`); npm lint0errors/1existingwarning, project/script typecheck0. New immutable v5 real dump/restore/catalog refusal/rollback/repeat-refusal passed, clean28source/input hashes,82 originaltables/66ledger preserved,94finaltables/1receipt. Earlier v1–v4 receipts remain unchanged. Source snapshots detect persistent differences; they are not continuous/atomic filesystem, installed SBOM or runtime approval proofs.

Evidence: `evidence/2026-10-03-r02-historical-rehearsal-v5.json`, `evidence/2026-10-03-r02-source-root-verification.json`, `oct3-source-identity-execution-review.md`; original50UAT and frozen SQL/manifest/migrator unchanged. `current_build_sha` records the actual local executing code above; the PR's published head, exact-head CI and normal merge receipt are separate GitHub artifacts in PR127. Previous CI37111128136 SUCCESS is explicitly the older `1cebb79` head and cannot stand in for the root-guard final-head gate.

Runtime remains blocked and formal release NO_GO; no hosted DB/deploy/send/invite/grant occurred. Approved hosted staging/restricted app role/owner and DDL freeze/restore target/external approval binding and genuine provider inputs remain the next dependencies.

## R03 runtime target inventory delta — 2026-10-03T10:01Z

Current source baseline60a7b9745ce4e66fe3c4e34848a6aba498a6fc26/PR127 main CI37113208517 green. New metadata receipts preserve the Oct3 snapshot and all earlier evidence: `evidence/2026-10-03-r03-target-neon.json`, `evidence/2026-10-03-r03-target-vercel.json`, `evidence/2026-10-03-r03-target-runtime-logs.json`.

- Neon red-morning-00331124 has4branches: production plus3 historical restore/backup labels. No staging target has been approved or supplied. Those backups are preserved; their names do not authorize reuse or classify business origin. Production has1database/neondb and4roles. The current SELECT observer is neondb_owner (PG18.6), with BYPASSRLS/CREATE ROLE/CREATE DB true. authenticator can login but is not verified as the web app role; managed anonymous/authenticated cannot login. Fresh app-role tenant enforcement/credential binding remains missing.
- Actual Vercel production project and deployment both report0cron definitions, deployment dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT/sourceaa5d3cb. Project cron metadata has enabledAt but no definitions; it does not prove an active job. Live sourceaa5d3cb has no vercel.json; current main declares one five-minute maintenance cron and holds automatic main deployment. Current source is not deployed configuration. Cloudflare/other scheduler remains unknown; no trigger was invoked.
- Full scoped Vercel GET inventory:76projects/1page/complete;2name-matching Kossilon projects (kossilon-hub and kossilon-hub-demo). This does not prove differently named staging is absent or approve either target. The initial connector list was only20entries and paginated; the CLI GET completed the resource inventory.
- Project env metadata shows12related entries. DATABASE_URL has separate development/preview/production entries; R2/Auth entries cover preview+production. No isolation, current credential value, effective app role or genuine provider PASS is inferred. WOZTELL/scanner/AI entries were not found in this project metadata; other binding mechanisms are unverified. No values/passwords were copied.
- Auth whitelist lists4domains: localhost3000 and three production variants. No approved staging callback is supplied. Domain presence is not fresh Auth/Google/invite acceptance.
- Scoped Vercel cron-text log query7d returns0rows; unfiltered24h grouped query reports43distinct paths but returns top25 only. Query access is available; native invocation/export/retention evidence remains missing. Neither result proves globally absent ticks. CLI50.28.0 rejects the documented crons subcommand; this capability difference is retained without upgrade or manual invocation.

R03 metadata follow-up is local-passing after document/hash checks; runtime-blocked and formalNO_GO. ProviderWrites0/newgenuineUAT0; original50, frozen SQL/manifest, migrations and legacy statuses unchanged. Exact owner next steps are appended to r03-staging-acceptance.md.

## BUG-R03-01 — staging production-host fence
Continuing Oct3 ledger from main4c00f92; no re-audit/reimplementation of completed tasks. The existing pre-browser auditStagingTarget guard rejected only the bare production hostname. Complete synthetic controlled-account inputs admitted www.kossilon-hub.vercel.app and bare/www DNS terminal-dot spellings. Uppercase www was generically rejected by exact-origin validation rather than classified as production. No production browser/network probe was performed.

Minimal tested source efcd075451febc99bab042a95f21d9e8e25f9dbe rejects the two known production hosts after URL hostname normalization and terminal-dot removal. The exact HTTPS origin/build/approval/distinct-account/secret-free-output contracts remain; a distinct staging hostname remains usable. Baseline2PASS; RED4FAIL/3PASS; GREEN7PASS0FAIL0SKIP; actual complete Node22.23.3/owned PG18.6 suite238files2257PASS0FAIL0SKIP (maxWorkers4,368.44s). Real npm lint0errors/1existingwarning, typecheck0. Evidence: evidence/2026-10-03-staging-production-fence.json; raw logs and completion helper retained in the owned ignored staging-production-fence folder.

R03 local code advances only this pre-browser safety contract; related R05 UC06/15/23 genuine Auth acceptance does not advance. Original50UAT/frozen SQL/manifest bytes unchanged;0newgenuineUAT/0hostedwrites; formalNO_GO. This known-host fence does not discover every production alias or prove isolated DB/Auth/R2/provider bindings. Approved staging target/restricted role/owners/restore/external release policy/native receipts/provider inputs remain the minimal external dependencies. One fresh whole-range review and final-head original Node22/24 CI remain required before normal source merge; actual receipts follow in the bug delivery PR. No migration/deployment/cron/env/message/invite/grant change.

Rollback: normal revert of the isolated guard fix; preserve previous evidence and production hold. The weaker previous guard must not be treated as permission to run genuine UAT against production.

## BUG-R11-01 — append local browser evidence

Continuing from main f038ee79018f9a604e2affc1ef2f85aa3a5a702b; tested source f415cb2ca5255603ee47e9a659d7e9ab1b12dd46. Actual baseline browser consumers overwrote all six historical browser copies in an owned Git snapshot: six scenarios PASS but preservation contract RED exit1. The authoritative nine protected artifacts stayed unchanged. New runs use unique ignored roots, native per-test output paths and a pre/post historical-byte guard. Main and reloaded Playwright workers share the same bounded run root. This observes bytes before/after; it is not continuous or atomic filesystem protection.

Real filesystem guard/ownership6PASS. Two complete390/1280 browser runs12PASS+12PASS, each6captures; first8files unchanged after the second. Final full12PASS after the redundant baseline cls field was removed (extra tooling compiler TS2783 RED2→GREEN0; measured value retained). Earlier cold30s readiness failures, snapshot10PASS/2PDF junction-serving failures, worker-root ownership RED and the old runner's deleted initial failure attachments are explicitly retained/limited in the receipt. Original parser/source assertions and browser/CI timeouts are unchanged.

BUG-R11-02 verification dependency: original NAR child full30s RED remains in the receipt. Profiled unfiltered child36905ms/3Vite configurations versus db-only16755ms/2configurations, both expected1FAIL/22filtered with no hook timeout/unhandled rejection; unchanged parent assertions now1PASS0FAIL0SKIP/11569ms after adding only --project=db. The original1000ms/30000ms deadlines and full root unit+DB/CI gates are unchanged. This is a bounded harness correction, not a hosted performance result; sole causality remains limited by sequential profiling/cache/platform differences.

Complete final local Linux Node22.23.2/Bun1.4.2/ownedPG18.6: 239files/2263PASS/0FAIL/0SKIP/maxWorkers1; source hashes unchanged through the final run. Initial239files2262PASS/1Today loading failure/0SKIP retained; unchanged Today isolated4PASS. Second full2240PASS/23FAIL0SKIP: NAR40s first-test timeout/sequential cascade and30s child failure; unchanged isolated NAR23PASS. Old local DB retains2synthetic companies/4users/2batches with unconfirmed attribution; no broad cleanup/reset. New kossilon_browser_evidence_20261003_a1 was migrated/seeded only on loopback55448. Fresh state/scheduling/cache effects do not establish failure causality. Fresh Windows full2259PASS4FAIL0SKIP and Linux without Bun2262PASS1FAIL (spawn bun ENOENT) are retained. After pinned Bun1.4.2, Linux full2260PASS3FAIL0SKIP (scale120s/NARchild30s/Operations no-ledger30s). The unchanged three isolated tests28PASS; observed document-page SQL progressed without lock wait. The pre-fix single-worker countercheck2262PASS1NARparentFAIL0SKIP retained all five original source hashes. The final full run uses six exact tested checkout source hashes including the one-argument child-project change, not a test-budget change; failure causality remains unconfirmed. Initial wrong-column SELECT diagnostic failed; corrected schema-bound SELECT succeeded. Actual npm lint0errors/1existingwarning, project typecheck0 and extra tooling typecheck0. Source/raw hashes and actual commands: [evidence/2026-10-03-preserve-browser-evidence.json](evidence/2026-10-03-preserve-browser-evidence.json). Outputs remain under the owned ignored checkout; original CI does not upload them durably.

Historical delivery reconciliation: PR127 finalhead e82d051/CI37112675810 → normal merge60a7b97/mainCI37113208517; PR128 finalhead dd1347e/CI37116219485 → normal merge4c00f92/mainCI37116670752; PR129 finalhead13ea7d5/CI37122276438 → normal mergef038ee7/mainCI37122816502. Actual GET receipts verify all original runtime legs succeeded; these close stale source next steps only. Current follow-up final-head/main gates and merge receipt will be attached to its PR after occurrence.

R11/R09/R10 local evidence advances; R02/R03 metadata corrected. Original50UAT/frozen SQL/manifest/all six historical browser files byte-unchanged:19historicalLOCALONLYpasses/31blocked/0newgenuine. Source50 versus last-observed production66 historical migrations remains divergent. No schema or deployment/configuration changes, providerWrites0. Last observed production web aa5d3cb remains separate from unverified scheduler artifact; GET observation2026-10-03T16:13:45Z: alias/deployment dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT agree with source aa5d3cb/READY/configured Node24.x; resolved minor and independent scheduler artifact remain unverified. Source main vercel.json retains the automatic Git deployment hold; this is not a live project-setting proof. Closing GET observation2026-10-03T18:17:34Z confirms the same project/alias/deployment/web SHA; deployed minor and independent scheduler SHA remain not_verified. Open PR124 is the green isolated aa5-based security candidate against codex/oct3-live-security-base, not a main merge or production safety receipt. Formal release **NO_GO**. Approved staging/restricted role/external contract/owners/restore/native ticks and genuine Auth/R2/scanner/OCR-AI/WOZTELL/business/filing/performance inputs remain in r03-staging-acceptance.md and oct3-local-acceptance.md.

Rollback: normal revert of the isolated runner fix; preserve all old and new evidence. A revert restores the destructive old artifact writer and must not be treated as approval to overwrite retained evidence.

## Oct4 source delivery delta

New append-only receipt evidence/2026-10-04-delivery-closure.json persists PR130 normalmergea5fa31d, exactheadCI37145651035 and independentmainCI37146214027; previous immutable source/runtime evidence stays unchanged. Actual eachNodeleg239files2263PASS0FAIL0SKIP+12DEMO, original21stepsSUCCESS. This closes the tracked publication-receipt gap, not genuine runtime/UAT gates.

Read-only alias and Neon branch inventory by2026-10-04T03:22:50+08:00 match the prior production deployment/4branches. Latest official TanStack/PDF.js advisory patch floors still1.168.60/1.169.39/6.2.108; deployed resolved dependencies remain unverified. Build-log connector is unavailable (Tool get_deployment_build_logs not found); Security/Release owner must export exact-artifact SBOM/log evidence through approved tooling. PR124 samehead257fb9/customhistoricalbase stays isolated. No historical evidence overwrite, new schemaSELECT, role inference or hosted mutation; original50 and formalNO_GO unchanged.


Oct4 follow-up by03:40:05HKT: scoped Vercel50.28.0 CLI inspect --logs GET succeeded for the same production deployment; no local link was created. New immutable evidence/2026-10-04-live-build-log-fallback.json retains actual historical buildsourceaa5d3cb, buildCLI60.1.3/iad1 and cached npm install. None of the three key resolved-version strings is present; installed deployed SBOM/runtime minor remain not_verified. The earlier connector-unavailable receipt remains unchanged; current R01 blocker now asks only for artifact-bound resolved SBOM rather than unavailable log export. No runtime/UAT/provider-write status advances.


## Oct4 R01 staging review package — 2026-10-03T20:40:35.251510+00:00

From main `f5efd1283d00f02189e51ddf1e287d35a547360d`, live GET remains `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` / `dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`. Fresh Neon metadata lists the same four branches; no approved staging. Actual schema SELECT was not repeated. User selected local preparation of a concrete new-staging review package.

[Exact request](releases/r01-staging-2026-10-04/request.json), [operator/rollback package](releases/r01-staging-2026-10-04/README.md), and [immutable receipt](evidence/2026-10-04-r01-staging-request.json) propose only a new child `kossilon-r01-staging-20261004` in `red-morning-00331124` from `br-muddy-mountain-aov8bbku`, `no_compute=true`. Exact request SHA256 `d2b9cf36449f80e56de63595450da64631c5fb77ce67a15f3907f5f95a184491`. No resource ID/origin is invented and no hosted operation is performed. Phase A copies sensitive production/Auth/role data and requires its own hash-bound approval; Phase B actual endpoint/restricted role/branch Auth/R2/protected origin/binding/deploy acceptance remains separate. The isolated candidate stays `257fb9d0be17525a305f38bd26001ad8fa45deb8`/PR124; migration/domain diff0 versus aa5.

Actual existing LOCAL staging tests7PASS0FAIL0SKIP; request/schema/lock/hash/protected9 checks verified, original release verifier exit0 with NO_GO. Original50 remains19historicalLOCALONLY/31blocked/0newgenuine; no new genuine Auth/provider/native tick or schema/release acceptance. Only R01/R03 tracker rows advance local package evidence; ten unrelated rows and original artifacts remain unchanged. R03 still requires its full-release owners/DDLfreeze/restore/external contract/native artifact/provider receipts.


R01 staging review correction 2026-10-03T20:55:04.150503+00:00: first7PASS report is retained but its newly added Node22 runtime label was inaccurate; no first-run pre/post runtime capture existed. Explicit `C:/Program Files/nodejs/node.exe` metadata brackets the unchanged7-test rerun at Node24.18.0:7PASS0FAIL0SKIP. Historical Node22/fullPG18 receipts unchanged. One fresh review of a13b973 found0Critical/1Important/1Minor; the circular Phase B preconditions were regraded Important and corrected in the same pass. Runtime-label/phase-sequence doc contracts observed RED2; corrected input/acceptance separation keeps every genuine gate. Initial a13 proposal/receipt retained in Git and exact ignored archive. Current request SHA256 `47770d20a4aa73bfb7ba17618c1b5dfc0ff6548abf8042b4575a2c38f6ab6e1b` supersedes the unapproved `d2b9cf36449f80e56de63595450da64631c5fb77ce67a15f3907f5f95a184491` proposal; Phase A tool arguments are unchanged. No hosted execution or new genuine result.


## Oct4 approved R01 Phase A — 2026-10-04T02:01:23Z

User approve binds request47770d20a4aa73bfb7ba17618c1b5dfc0ff6548abf8042b4575a2c38f6ab6e1b. One create produced br-fragrant-sunset-aosoylhr / kossilon-r01-staging-20261004 in red-morning-00331124 from br-muddy-mountain-aov8bbku. Five post-operation metadata reads verify ready/non-default/0endpoint/0compute/one neondb. Four existing branch identities and original production endpoint binding match. Provider created_at2026-10-04T01:59:54Z is separate from parent LSN0/628F120 and parent_timestamp2026-10-03T12:23:35Z. Receipt: evidence/2026-10-04-r01-staging-created.json; operator/next request: releases/r01-staging-2026-10-04/phase-a-result.md.

Child Auth config/domains/OAuth management GETs return HTTP404/not enabled; copied Auth DB rows/roles/schema/ledger were not queried. Phase A resource PASS is not fresh Auth/core/SBOM/native/business acceptance. B1 exact compute/catalog-read/new-endpoint-only suspend-on-failure proposal binds the assigned branch ID and remains unapproved/unexecuted. Source main0f509e8 and actual-live/candidate baseaa5d3cb remain distinct; candidate257fb9/PR124 exact5checksSUCCESS, scheduler artifact and deployed resolved SBOM not_verified.

Actual LOCAL Node24.18.0 existing staging1file7PASS0FAIL0SKIP; original release verifier exit0NO_GO. Catalog SQL is prepared only: WSL probe service error0x8007274c, no new local PG18 SQL execution/PASS; CI original real Postgres gates remain required. Original50UAT/protected9/request/template/old evidence unchanged; only R01/R03 rows updated, ten unrelated rows preserved. HostedSQL0/migration0/roleAuthenvdeploycronSendInvite0; one authorized branch-create resource write. FormalNO_GO/newgenuine0. DB/Release B1 approval, restricted-role/old-schema policy; Auth controlled identities/callback; Storage protected isolated bindings; R03 owners/restore/external contract/native artifacts/ticks remain exact next inputs.


## Oct4 separate local PG18 catalog receipt — 2026-10-04T02:29:20Z

The initial WSL service error and PhaseA/B1v1 receipts are preserved. An already-installed DockerPG18 image enabled a separate owned network-none empty disposable database. The exact committed catalog SQL bytes5e5d984a7487995b74808b39c133c05f5ad11c1747305ce3eca63fee15d2b58f ran on actualPG18.6: oneexecution/exit0/onerow; copied container hash matched. This proves syntax/catalog SELECT on that local empty DB only, not the historical hosted clone, ledger/data, restricted app-role or fresh Auth. Exact new container ID/task/network/no-host-bind guards and cleanup left0matchingcontainers. Initial cleanup guard null-array false positive is retained in the cleanup receipt.

New append-only evidence/2026-10-04-r01-catalog-syntax-rehearsal.json binds source02680c1/image/container/raw10hashes and the unchanged originalPhaseA/B1v1 hashes. Current unapproved proposal is releases/r01-staging-2026-10-04/phase-b1-compute-request-v2.json; endpoint/SQL/rollback scope and all false authorization flags equal v1, only request identity/local-rehearsal metadata changed. Older proposal/runtime-blocked observation remains historical. R01/R03 runtime and formalNO_GO/newgenuine0 remain; Neon child still no compute/noSQL.


## Oct4 R01 B1 v2 capability refusal — 2026-10-04T05:00:49.448066+00:00

Explicit approval `批准B一V二` binds request7243bf15; one exact create attempt returned HTTP400/INVALID_ARGUMENT, passwordless=false not supported. Four post-error GETs reconcile no new endpoint/compute, all5branches and originalproductionendpoint binding retained. Freshpreflight9/Authmanagement404 is metadata, not absent copied Auth data. Official current create/update OpenAPI field marked NOT YET IMPLEMENTED; CLIhelp/APIpassthrough is not a verified equivalent route. New [immutable receipt](evidence/2026-10-04-r01-b1-capability-blocked.json) and [operator result](releases/r01-staging-2026-10-04/phase-b1-result.md). B1 authorization recorded separately; immutable proposal/oldreceipts preserved.

Actual LOCAL existingstaging7PASS0FAIL0SKIP/Node24.18.0; original releaseverifierexit0NO_GO. HostedSQL0; no retry/suspend/migration/ledger/Auth/role/env/deploy/tick/send/invite. Resource runtime-blocked, catalog not_run; code/local/CI are separate. No new fullsuite/PG18 rehearsal or genuine acceptance claimed. Original50 remains19historicalLOCALONLY/31blocked/newgenuine0. DB/Release+Neon owner must supply supported equivalent endpoint access policy/route or reviewed replacement request; no plaintextsecret input needed. All subsequent historical/restricted-role/Auth/provider/native/business gates remain blocked.


## Oct4 R10 offline measurement contract — 2026-10-04T06:41:48.298307+00:00

Master R10/UC24 continuation from main8037729; executed source3e2c1463fbaafeb337acebe4004cf0fc3ad55d9d. Existing single-wave benchmark remains dated and unchanged. New version-1 offline reporter aggregates endpoint/phase/cache p50/p95/p99, successes/errors and observed timing-layer coverage; insufficient minute/user coverage remains incomplete. Caller metadata/cache labels never establish isolated provider identity, concurrency or genuinely cold state. Every report retains NO_GO/not_assessed. No live load or new before-after performance result.

Actual RED25FAIL→GREEN25PASS; real boundedCLI/adjacent contracts37PASS0FAIL0SKIP (Node24.18.0). Complete original local suite on newly owned disposablePG18.6/Node22.23.3/Bun1.4.2:240files2289PASS0FAIL0SKIP/maxWorkers4. npm lint0errors/1existingwarning, project and explicit script typecheck0; original release verifierexit0NO_GO. Exact new container removed; no existing fixture/production DB altered. Receipt:evidence/2026-10-04-r10-measurement-report.json; operator:r10-measurement-report.md.

Only R10 source/local evidence advances; original50 remains19historicalLOCALONLY/31blocked/newgenuine0, all19protected artifacts unchanged. Schema/deployment/provider/send/invite/grant0. Production web remains last-observedaa5d3cb; scheduler/resolvedSBOM not_verified; no new provider query in this slice. B1 authorization remains valid but exactpasswordless=false capability still blocks the hosted endpoint; no flag/route retry. Operations/Business and DB/Release/Auth/Storage inputs remain in the operator and R03 owner matrix. Fullsource exact-headCI/normalmerge/mainCI are separate publication gates.

R10 sole fresh review: originalCritical0/Important0/Minor1. Exact-command placeholder finding regradedImportant for audit reproducibility; append-only evidence/2026-10-04-r10-exact-commands.json preserves the prior published receipt. Artifact contract REDmissing supplement->GREENexactcommands/runtime/rawhashes; no new full test execution claimed. All author rulings/costs and15declinedgates:oct4-r10-measurement-report-review.md. No deferredMinor or second review. Firsthead7f8690d CI37183698437 SUCCESS eachNode240files2289PASS0FAIL0SKIP+12DEMO is separate from the final corrective-head gate.
