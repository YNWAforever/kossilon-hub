# UC159 本機交付 — Checklist 可及性

Run cosec-20261024-checklist-59870455。來源 096f491db9d174f3d183db8788ae934a2da75ff8；parent 347fdbcb540456863d5a93a9cdb21a9471e9416c；branch codex/cosec-20261023。main 唯讀重核仍為 1c57a67213af72bff8d776694e6ed8c986b921db。工作與證據都在指定 worktree，未讀寫正式資料；production SHA 只保留使用者提供的歷史參考。

## 成果

五項 checklist 的名稱唯一（包含重複 document label）、保存保持可聚焦、pending 防重複及 Tab 可離開、不搶走使用者已移開的焦點。逐項錯誤關聯 alert／aria-describedby／aria-invalid，保留失敗選擇並明確重試；必須確認返回的 case／item／status 才宣告保存，只 patch 同列 cache，覆蓋不同列倒序回應及換案 late result。既有權限、schema、repository 不改；原 server command 抽成同版測試 seam。見 UC159.md／source.patch。

## 本輪實際檢查

| 層 | 結果 |
| --- | --- |
| Component 原版重現 | 5 failed／7 passed（12 tests）；原 source/test snapshot 與 raw log 保留 |
| 最終聚焦回歸 | 51 passed／5 files，含新 component9、既有 component4、command／authorization／DB registry convention |
| 完整 unit | 2595 passed／272 files；0 failed、0 skipped、無未處理錯誤 |
| Headless Edge 本機鍵盤 | 原 snapshot3 failed／修補版3 passed；Edge 155.0.4283.62，RPC/router in-memory stub |
| 真隔離 SQL | 兩個獨立 target、兩組新 IDs；每輪1 it passed，25 transitions／25 logical retries／7拒絕，不與 unit 加總 |
| Typecheck／lint／build | 最終 exit0；lint1個既有 warning。首輪 lint no-unsafe-finally error 另存，未刪改 |

完整 unit／build 執行後只修改 SQL integration test 清理錯誤彙報，該檔在 unit project 明確排除。產品、unit tests 與其他五個 source bytes 不變；修改後再跑51項（含 convention）、typecheck、lint，及另一個核實 target 的 SQL。source-freeze／source-final-freeze、原 SQL snapshot 與 source-candidate 逐檔證明，沒有把原整體 commit 冒稱執行了同一套完整 unit。所有最後來源 Git blobs 等於各自已驗證 bytes。

## 實際 runtime 及限制

Edge 載入真正生產 component，原版 pending 實際 disabled=true／focused=false／active=BODY。修補後真鍵盤五次保存、新 QueryClient 重開讀回五個 Rejected；pending Tab 移動、重試按鈕 Enter 後回到 select。它使用自己的 loopback target、stub store、無完整 app CSS；不是 native Auth／HTTP／RLS／screen-reader／實體裝置或產品 route reload。早期 EACCES／router export／blank startup／optimize-dep504／pending DOM race 另列 harness 診斷，產品 RED 以 red5 為準。

SQL 透過同一 actor command、既有 repository 及兩個不同 backend PID，真實提交並讀回五列各 Received→Verified→Rejected→Missing→Received。notes／業務 timestamps／其他列核對；同值 retry 仍依既有 SQL 更新 updated_at／xmin，沒有宣稱零重複 writes。Client、inactive、跨 team、無 identity、missing case、wrong-case item、persisted inactive user 的七種拒絕前後完整 rows（含 xmin／updated_at）相同。這些 actor／public user 是隔離合成資料，不是真登入角色。

SQL 與 browser 是獨立證據層，沒有拼接宣稱完整端到端。原生保存後真 reload／API transport／app-role/RLS 與真 screen reader 缺口仍 blocked／NOT_RUN。

## 隔離、失敗與清理

兩次 client 前核對 Docker Desktop npipe、完整 pinned image／container ID、labels、loopback mapped port、mounts=[]、tmpfs／memory 與實際 cache／evidence 路徑；TCP system ID 與 container 相符。只套50個既有 schema migrations，不 seed／SLA foundation。兩 target／system IDs 與精確 fixture UUIDs 見 readback-summary、db／db-final。

每輪 exact-ID cleanup0，teardown 前teardown 明列的 business／bulk／incorporation 表全0；自己的容器及憑證均已移除，初輪313／末輪313個既有容器與 daemon 保留。八批舊 manifest／1419個檔案全數 hash 相同。所有失敗與初版 handoff append-only 留存；最終 evidence-manifest 及 verifier 另核對。

## 未完成及下一步

原184列／35F／15R／100UC／34LA 保留；native **70 BLOCKED／114 NOT_RUN／0 PASS，NO_GO**。本輪只追加 UC159／F19／R22／R26 的 PARTIAL_SCOPED，不關閉原生 gate。具體限制見 blockers.md。

沒有 push、merge、deploy、開 main 自動部署、正式 migration／資料／帳戶／權限或真實訊息／付款／交件。回復為普通新 commit revert 來源 SHA，保留歷史與證據；沒有正式資料回復操作。下一批先核對 UC160 註冊／變更子路由的既有覆蓋，使用新 run／重新 gate；原生缺口維持 blocked。
