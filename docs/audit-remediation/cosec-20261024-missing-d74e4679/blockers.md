# UC164 本輪保留的 blockers

- **BLOCKED_NATIVE_SAME_VERSION_TARGET**：未提供可核實屬本任務且可使用的同版原生 target／角色。不能由本機 root context／RPC stub 推論 Auth、server-function HTTP status、DB/RLS 或持久化 reload。
- **NOT_VERIFIED_NEVER_SETTLING_TRANSPORT**：本輪證明已返回的 missing／拒絕／503 可結束 loading 並提供安全恢復；原生 request 永不 settle 時的 timeout、斷線及 provider outage 恢復仍未驗。
- **NOT_RUN_FULL_UNIT_THIS_BATCH**：按影響跑75項相關 unit/component；全量 unit 歷史2685／2076不沿用。
- **NOT_RUN_ASSISTIVE_AND_DEVICE**：沒有 screen reader、實體手機、Safari/WebKit 證據。

Native matrix 70 BLOCKED / 114 NOT_RUN / 0 PASS；release_gate=NO_GO。這些缺口不阻止已授權的本機修補與回歸交付，也不授予正式存取或發布權限。資料原編號及失敗證據保持原樣。下一個本機候選 UC166；需已核准 calendar 的 UC134 保留獨立依賴。
