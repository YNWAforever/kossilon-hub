# 已驗證 implementation checkpoint — 2026-10-03 香港

本頁記錄已發生的交付；implementation SHA 不代表往後純文件提交的 main SHA。
正式發布仍為 **NO_GO**。原50UAT維持 **19 LOCAL ONLY pass／31 blocked／0 not_run**。
[機讀receipt](evidence/2026-10-03-delivery-checkpoint.json)保存實際環境、命令及原始證據hash。

## Source、review、merge及完整CI

| Gate | 實際結果 |
| --- | --- |
| B08 source | `f48975bdfce9b6b794b3abb5184b2cb78804dedb`，每次SLA calendar運算只建立一個formatter，保留原行為及domain service |
| Sole fresh B08 review | 0 Critical／0 Important／1 deferred Minor；25raw hashes及12base/head calendar probes一致；review不改DB/provider |
| 正常合併 | [PR119](https://github.com/YNWAforever/kossilon-hub/pull/119)，`f07e8226c8575730f5f92fab45c4d2821484e04c`；parents `a0b753e`＋`f48975b`，source/merge tree相同；沒有重寫published歷史 |
| Source CI | [37058943518](https://github.com/YNWAforever/kossilon-hub/actions/runs/37058943518)，exact `f48975b` SUCCESS；Node22.23.3／24.21.0各235files2214PASS0fail0skip，各ChromeDEMO12PASS，全部原gate及兩份audit0 |
| Implementation main CI | [37061430788](https://github.com/YNWAforever/kossilon-hub/actions/runs/37061430788)，exact `f07e822` SUCCESS；同上完整覆蓋，Node22 suite126.18s／Chrome29.6s；Node24 suite157.46s／Chrome33.6s |
| 已完成的Windows量度 | B08 Node24.18.0／Bun1.4.2／fresh owned PG17，235files2214PASS0fail0skip201.53s；不是B09新跑的Windows suite |

兩個Linux leg使用各自真正Postgres17服務及Bun1.4.2。依賴audit、portable npm install、
lint/typecheck、完整tests、predeploy、immutable local UAT ledger、真PDF parser／read-only demo
browser、build、dev imports及compiled cron均成功；compiled handler不等於三次native ticks。
原始source log SHA256：`894A3BB70C848903E73FF7093AC5468797A485B71C181BACA2641B110CFE6930`。
原始main log SHA256：`1AAE36F4DF51E6302643A366B75535CD37DC7AD3DF6FC36BA7A1C0453D74B4F3`。
本次重新讀取mainCI狀態、逐步/計數及raw hashes，沒有以focused tests替代完整CI。

B08 fixed synthetic100SLA配對量度52.933s→4.436s；原NAR10075.21s→20.53s，
兩次4358SQLdispatch，fixture UUID/start time並非相同dataset。量度限制、RED/GREEN、
commands／host／cleanup及原始hash見[sla-calendar-performance.md](sla-calendar-performance.md)。
這不代表正式p95／cold-start／SLO已驗收，也不證明所有歷史Today／share-transfer／NAR失敗
的原因均已解決。那些失敗DB/logs仍保留。

## 正式環境差異及原驗收

2026-10-03 **09:53香港時間**，authenticated metadata-only Vercel project GET及alias GET
一致：`kossilon-hub.vercel.app`仍指向`dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`，READY，
source `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`。設定Node24.x不是已部署minor／functions
的驗證。`mainGitDeploymentEnabled=false`；本次無DB／env／deployment／send／invite／grant寫入。

source50 migrations與**last-observed** production66歷史IDs未reconcile；本次沒有重新讀取
DB或執行migration。精確Neon目標、七個extra tables的technical ownership／RLS／ACL與
尚缺logical attribution在[runtime-parity-and-db-owners.md](runtime-parity-and-db-owners.md)。
B05 guardedSQL／rollback及本地演練保持可審閱，尚未正式執行。

原[uat-results.csv](uat-results.csv)的50cases不變，SHA256
`45D2B0239826EDF41CAD480EC8B7888C426991CD28680F9EBC71DB9E9AF801E7`。
19項只證明local contracts；其餘31項外部／fresh-role／業務驗收保持blocked。
本次不新增F01–F20 genuine runtime PASS。

## 最小待辦、owner及下一步

| Gate | Owner／仍需具體資源 |
| --- | --- |
| DB／release | DB/data/Release owners確認每個extra table的logical owner、actual app role/shared consumers、sole DDL freeze、lineage及genuine recovery rehearsal，再批准精確SQL／rollback |
| Auth／staging | Auth／業務owner提供隔離origin、五個既有核准controlled account references及fresh Auth／Google evidence；不自動invite／grant |
| Files／scan／AI | Storage／Security／Reviewer提供真R2 bytes roundtrip、scanner protocol/verdict／receipt、核准OCR-AI corpus及accuracy evidence；quarantine不放寬 |
| Messaging／handoff | Messaging／Filing owners提供official scoped contracts、核准recipient／destination、真receipt／return／unknown reconciliation；不盲目retry |
| Scheduler／UAT／性能 | Ops／業務／Release owners確認sole trigger及三次native ticks，完成原31blocked journeys及staging p95／cold-cache／business budget |

完整部署及回復次序保持[release-checklist.md](release-checklist.md)和
[rollback-runbook.md](rollback-runbook.md)。Read-only metadata／preview／CI／manual tick均不代替
真runtime acceptance或授權。新文件分支的review、exact-head CI、merge、mainCI及live觀察
只在發生後寫入其PR，不能在此checkpoint預報成功。

## Deferred B08 minor

M1/P3：B08 aggregate evidence JSON的CRLF245lines令該range的`git diff --check`報錯，
不影響JSON parsing／runtime；已deferred。此頁不改B08原檔或任何raw artifact hash。
