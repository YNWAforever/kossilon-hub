# R22 — 本機鍵盤及 reflow

最終 `browser-04.txt`：**2 project tests passed**，既有 Edge channel、1 worker，mobile390 與 desktop1280 起始 viewport；兩者再轉 640×450 CSS px。每個 test 都走 Admin Amy Chan 與 Staff Mei Lam。原歷史 9 檔 bytes guard 通過。

實際操作：Tab/Enter demo 登入、drawer focus trap／Escape 返回 trigger、可見 focus cue、角色導航、客戶 demo-unavailable 空態、既有 fallback 到周年申報 board、搜尋 Delta Bloom fixture、開 detail、讀取付款／簽署／覆核／文件阻礙、拒絕修改、reload 後值一致、鍵盤返回 board。Admin 管理表格控制 disabled；Staff 直接進 `/admin` 被拒，再返回總覽。browser guard 只允許本機 origin GET/HEAD；外站或寫入 request 會 abort 並令測試失敗，最終沒有被攔截的 request 或 pageerror。

`CI=true` 禁止重用 server；port 5180 在啟動前 bind probe 為空，server 由本輪 Playwright 在候選 cwd 啟動。DB/Auth env 缺席，沒有 .env／.dev.vars／wrangler identity；只有 .env.example。沒有 native Auth、API write 或 DB saved-state 的證據。實際客戶紀錄 → case → client-context return 不在 demo 內，未用假頁代替。

640 CSS px 只是 layout reflow，**不是實際 200% browser zoom**。390 起始只覆蓋 login／navigation／notice；後續 case 旅程在 640 px，不能當全程 390 px、物理手機、Safari、screen reader 或完整 UC196/197 通過。

原始 authored/static receipt `R22-reflow.md` 保留；parent 後續調整了測試同步與 locator，其舊指紋不是最終檔案指紋，最終以 source manifest 為準。

失敗歷史完整保留：

- `browser-01.txt`：sandbox server startup 沒有到測試，parent 中止；無 browser pass。
- `browser-02.txt`／`browser/attempt-02`：2 failed；drawer entrance animation 中即時讀 geometry 的競態；客戶 route 正確序列化預設 q/status/team/includeFixtures，使 authored 的裸 URL 斷言不符。改為等候同樣嚴格 geometry，並明確核對全部預設 query 及無 cursor。
- `browser-03.txt`／`browser/attempt-03`：2 failed；getByLabel exact 對包含 option text 的 implicit label 不適用。實際 accessible snapshot 為 combobox「付款／簽署／覆核」；改用相同角色及 exact accessible name。沒有改成任意 select 或刪除 disabled/value 期望。
- `browser-04.txt`／`browser/final`：2 passed；14 張本輪 screenshot 及 results JSON。沒有產品源碼變更，沒有把測試設計問題寫成已修產品缺陷。

仍有既有 console warnings（TanStack route exports、Radix dialog description）；本輪沒有因此改動無關 source。
