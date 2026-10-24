# AP-01 metadata-only：最小 target／唯讀存取／HKT 授權表

**決定：NOT_AUTHORIZED。只補原表、未執行；原生 BLOCKED／NO_GO。** 尚未找到可核實適用本輪／候選4d63818的既有隔離目標。依「you decide」，我選歷史`kossilon-hub-demo`／`prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`為唯一**待核實候選**；首步只擬查該Vercel project/deployment metadata，DB/Auth/CI及歷史staging branch不納首步。保留20次／10MiB／30分鐘總上限，不挪用其他步驟預留增加scope。Owner、現行唯讀存取及同版部署仍UNKNOWN；準備階段不啟動HKT時窗，實際起止待前置條件與明示執行批准齊備後固定。沿用原先不連外限制，不新增準備包或重問同一清單；不要填秘密。

## 已核實／預填（本機證據）

| 欄位 | 補填值 | 來源／證據層級 |
| --- | --- | --- |
| 專案 | Kossilon CoSec OS | 本輪使用者指定 |
| Repo／branch | `https://github.com/YNWAforever/kossilon-hub.git` ／ `codex/cosec-20261023` | 本輪本機`git remote get-url origin`／`git branch --show-current`；沒有連GitHub |
| 本輪查核交付基線 | `5c0e1c8d1d0cd57affa95d427be3af4ce7cfc80d`；沒有後續交付，clean起點 | 本輪`git rev-parse HEAD`／`git log`／`git status`；原表19858ef0版保留於Git歷史 |
| 預期產品source | `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`；674個來源/config檔吻合，非部署observed SHA | [source候選](../cosec-20261024-handover-exec-a30e04f1/source-candidate.json)及本機Git blobs核對 |
| 本機artifact參照 | 433檔／14,269,548bytes；manifest SHA256：`189606711dca25c7dbc522903f6657b002efab2edca33ee9bf4a7c22f74ca1b4`；**不是provider deployed-bundle checksum** | [file-set manifest](../cosec-20261025-build-d29cd5ec/artifact-manifest.json) |
| 待批子範圍 | **AP-01／CONTROL_PLANE_METADATA_ONLY**；平台deployment／DB資源描述／Auth配置／CI-artifact-security metadata；非整包AP-01 | [原metadata-only request](../cosec-20261025-ap01-meta-a7885f7a/metadata-only-request.json)，維持未批准 |
| 原範圍狀態 | 原184列及失敗證據不變；native70BLOCKED／114NOT_RUN／0PASS | [原驗收CSV](../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv)及原hash |

## A. Target 聲明（待填）

| 欄位 | 補填值／尚欠 | 來源／核對結論 |
| --- | --- | --- |
| 既有非正式target URL（不開啟） | **UNKNOWN／未找到本輪可核實目標** | [舊provider紀錄](../evidence/2026-10-03-r03-target-vercel.json)只有歷史project描述；[runbook](../../runbooks/neon-auth-demo.md)屬操作規格，不能把其中production或demo示例當本輪UAT部署 |
| 資源owner | **UNKNOWN**；不推定使用者、GitHub帳戶或平台team就是資源owner | [DB owner紀錄](../runtime-parity-and-db-owners.md)的`neondb_owner`是SQL技術角色，不是本輪人類／組織owner證據 |
| 專用或共享／隔離依據 | **UNKNOWN** | [R03 review](../oct3-runtime-target-review.md)明示preview DB/R2 isolation未核實；名稱含demo/staging不足 |
| 可信本機metadata位置／歷史資源ID | **唯一待核實候選**：歷史Vercel project `kossilon-hub-demo`／`prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`，team `team_qvzlsFmfCsLkgItSypqHjw3z`；未確認為本輪可用隔離target | 本輪「you decide」委託規劃；ID來源[2026-10-03 provider metadata](../evidence/2026-10-03-r03-target-vercel.json)，當時source `60a7b9745ce4e66fe3c4e34848a6aba498a6fc26`；非同版部署／owner／存取證據 |
| 關聯DB／Auth／CI metadata範圍 | **UNKNOWN／未獲授權**。另有歷史Neon project `red-morning-00331124`、staging branch `br-fragrant-sunset-aosoylhr`；只作歷史線索，不納入本輪查詢 | [2026-10-04 Phase A](../releases/r01-staging-2026-10-04/phase-a-result.md)記錄no-compute child、Auth未啟用，候選為舊R01 `257fb9d0be17525a305f38bd26001ad8fa45deb8`；[B1結果](../releases/r01-staging-2026-10-04/phase-b1-result.md)仍無可用endpoint。當前存在／可用性未重查 |

