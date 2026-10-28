# UC160 註冊／變更子路由 — 本機交付

本機範圍已補同版驗收；正式／原生接受仍 **NO_GO**。UC160 / F19 / R15;R22;R26 / LA33 原編號及原始結果保留。既有 `43e2b9765cb8174fcd154b94c268c5b73e587373` Outlet 修補正確，沒有再改產品程式。

## 版本與差異

- 來源候選普通本機 commit **`99b2dec789264003e254fa77eee362b6ef2d4189`**，亦見 `source-candidate.json` / `release-candidate.json`；parent `36dad48dc30a86329f0afcc2ffb46749be71e94e`。
- Branch `codex/cosec-20261023`，root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`。交付前 remote main 唯讀核對仍 `1c57a67213af72bff8d776694e6ed8c986b921db`。歷史 production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 沒有存取或變更。
- 新增22項真 Router interaction 及兩筆 memory-only fixture helper；既有 Auth test 改用可控制的 pending→rejection，同時保留拒絕／無私有資料／denied URL／單次 provider call 斷言。只改3個 test/helper檔，沒有 production source／schema／provider／配置更動。
- `source-verified.json`、測試前後 freeze 及候選 Git blobs 共640個 source/config檔逐一相同。最終源碼全量測試後沒有再改動。獨立唯讀 review 無 actionable findings；該 review 沒有代跑測試。

## 本次實測

| 層級 | 本次結果 |
| --- | --- |
| Final full unit | **2,617 passed / 273 files**；0 failed/skip/unhandled；`unit-verified.*` |
| Final related unit/component | **92 passed / 9 files**；其中新UC160 interaction22；`targeted-verified.*` |
| Typecheck | exit0；`typecheck-final.*` |
| Lint | exit0／0 error；1項既有 work-queue Fast Refresh warning；`lint-final.*` |
| Build | exit0；`build-final.*`，未部署；bundle/plugin warnings 保留於log，`.output`指紋在 `build-artifacts.json` |
| Local browser final | **12 passed**，Edge155.0.4283.62；production route/components + 真 Router/history；0 external/page/console/HTTP errors；`browser-results-green2.json` |
| Historical negative control | `43e2b97^` 精確 parent route snapshots，**2 failed**：兩域 URL 已進詳情但仍見列表、detail reads=[]。不覆寫 working files；`browser-results-historical1.json` |
| Native Auth / HTTP / DB / RLS | **BLOCKED / NOT_RUN**；本輪沒有 DB client、migration、seed、真實外發或業務寫入 |

Browser涵蓋列表→詳情的 URL／DOM、page3 Back／Forward、返回 anchor、copied/direct URL、實際 reload 後新 QueryClient 再讀 stub 資料、第二 ID、空態、malformed零讀取、missing、403／503 explicit retry、離開 pending 頁面後晚回應不重開詳情。同一 pending ID 重複導航只有1次transport read；另一ID先回、第一ID最後回，畫面和URL仍屬最新案件。

reload readback 只改／讀本輪 sessionStorage memory stub（地址 `QA reload readback`、變更報價 `HKD9,160`），不是 DB保存、真付款或原生 server-function transport。Auth/root context 與 create dialogs 為 stub；角色拒絕只證明 UI 契約，真 policy unit同跑但不代替原生身份/RLS。

## 保留的失敗與完整性

- 第一輪 full unit **1 failed / 2,616 passed**，同一 Auth test 單獨可過；控制pending後 **1 failed / 8 passed**，確認「開始呼叫」與「拒絕已render」的測試時序問題。修正同步後Auth9、相關92及完整2617均實際重跑；原失敗log沒有覆寫。
- 初始UC160測試12個及其後1個測試契約／marker錯誤，以及browser JSX parse timeout、alias stub setup failure均保留原始source snapshots／log／receipt，沒有當成產品紅燈或成功。詳見 `UC160.md`。
- CSV完整保留 **35F／15R／100UC／34LA** 原始列、關聯、JSON與native結果；只在UC160/F19/R15/R22/R26追加本機 `PARTIAL_SCOPED`。LA33的關聯保留，不宣稱設定用量已驗。
- **70 BLOCKED／114 NOT_RUN／0 native PASS**；不沿用歷史2076／4pass5fail為本次結果。歷史9批 **1,527** 個manifest檔案均核對原bytes；本批SHA256 manifest與總驗證結果另附。
- Fresh context／own browser/server已結束，精確本輪路徑剩餘程序0；沒有停止其他工作或清理共享資源。專用cache原位保留。資源低於門檻的拒絕launch記錄保留，後續新通過不抹去舊讀數。

## 未完成與回復

同版原生站、Staff A/B、完整production root/auth guard、server-function HTTP、DB/RLS及業務持久化reload仍受阻；screen reader／實體裝置未驗。對外整合／正式可用不能由這次本機stub推論。下一步在獲准同版原生target補齊這些證據；沒有要求或等待聊天提供秘密。

沒有 push、merge、deploy、開main自動部署、正式migration／資料／帳戶／權限、訊息、付款或交件。回復為普通新commit revert來源候選SHA；保留已發布歷史與稽核證據，無正式資料回復動作。
