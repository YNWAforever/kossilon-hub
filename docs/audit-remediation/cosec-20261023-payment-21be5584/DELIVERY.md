# Kossilon UC155 本機驗收交付

UC155「同一 proof／sourceVersion，一人批准、一人退回」的本機 SQL 層已補齊。六個方向／金額情境全部通過：真正鎖等待後只有一個決策提交，輸家收到 409／version_conflict，金額、日期、憑證歸屬及審計回讀一致，重試沒有增加款項或覆寫結果。未重現付款產品缺陷；既有 root-cause 防護保留，只新增回歸測試及 DB registry。

候選 source commit **3f2eeb3a4eb4ccb05535f19ac2136a2bafc6a093**；父版 **a6d5d89d0bf9c020ec9b98e0eed8749e13de5b24**，branch `codex/cosec-20261023`。遠端 main 只讀核實仍為 **1c57a67213af72bff8d776694e6ed8c986b921db**。production 提供的舊 SHA 未重新接觸或當成本輪證據。`source-candidate.json`／`git-blob-equivalence.json` 綁定測試檔案 bytes 與候選；最終文件提交只包含本交付資料夾。

- SQL：1 file／6 passed；每例三個實體 sessions 與 pg_blocking_pids；兩個舊 token ＋兩個 fresh token 重試皆 409。見 [UC155](UC155.md)、[實際回讀](readback-summary.json)、[SQL log](db/db-payment-accepted.txt)。
- Unit/component：5 files／76 passed，包含 20 個付款 component 測試。見 [log](targeted-accepted.txt)。typecheck／lint exit 0；lint 一項既有 work-queue.tsx:49 Fast Refresh warning。
- 未重跑 full unit、build 或 browser：本輪只改測試及 registry，application／build／dependencies 不變。前批 2497 unit、2076 舊 unit 與 4 pass／5 fail 回歸等保留為各自歷史，不累計成本輪結果。
- 隔離 SQL fixture 的原始欄位、角色拒絕、審計及重複／並發已執行。Auth/session、HTTP、browser/reload、RLS、storage/scanner 及實際付款均未執行。provider verdict 是本機 stub，沒有正式成功聲稱。

初次漏 staff_profiles、新增 readback 欄名錯誤、numeric 文字格式假設的失敗及快照完整保留，詳見 [嘗試索引](attempts.json)。這些是測試前置／驗收程式錯誤，沒有偽稱產品 RED，也沒有降低「409、正確金額、一次決策／歸屬審計、重試不變」要求。

精確 run-owned DB 資料零殘留，容器與憑證已移除，313 個既有容器全部保留。五批舊證據逐檔 hash 不變；[驗收 CSV](acceptance-results.csv) 保留原 184 列（35 F、15 R、100 UC、34 LA）及全部原始／歷史／native 欄位。UC155／R17／R23 只追加本機 PARTIAL_SCOPED 範圍。

**NO_GO**。原生仍為 70 BLOCKED／114 NOT_RUN／0 pass，UC155 原 native NOT_RUN 保留；缺獲准同版原生 target／角色，不能結案成正式可用。未 push、merge、deploy、正式 migration 或外發。詳見 [候選資料](release-candidate.json) 及 [blockers](blockers.md)。下一個可獨立本機候選為 UC135–137 客戶建立／重複／BR normalization，需先核對已有覆蓋及建立新隔離 run；未在本輪順帶宣稱完成。
