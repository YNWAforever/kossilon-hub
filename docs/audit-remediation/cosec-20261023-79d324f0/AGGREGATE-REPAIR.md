# 整體檢查第一輪與檢查器修正

來源 commit `8bc1e0dea88c5796c37b2f32a781fac7aab31774` 的第一次完整 unit 結果為 **265 files，2459 pass／5 fail／2464 total**，保留於 `unit-candidate-8bc1e0d-first.txt` 及 `unit-candidate-8bc1e0d-result.json`。沒有把失敗或未執行計作 pass。

1. `-final-review-restorations.test.ts` 以原始碼字串要求直接 `await getAuthenticatedActor()` 與無參數 `<AuthProvider>`，與已通過真 router 回歸的有界 Auth／按 actor 清理／跨 error boundary 保存登出意圖結構不相容。只更新該架構檢查，明確要求 timeout 包裹、QueryClient-bound `AuthSessionBoundary` 與 actor-keyed provider；其他 auth guard、QueryClient、protected shell、error boundary 等期望保留。不是把產品錯誤改成期望。
2. `status-text-contrast.convention.test.ts` 將 file URL 的 `.pathname` 當作 Windows 檔案路徑，產生 `C:\C:\...`，所以未能執行顏色檢查。改用標準 `fileURLToPath`。仍檢查超過100份 source，並維持零違規期望。
3. 三個 `dev-worktree-watch.test.ts` 因父 runner 把 OS TEMP 覆蓋至 `node_modules/.cache`，其 watcher fixtures 也落在 Vite 正常忽略的 node_modules 路徑而無法觀測。使用正常 OS TEMP 後重跑，原測試及產品 watcher 完全未改；仍要求觀測 active source、排除其他 worktree，含 nested／特殊字元根路徑及精確 owned cleanup。

三檔 targeted 實際結果為 **11 PASS**，`aggregate-failures-focused-green.txt`。兩個有改動的測試 lint PASS（`aggregate-failures-lint.txt`），整體 typecheck PASS（`typecheck-aggregate-repair.txt`）。修正以普通本機新 commit `e8ecf3fad979adc4321a58eb64a90d0927e175de` 保存，只有兩個測試檔案、7新增／3刪除；沒有修改產品 runtime、DB、watcher 或斷言以繞過故障。

先前同版 SQL `8bc1e0d` 的 **16 files／146 PASS** 完整保存於 `evidence/db-8bc1e0d/`。SQL query log 以 gzip 無損保存，解壓 SHA256 回驗與原始 log 相同；原始45MB log另留於忽略的本輪 cache。其 observation query 第一次誤用不存在的 `bulk_operations`，在測試 import 前停止；核對 migration/repository 的實際 `bulk_operation_jobs` 後才執行測試。此錯誤單獨記錄於 `db-candidate-observer-first-failure.json`，不是產品 regression。

為交付同一精確候選，完整 unit 與16檔SQL均以最終 `e8ecf3f` 再執行一次；以各最終 `*-candidate-result.json` 為準。未重寫舊 commit 或舊失敗證據。這不新增 native Auth、provider、排程或正式接受。
