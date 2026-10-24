# UC164 不存在／非法 ID — 本機交付

UC164 本機範圍已補驗並修復返回上下文；原生驗收仍 **BLOCKED / NO_GO**。原 F19、R15;R22;R26 關聯及所有原始結果保留。

## 成果與版本

- 來源候選 **`80a8fc31e797fe0a897bdd6a8b9f82221246a1d2`**，parent **`c9d783478572b1e11331018d46e09e20f427b832`**。普通本機 commit，兩個檔案：公司變更詳情元件及新增13項回歸測試。
- 根因：非法 ID 的 early return 位於安全返回連結之前，員工會失去原清單的搜尋／排序／cursor。現在先保留既有 `caseReturnPath` 連結，再顯示找不到申請；非法 ID 仍不掛載 query、零 RPC。
- 已有的 typed missing→null、錯誤→安全訊息及授權邏輯正確，沒有重寫。沒有 schema、provider、Auth 或 API policy 變更。
- Root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`，branch `codex/cosec-20261023`，origin `https://github.com/YNWAforever/kossilon-hub.git`。交付前 main 唯讀核對仍 `1c57a67213af72bff8d776694e6ed8c986b921db`。歷史 production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 未存取。

## 本次實測

| 層級 | 真實結果及證據 |
| --- | --- |
| 修補前 unit/component | **4 failed / 71 passed / 7 files**；`targeted-red1.*`、`test-red1.tsx.snapshot`。三種非法 ID 及不安全 returnTo 均因缺少安全返回連結而失敗。 |
| 最終相關 unit/component | **75 passed / 7 files**，其中 UC164 新增13項；`targeted-final.*`。實際 pure domain read/authorization，transport/repository IO 注入，沒有 DB。 |
| Typecheck | exit0；`typecheck-verified.*`。 |
| Lint | exit0、0 error、1項既有 work-queue Fast Refresh warning；`lint-verified.*`。首輪2項新測試格式錯誤保留於 `lint-final.*`，只修換行。 |
| Build | exit0；`build-final.*`，產物指紋 `build-artifacts.json`；現有 bundle/plugin warnings 保留，未部署。 |
| Edge 基線反證 | 精確 `c9d7834` 元件 overlay，**1 failed / 8 passed**；`browser-results-historical1.json`。只在 Vite 記憶體覆蓋，不改 working source。 |
| Edge 修補版 | **9 passed**，Edge155.0.4283.62；`browser-results-green1.json`。0 external requests／unstubbed boundary violations／page errors／console errors／HTTP errors。 |
| 完整 unit suite | **本批未執行**。75項為按影響選取的相關測試；歷史2685／2076均不當成本批結果。 |
| 原生 Auth／application HTTP／DB-RLS | **BLOCKED / NOT_RUN**。本批沒有 DB client、DB fixture、migration 或業務資料 cleanup。 |

新增驗收包括非法 ID 零讀取、typed 不存在與暫時故障分流、raw SQL／內部錯誤隱藏、真 domain 跨團隊／無團隊／Client／inactive 拒絕及 Admin positive control、明確重試與 pending 去重、離開／Back 後晚回應不能覆蓋列表、另一案件成功後舊 missing 不能取代它、fresh QueryClient 再讀資料。

Edge 使用實際 production routes/components 與真 Router/history；root Staff 身份、RPC、建立對話框及 sessionStorage 資料為本輪 stub。核對 loopback listener 的 run／instance／root／port 身份後才建立 memory fixtures，拒絕外連及未 stub 的 server 邊界。503／403 是注入的 RPC errors，並非原生 HTTP status。

實際 reload 以新 document ID／QueryClient ID／boot 及新讀取證明回讀：本輪 sessionStorage stub 報價由 HKD1,641 改為 HKD9,164，reload 後第2次讀取、重開 copied URL 第3次讀取。這不是 DB 保存、真付款或原生 API 成功。

## 完整性、失敗及範圍

- `source-final-formatted.json` 與 `source-post-checks.json` 共 **649** 個 source/config 指紋相同，再逐一與來源 commit Git blobs 核對。這證明受檢查的最終檔案內容一致，不表示跑過完整 unit suite。
- 獨立靜態 review 無 actionable findings；review 沒有執行測試。之後只有兩處測試換行，已重跑相關測試/typecheck/lint；沒有獨立重審宣稱。
- 保留4項 unit 失敗、1項瀏覽器基線失敗及2項 lint 格式錯誤的原始 log／snapshot；沒有改期望迎合產品缺陷。較早 commentary 的測試數字已依 raw log 更正，最終以上表為準。
- 12批既有證據 **1,953** 個 manifest 檔案已核對原 bytes。CSV 保留 **35F／15R／100UC／34LA**，只在 UC164 追加本機範圍；原生仍 **70 BLOCKED／114 NOT_RUN／0 PASS**。
- 本輪 Edge contexts／browser／loopback Vite 已關閉，精確 owned 路徑程序0；cache 原位保留。沒有停止其他工作或刪除共享資源。
- 首次 evidence commit 被 authored whitespace gate 拒絕：6個 helper EOF 多空白行，沒有建立 commit。保留 `packaging-failure.json`、9個原檔 snapshot、原 `evidence-manifest.json`／`verification-report.txt`；只修 helper 格式及包裝 metadata。最終以 `evidence-manifest-final.json`／`verification-report-final.txt` 為準，舊63檔 manifest 亦按原 snapshots 重新核對；測試原始 log 不變。

## 未完成、下一步與回復

同版原生站、真正 Staff/Auth middleware、application HTTP 404／503、DB/RLS 與持久化 reload 仍受阻。永不 settle 的原生 transport 未被本機「已 resolve/reject 的注入錯誤」證明有 timeout；screen reader、實體裝置及 Safari/WebKit 未驗。不能宣稱正式可用。

下一個獨立本機 checkpoint 為 UC166：先核對現有 share-transfer schema 無效參數測試，再補 UI 欄位錯誤及半完成寫入拒絕的缺口；UC134 的已核准假期 calendar 依賴保留。

回復使用普通新 commit revert 來源候選 `80a8fc31e797fe0a897bdd6a8b9f82221246a1d2`，保留原證據／已發布歷史；沒有正式資料回復步驟。沒有 push、merge、deploy、開 main 自動部署、正式 migration／帳戶／權限、訊息、付款或交件。
