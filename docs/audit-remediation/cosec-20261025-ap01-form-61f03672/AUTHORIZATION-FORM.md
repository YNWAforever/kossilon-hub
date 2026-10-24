# AP-01 metadata-only：最小 target／唯讀存取／HKT 授權表

**目前：只準備、未授權、未執行；原生 BLOCKED／NO_GO。** 請直接修改「待填」欄；不確定填「未知」，沒有隔離站填「無」。提供URL或存取識別不等於批准。不要填密碼、token、cookie或秘密連線字串。

## 已核實／預填（本機證據）

| 欄位 | 預填值 |
| --- | --- |
| Repo／branch | `https://github.com/YNWAforever/kossilon-hub.git` ／ `codex/cosec-20261023` |
| 本表交付基線 | `caefa0f2f88d4694d83800fbfaa0d8b2468abfa1` |
| 預期產品source | `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1`；674個來源/config檔已核對。這是expected，非部署observed SHA |
| 本機artifact參照 | 433檔／14,269,548bytes；[file-set manifest](../cosec-20261025-build-d29cd5ec/artifact-manifest.json) SHA256：`189606711dca25c7dbc522903f6657b002efab2edca33ee9bf4a7c22f74ca1b4`。**不是provider deployed-bundle checksum** |
| 待批子範圍 | **AP-01／CONTROL_PLANE_METADATA_ONLY**；只讀平台deployment／DB資源描述／Auth tenant配置／CI-artifact-security provenance metadata，不是整包AP-01 |
| 原範圍狀態 | 原184列及失敗證據保留；native70BLOCKED／114NOT_RUN／0PASS |

## A. Target 聲明（待填）

| 欄位 | 填寫 |
| --- | --- |
| 既有非正式target URL（僅字串比對，不開啟） | **[待填／無]** |
| Owner／能確認隔離與讀取範圍的人 | **[待填]** |
| 專用或共享；非正式用途／隔離依據 | **[待填／未知]** |
| 可定位該target的精確platform project/deployment ID或可信metadata連結 | **[待填]** |
| 本次還允許查哪些關聯resource IDs／metadata連結（DB branch／Auth tenant／CI；不知可填未知） | **[待填／未知；缺綁定部分維持blocked]** |

## B. 既有平台唯讀存取（待填）

| 欄位 | 填寫 |
| --- | --- |
| 平台／工作區／既有connector或安全存取位置；非秘密帳戶識別 | **[待填]** |
| 現有唯讀權限所涵蓋的精確project/resources及metadata欄位（可刪減預填子範圍） | **[待填]** |
| 本次request明細引用：工具/operation、target IDs、fields、分頁、唯讀副作用與用量檢查（可由執行者取得target後先在本機補妥） | **[待填；未綁定／未審閱的call不執行]** |

**QA Admin與DB存取不屬本表前置條件。** 平台metadata讀取須用既有平台唯讀權限；不需要QA帳戶、Auth session、DB憑證、client或SQL。若現有平台存取不足，只標blocked，不重新登入／新增OAuth consent。QA identity與DB server/role/catalog各在後續獨立範圍另批；原Core角色及資料條件沒有豁免。

## C. HKT 時窗及授權（待填，預設未授權）

| 欄位 | 填寫 |
| --- | --- |
| 決定 | **[未授權；如日後明示批准，填「只批准本表metadata-only範圍」]** |
| 批准者／對上述target的授權身份 | **[待填]** |
| 有效開始 HKT（含日期與+08:00） | **[待填：YYYY-MM-DD HH:mm:ss +08:00]** |
| 有效截止 HKT（含日期與+08:00） | **[待填：YYYY-MM-DD HH:mm:ss +08:00]** |
| 配額決定 | **[待填：接受下列建議或填更低上限；不可默認增加]** |
| 批准時綁定的本表／request明細版本或hash | **[待填]** |

**預填待批上限：** 1個既有target；metadata讀取總共20 attempts（部署6＋DB資源4＋Auth配置2＋CI/artifact/security4＋安全重試/page預留4）；response合計10MiB、單次≤1MiB、有界頁≤20項；總時長≤30分鐘且不得超出上列HKT截止。沒有自動polling／重試，失敗、page、redirect及明示安全重試都扣20次；權限拒絕不換路徑重試。

**固定排除／上限0：** 開Kossilon頁面或app/API/RPC、QA登入／Auth session／magic-link／invite、DB連線/query/client/compute喚醒、browser、業務／個資讀取、artifact/object檔案下載、上傳、provider processing/send、帳戶/role/profile變更、資源建立、付費服務新增費用、刪除/dispose、push/merge/deploy。Metadata response才計入10MiB；不讀秘密env values。工具副作用或實際用量無法界定、target/版本不符、到期或配額不足即停依賴部分，不自動擴scope。

## 未核實值（保留未知，日後只讀取得後才記錄）

實際deployment/runtime/source SHA、provider artifact checksum及種類/範圍、DB project/branch/declared endpoint、Auth tenant、CI及安全disposition：**UNKNOWN／NOT_RUN**。Owner填A欄屬聲明，並非已獨立核實metadata。這些值不得用上方本機SHA、alias或歷史SQL target代填。

證據按[E0–E6清單](../cosec-20261025-ap01-meta-a7885f7a/AP-01-METADATA-ONLY.md)保存：scope/request明細、deployment、DB資源、Auth配置、CI/artifact/security、request/失敗/bytes帳及disposition/hash manifest；秘密與個資不入log。只封存本機sanitized證據並結束讀取，不動既有平台session或遠端資源。

**填妥不會自動執行。** 必須有人類明示授權、target／既有存取／request明細／HKT／配額均可核對後，才可在已批准範圍另行開始；metadata吻合亦不等於QA／DB／RLS／員工旅程PASS。這份交付本身全部未批准／未執行。
