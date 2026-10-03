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
