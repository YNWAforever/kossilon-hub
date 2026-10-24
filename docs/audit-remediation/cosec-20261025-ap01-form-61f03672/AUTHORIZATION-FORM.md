# AP-01 metadata-only：最小 target／唯讀存取／HKT 授權表

**決定：本輪Vercel metadata-only已明示批准並完成，已停止遠端請求；Native仍BLOCKED／NO_GO。** 最新使用者窄範圍授權取代本輪先前不連外限制，只使用既有Vercel MCP連線核對唯一候選，沒有新增帳戶、憑證或權限。實際回條：[AP01-METADATA-EXECUTION.json](AP01-METADATA-EXECUTION.json)。本輪不是QA／DB／Auth／應用runtime驗收，沒有新的準備包。

## 已核實／預填（本機證據）

| 欄位 | 補填值 | 來源／證據層級 |
| --- | --- | --- |
| 專案 | Kossilon CoSec OS | 本輪使用者指定 |
| Repo／branch | `https://github.com/YNWAforever/kossilon-hub.git` ／ `codex/cosec-20261023` | 本輪本機`git remote get-url origin`／`git branch --show-current`；沒有連GitHub |
| 請求前最新本機交付 | `19f03e55a7a7d86b860ea3028ac3205ed95f71ed`；沒有後續交付，clean起點 | 本輪`git rev-parse HEAD`／`git log`／`git status`；原準備表與歷史證據保留於Git |
| 預期產品source | `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`；674個來源/config檔吻合，非部署observed SHA | [source候選](../cosec-20261024-handover-exec-a30e04f1/source-candidate.json)及本機Git blobs核對 |
| 本機artifact參照 | 433檔／14,269,548bytes；manifest SHA256：`189606711dca25c7dbc522903f6657b002efab2edca33ee9bf4a7c22f74ca1b4`；**不是provider deployed-bundle checksum** | [file-set manifest](../cosec-20261025-build-d29cd5ec/artifact-manifest.json) |
| 本輪已批及已執行子範圍 | **唯一`kossilon-hub-demo`的Vercel project/deployment metadata**，含必要team解析；沒有DB/Auth/CI查詢，非整包AP-01 | 最新使用者明示窄授權及[實際回條](AP01-METADATA-EXECUTION.json)；舊較廣proposal不自動獲批 |
| 原範圍狀態 | 原184列及失敗證據不變；native70BLOCKED／114NOT_RUN／0PASS | [原驗收CSV](../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv)及原hash |

## A. Target metadata（本輪已核實與未知）

| 欄位 | 補填值／尚欠 | 來源／核對結論 |
| --- | --- | --- |
| 固定deployment URL | `https://kossilon-hub-demo-dpp5u56nf-ynwaforevers-projects.vercel.app`；**沒有開啟**。最新可見部署ID `dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY` | 回條req3/4；Vercel回傳的固定hostname補HTTPS表示，不是app路由readback |
| 資源owner／team | 平台owning account為team `team_qvzlsFmfCsLkgItSypqHjw3z`，name `ynwaforever's projects`，slug `ynwaforevers-projects`；**具名人類／business owner UNKNOWN** | req1/2：project.accountId與team ID相符。未把使用者／GitHub帳戶推定為owner，也未讀team members |
| 專用或共享／DB/Auth隔離 | **UNKNOWN／未驗證** | 本輪只讀Vercel描述，不查DB/Auth或env；demo名稱、READY及target都不證明隔離 |
| 唯一匹配project | `kossilon-hub-demo`／`prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`，與歷史ID吻合 | req1完整回傳1team；req2在該team精確名稱搜尋1匹配、沒有next page。唯一性限本輪現有連線可見team/scope，不宣稱不可存取scope不存在其他資源 |
| 關聯DB／Auth／CI metadata範圍 | **UNKNOWN／未獲授權**。另有歷史Neon project `red-morning-00331124`、staging branch `br-fragrant-sunset-aosoylhr`；只作歷史線索，不納入本輪查詢 | [2026-10-04 Phase A](../releases/r01-staging-2026-10-04/phase-a-result.md)記錄no-compute child、Auth未啟用，候選為舊R01 `257fb9d0be17525a305f38bd26001ad8fa45deb8`；[B1結果](../releases/r01-staging-2026-10-04/phase-b1-result.md)仍無可用endpoint。當前存在／可用性未重查 |

上述歷史staging DB沒有與本輪demo project綁定，也未查其當前狀態。Vercel回傳4個可見部署，均`target=production`、`READY`；這是demo project內的環境描述，不能推論為已隔離UAT。沒有訪問任何部署URL／production網站。

| 版本對照 | 本輪結果 |
| --- | --- |
| 最新deployment metadata | ID如上，created HKT `2026-07-19 18:37:56 +08:00`，`target=production`／`state=READY`；req4即使要求Git資訊仍未提供SHA，故**Git SHA UNKNOWN** |
| 候選`4d63818fe2562146f85e9a7b9917d8f0eb58f4c1` | req5同project按該SHA篩選，0筆metadata。未找到帶此SHA的deployment描述；不能排除未標Git SHA的手動artifact，**同版綁定UNPROVEN** |
| 請求前本機交付`19f03e55a7a7d86b860ea3028ac3205ed95f71ed` | req6按該SHA篩選0筆。不能把最新部署UNKNOWN SHA當成相同或不同版本的證據 |
| 一個較舊、有Git SHA的部署 | req3之`dpl_8HRm51T3geyo6UYXeTQopHKgLYhP`記`e2ac85e5da61f221aca8b788f86818f4c96d75fa`，不同於上述兩SHA；只適用該部署，不套給最新部署 |

