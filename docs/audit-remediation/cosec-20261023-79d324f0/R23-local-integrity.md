# R23 — 本輪交付證據完整性

Run: `cosec-20261023-79d324f0`。本文件只記錄離線交付檢查，正式發布保持 **NO_GO**。

新增 `scripts/cosec-delivery.ts` 及 `scripts/verify-cosec-delivery.ts`，沿用既有嚴格 CSV parser。CLI 只讀取明確指定的本輪目錄，不載入 dotenv、DB client、應用程式或 provider，不執行子程序或寫入業務資料。

檢查包含：35 F／15 R／100 UC／34 LA 的原始完整集合、四個原始 CSV 的固定 SHA256、每列所有歷史欄位及原始字串值、重複或遺漏 ID、候選來源 SHA／run ID、scope 與存在的證據檔案。檔案必須解析至本輪目錄內的 regular file，拒絕絕對路徑、URL、控制字元、`..` 及透過 symlink／junction 逃離目錄。

本輪沒有原生接受證據，所以新的 `native_result` 只接受 `BLOCKED`／`NOT_RUN`，候選必須保留 `NO_GO` 與 `auth_runtime_verified=false`。保存於原始欄位內的歷史 pass 不會變成本輪 pass。驗證成功也不證明某份 log 的業務結論正確；親自執行的測試、檔案 fingerprint、審查及 runtime 邊界仍須另行核對。

`R23-evidence-red.txt` 保存新增 verifier 實作前找不到 module 的 collection failure，並非既有產品缺陷的 assertion RED。實作後 `R23-evidence-green.txt` 記錄 **1 file／7 tests pass**，涵蓋正常 184 列、遺漏／重複／替代 ID、歷史值修改、輸入 checksum、錯誤 SHA／run、blocked-as-pass／GO／Auth 假聲明、缺 scope／證據以及路徑逃逸。初次 lint 的控制字元 regex 規則錯誤保留於 `R23-evidence-lint.txt`；改用字元碼檢查後 `R23-evidence-lint-final.txt` exit 0。

`REVIEW-4-evidence.md` 獨立重讀 verifier、七項測試、CSV parser，並核對四份原始 CSV 的實際 bytes/hash 與 184 個唯一 ID；在此固定 run、本機層合約內沒有 actionable finding。該審查沒有執行測試，也沒有把尚在編製的最終矩陣當作通過。

最終 CLI 執行、候選 commit 及整體檢查結果，以 `DELIVERY.md`、`release-candidate.json` 與最終 verifier log 為準。呼叫方式：

```powershell
node.exe --experimental-strip-types scripts/verify-cosec-delivery.ts docs/audit-remediation/cosec-20261023-79d324f0 <已核對的40字元source_SHA>
```

此工具不取代原 100 UC／34 LA 的實際執行，不發出發布、migration、帳戶修改、付款、傳訊或交件授權。