上述demo project與staging DB是**不同歷史線索**，沒有證據可把它們合併為本輪test stack。未發現本候選的非正式URL／deployment binding；既有production網址不填作UAT。五個已登記worktree均未找到`.vercel/project.json`；目前`.wrangler/deploy/config.json`只指向生成輸出，`.output/server/wrangler.json`沒有account ID，兩者不證明已部署target。

## B. 既有平台唯讀存取（待填）

| 欄位 | 補填值／尚欠 | 來源／核對結論 |
| --- | --- | --- |
| 現有平台唯讀存取方式／非秘密帳戶識別 | **UNKNOWN** | [歷史Neon metadata](../evidence/2026-10-03-r03-target-neon.json)僅記當時observer；[owner權限說明](../runtime-parity-and-db-owners.md)顯示該SQL observer並非restricted app-role。沒有本輪平台session／connector唯讀存取的有效證明；未查秘密設定或登入狀態 |
| 目前獲授的精確resource／metadata權限範圍 | **UNKNOWN／NOT_AUTHORIZED** | 同上歷史scope不能沿用；[AP-01 request](../cosec-20261025-ap01-meta-a7885f7a/metadata-only-request.json)是待批草案，非現行權限 |
| 本次request明細：工具/operation／IDs／fields／分頁／副作用與用量 | **UNKNOWN，待target與存取確定後只在本機補列** | [E0模板](../cosec-20261025-ap01-meta-a7885f7a/evidence-template.json)仍空，未審閱call不執行 |

**QA Admin與DB存取不屬本表前置條件。** 平台metadata讀取須用既有平台唯讀權限；不需要QA帳戶、Auth session、DB憑證、client或SQL。若現有平台存取不足，只標blocked，不重新登入／新增OAuth consent。QA identity與DB server/role/catalog各在後續獨立範圍另批；原Core角色及資料條件沒有豁免。

## C. HKT 時窗及授權（待填，預設未授權）

| 欄位 | 填寫 |
| --- | --- |
| 決定 | **NOT_AUTHORIZED**；沿用前輪只補表／不連外邊界，本輪「you decide」用於候選與步驟規劃，不推定owner或存取權限 |
| 批准者／對上述target的授權身份 | **UNKNOWN／待使用者確認**；本機資料未能證實，不推定使用者是owner |
| 有效開始 HKT（含日期與+08:00） | **UNKNOWN／待使用者確認：YYYY-MM-DD HH:mm:ss +08:00**；查找時間不作授權開始 |
| 有效截止 HKT（含日期與+08:00） | **UNKNOWN／待使用者確認：YYYY-MM-DD HH:mm:ss +08:00** |
| 配額決定 | **PROPOSED_NOT_APPROVED：20次／10MiB／30分鐘**；來源：原AP-01 request及本輪使用者指示，仍待確認 |
| 批准時綁定的本表／request明細版本或hash | **UNKNOWN／未有批准綁定**；本輪查核基線為上列5c0e1c8d，不是執行批准 |

**預填待批上限：** 1個既有target；metadata讀取總共20 attempts（部署6＋DB資源4＋Auth配置2＋CI/artifact/security4＋安全重試/page預留4）；response合計10MiB、單次≤1MiB、有界頁≤20項；總時長≤30分鐘且不得超出上列HKT截止。沒有自動polling／重試，失敗、page、redirect及明示安全重試都扣20次；權限拒絕不換路徑重試。

**固定排除／上限0：** 開Kossilon頁面或app/API/RPC、QA登入／Auth session／magic-link／invite、DB連線/query/client/compute喚醒、browser、業務／個資讀取、artifact/object檔案下載、上傳、provider processing/send、帳戶/role/profile變更、資源建立、付費服務新增費用、刪除/dispose、push/merge/deploy。Metadata response才計入10MiB；不讀秘密env values。工具副作用或實際用量無法界定、target/版本不符、到期或配額不足即停依賴部分，不自動擴scope。

## 未核實值（保留未知，日後只讀取得後才記錄）

實際deployment/runtime/source SHA、provider artifact checksum及種類/範圍、DB project/branch/declared endpoint、Auth tenant、CI及安全disposition：**UNKNOWN／NOT_RUN**。Owner填A欄屬聲明，並非已獨立核實metadata。這些值不得用上方本機SHA、alias或歷史SQL target代填。

證據按[E0–E6清單](../cosec-20261025-ap01-meta-a7885f7a/AP-01-METADATA-ONLY.md)保存：scope/request明細、deployment、DB資源、Auth配置、CI/artifact/security、request/失敗/bytes帳及disposition/hash manifest；秘密與個資不入log。只封存本機sanitized證據並結束讀取，不動既有平台session或遠端資源。

**填妥不會自動執行。** 必須有人類明示授權、target／既有存取／request明細／HKT／配額均可核對後，才可在已批准範圍另行開始；metadata吻合亦不等於QA／DB／RLS／員工旅程PASS。這份交付本身全部未批准／未執行。
