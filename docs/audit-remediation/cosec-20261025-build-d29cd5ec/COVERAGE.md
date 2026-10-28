# 原UC186及核心流程覆蓋更新

沿用[上批核心流程表](../cosec-20261024-handover-exec-a30e04f1/COVERAGE.md)，原184列／原編號／原失敗保持。本輪不重跑或擴充其他UC。

| 範圍 | 已有本機證據 | 本輪新增 | 必須原生驗證 |
| --- | --- | --- | --- |
| UC186／F08／LA26 合法離職交接 | 上批三業務owner/reviewer轉交、角色／team／skill／版本拒絕、重試／取消／audit／SQL回讀、建案／指派與停用六個次序 | 同source4d63818的build實際PASS，674檔不變；原build資源阻擋已有新收據補齊 | 原isolated-staging UAT、真Auth/HTTP/app-role/RLS、reload／換帳戶／舊session仍BLOCKED，原UC仍PARTIAL_SCOPED |
| 身份、Today、開案、文件／付款及三業務工作 | 沿用原表分層證據 | 本輪未重跑，沒有將組件或build當完整員工旅程 | Today→正確案件→安全文件／付款→授權操作→API／資料／reload |
| 批次／通訊、維運及整體可用 | 沿用原表局部SQL／unit等證據 | 本輪沒有任何provider／排程／恢復／效能測試 | 核准calendar／scheduler、backup/storage、可及性／效能及必要provider回執 |

同候選有本機unit／SQL／typecheck／lint／build證據；其中只有build在本輪執行。CI及原生未跑，native70BLOCKED／114NOT_RUN／0PASS，NO_GO。
