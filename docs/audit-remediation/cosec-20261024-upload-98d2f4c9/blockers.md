# UC150 剩餘範圍

- **BLOCKED_NATIVE**：未有獲准同版原生target/Client身份與resource binding。完整root Auth、server-function HTTP、DB/RLS、R2 bytes/scanner與原生持久化reload未驗。獨立SQL連線/注入session adapter/本機Edge RPC stub不替代。
- **NOT_IMPLEMENTED_BYTE_OFFSET_RESUME**：目前API仍是最多10MiB全檔base64 request。恢復是保存同一邏輯要求、重新選原檔、SHA256核對、由頭重傳或讀回已提交結果。沒有分段/byte-offset/multipart協定，不宣稱已完成此層。
- **SCOPED_DEDUPE**：同actor+uploadRequestId精確metadata去重。不同新request仍可合法additive；不同獨立tab/newrequest不做全域檔案hash去重。首次並發可以兩次相同PUT，但只有一份DB文件/version/jobs/receipt；其後已提交順序重試零PUT。
- **SESSION_JOURNAL_LIMIT**：只保存該tab/session、actor/company/case metadata及隨機request ID，無bytes/credential。清除storage、換device或新獨立session不能自動找回ID；損壞/額滿/無法保存時fail closed，不自動放棄未知要求重建。沒有正式規模/實體裝置/原生網絡斷線的效能證據。
- **NO_GO**：35F/15R/100UC/34LA原列保留，70BLOCKED/114NOT_RUN/0nativePASS。Pending/quarantined/unknown safety保持原狀，無掃描provider/外發/假clean或付款交件。正式schema/資料/帳戶/權限未改。

可review候選、source fingerprints、raw RED/錯誤與CSV另附。需要原生或正式動作時先review精確候選/影響/普通新commit revert回復方案；本輪不push/merge/deploy或改已發布歷史。
