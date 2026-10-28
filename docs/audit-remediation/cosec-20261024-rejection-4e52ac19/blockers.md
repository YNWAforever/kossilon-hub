# UC149 剩餘缺口

- **BLOCKED_NATIVE**：未有獲核准同版隔離站、原生 Reviewer+Client identities/roles/resource binding。完整 root Auth guard、server-function HTTP、DB/RLS、實際 object bytes、scanner/provider、持久化 reload 未驗。本機 memory stub 或注入 Auth adapter 不替代。
- **NOT_RUN_SERVICE_RUNTIME**：本輪真 SQL 只走 document repository/timeline/read projection 與 membership 函式，Rejected checklist 初態為 fixture；完整 AnnualReturnEvidenceService/SLA/annual_return_audit_events 寫入未做 DB runtime。既有 evidence-service unit 同跑不關閉此 gap。
- **OPEN_UC150**：已 commit 但回應遺失的 finalize 重試、續傳、跨程序/跨分頁重複未解。只驗 known precommit failure、單頁 in-flight 重入防護。
- **NOT_RUN_SCALE**：本輪新增 timeline reason join 沒有正式資料量/效能證據，無正式 migration 或 index 改動。
- **NO_GO**：35F/15R/100UC/34LA 原始/native 列保留；70 BLOCKED/114 NOT_RUN/0 native PASS。不以新 label、toast、受控 scan stub 或本機 SQL 當正式可用。

已授權本機工作及本輪可丟棄資源已持續處理。下一個可獨立情境為 UC150 的已知失敗/不明提交恢復契約；需先覆蓋及重現，不能套用 UC149 的已知 precommit 證據。外部 target 解阻後須依候選 SHA 重新綁定身份與資源。

發布候選如需另行採用：先 review source-candidate/release-candidate、完整 raw logs、CSV、風險及回復。回復只用普通新 commit revert 來源候選，保留稽核和既有歷史；本輪沒有 push/merge/deploy 或正式變更，不存在正式資料 rollback 動作。
