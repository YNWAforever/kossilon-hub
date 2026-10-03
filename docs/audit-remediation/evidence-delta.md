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