## B. 本輪現有連線及讀取範圍

| 欄位 | 補填值／尚欠 | 來源／核對結論 |
| --- | --- | --- |
| 現有平台metadata讀取能力 | **已核實本輪6個Vercel MCP metadata read回傳成功**，沒有登入或改權限 | 回條req1–6。只證明這些read可用，未證明該credential/RBAC是exclusive readonly，沒有讀token／權限設定 |
| 本輪精確resource／metadata範圍 | current connection team解析、唯一project名稱搜尋、該project可見deployments、最新deployment Git metadata，以及兩個精確SHA篩選 | 僅`list_teams`、`list_projects`、`list_deployments`、`get_deployment`讀取；沒有get env／logs／website fetch，沒有其他project詳細讀取 |
| 本次request明細／失敗保留 | 回條6個attempt，沒有API重試或必要分頁；req3有本機wrapper解析失敗，已從**本任務自己的metadata完成事件**取回原回應，沒有重送 | Request3仍計入6次；回條保留failure、來源event ID/hash及一致的byte計量。不讀Vercel application logs／客戶資料 |

**QA Admin與DB存取不屬本表前置條件。** 平台metadata讀取須用既有平台唯讀權限；不需要QA帳戶、Auth session、DB憑證、client或SQL。若現有平台存取不足，只標blocked，不重新登入／新增OAuth consent。QA identity與DB server/role/catalog各在後續獨立範圍另批；原Core角色及資料條件沒有豁免。

## C. 本次HKT時窗／授權及實際用量（已關閉本輪讀取）

| 欄位 | 填寫 |
| --- | --- |
| 決定／批准來源 | **本對話使用者明示批准本輪唯一候選的Vercel project/deployment metadata-only**，取代前輪不連外限制；不視作使用者是資源owner，不授QA/DB/Auth／其他AP權限 |
| 開始HKT | **2026-10-25 03:17:50 +08:00**；首次遠端請求前寫入回條，精確毫秒見UTC欄 |
| 固定截止HKT | **2026-10-25 03:47:50 +08:00**，開始後30分鐘；未重設或另開一輪 |
| 實際結束HKT／耗時 | **2026-10-25 03:28:01 +08:00**／610,984ms（約10分11秒）；讀取已關閉，不繼續使用餘額 |
| 配額／實際請求 | 上限20次，**已用6次**。遠端connector errors0；本機capture failure1次已保留、原請求計入6次，沒有重送 |
| Response bytes | Metadata text **4,667 bytes**；含connector envelope保守計量 **8,806 bytes**，按後者扣10MiB配額。非網絡wire/compression bytes；原始本任務MCP完成事件校回各次計量 |
| 授權與版本綁定 | 本輪user窄授權、請求前HEAD `19f03e55…`、候選`4d63818…`、唯一匹配project及6個工具/args/開始完成時間均在實際回條；不延伸至其他候選或下一輪 |

**本輪已批上限：** 唯一候選、合計20 metadata請求／10MiB／30分鐘；失敗與必要分頁計入。只使用6次Vercel metadata讀取，沒有DB/Auth/CI請求、自動polling／重試、改scope／登入／擴權。舊較廣proposal的分類預留沒有在本輪執行。

**固定排除／上限0：** 開Kossilon頁面或app/API/RPC、QA登入／Auth session／magic-link／invite、DB連線/query/client/compute喚醒、browser、業務／個資讀取、artifact/object檔案下載、上傳、provider processing/send、帳戶/role/profile變更、資源建立、付費服務新增費用、刪除/dispose、push/merge/deploy。Metadata response才計入10MiB；不讀秘密env values。工具副作用或實際用量無法界定、target/版本不符、到期或配額不足即停依賴部分，不自動擴scope。

## 未核實值（保留未知，日後只讀取得後才記錄）

已核實project ID、platform owning team、4個可見deployment IDs／固定hostnames／target／state，以及本輪指定reads可用。仍未知：具名人類／business owner、credential的exclusive readonly RBAC、最新部署Git SHA／artifact實體、候選同版綁定、DB/Auth資源及資料隔離、CI／安全disposition；後者均沒有執行，不從demo或READY推論。

證據按[E0–E6清單](../cosec-20261025-ap01-meta-a7885f7a/AP-01-METADATA-ONLY.md)保存：scope/request明細、deployment、DB資源、Auth配置、CI/artifact/security、request/失敗/bytes帳及disposition/hash manifest；秘密與個資不入log。只封存本機sanitized證據並結束讀取，不動既有平台session或遠端資源。

**本輪metadata-only已完成並停止，沒有下一輪自動授權。** Metadata身份核對不關閉QA／DB／RLS／員工旅程等原UC/LA；隔離性與同版綁定仍未證明，Native維持BLOCKED／NO_GO。
