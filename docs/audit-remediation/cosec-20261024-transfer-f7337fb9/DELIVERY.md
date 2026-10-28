# UC166 股份轉讓無效參數 — 本機交付

UC166 本機驗收已完成；原生接受維持 **BLOCKED / NO_GO**。保留原 UC166 編號及原始未測結果，沒有新增 F/R/LA 關聯。

## 版本與成果

- 來源候選 **`b367ee3eac2c09ee468c010bcfffab69b022adb9`**，parent **`c6c8a74be1377c57b73dd9870056441cd8e34e33`**。普通本機 commit，11個來源／測試／registry 檔案。
- 共用純 schema 從 server-fns 移至 `create-input.ts`，保留原 re-export。沿用既有受讓人 XOR 拒絕，補齊 trim／空白→null、雙受讓人兩個欄位的錯誤，以及現有 SQL `integer` 的股數範圍1–2,147,483,647；沒有改 DB schema。
- 新的 `createCorporateChangeRequestForActor` 先驗證、再查真正 company team／套用既有 policy；RPC 從 request 取得 actor，忽略 payload 的身份。Repository 對內部股份轉讓呼叫也在 transaction 前驗證。
- UI 將繁中錯誤文字關聯到欄位、聚焦錯誤輸入，拒絕後保留草稿；數字未填時仍可獨立顯示受讓人提示。切換模式仍只送出一種受讓人。同步 pending 提交由 ref 去重，未知 server error 只顯示安全說明。
- 既有 dialog 測試的 `company-1` 等假 ID 改成合法 UUID；原 payload／回呼／disabled 斷言保留，原檔 snapshot 保留。沒有改期望迎合產品缺陷。

Root `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`；branch `codex/cosec-20261023`；origin `https://github.com/YNWAforever/kossilon-hub.git`。Intake clean，交付前 remote main 唯讀核對仍 `1c57a67213af72bff8d776694e6ed8c986b921db`。歷史 production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 未存取。

## 本次實測

| 層級 | 本輪真實結果 |
| --- | --- |
| 首輪 regression | **19 failed /80 passed /10 files**；`targeted-red1.*`。包含欄位指向／提示失敗，不能解讀成19個可寫入缺陷。 |
| Review 回歸 | **1 failed /10 passed**；`focus-review-red.*`。數字空白會讓 full parse 在 superRefine 前中止，缺少 new-holder blur 提示。共用獨立受讓人 schema 修復。 |
| 最終相關 unit/component | **116 passed /11 files**；`targeted-final.*`，涵蓋 schema、真 domain service／policy、dialog、UC160／UC164 及 DB registry convention。 |
| 隔離 SQL | **9 passed /1 file**；`db/test-green2.*`。注入 actor + 真 SQL repository／獨立 observer，不是原生 Auth／HTTP／RLS。 |
| Edge 基線反證 | 精確 base UI overlay，**6 failed /3 passed**；`browser-results-historical4.json`。Shared schema/service 保持修補版，因此是 UI 反證範圍。 |
| Edge 修補版 | **9 passed**，Edge155.0.4283.62；`browser-results-green1.json`。0 external／unstubbed boundary／page／console／HTTP errors。 |
| Typecheck／lint／build | 均 exit0；`typecheck-final.*`、`lint-final.*`、`build-final.*`。Lint1項既有 work-queue Fast Refresh warning；build既有 bundle/plugin warnings 保留，產物指紋 `build-artifacts.json`，未部署。 |
| 完整 unit suite | **本批未跑**；116項是按影響選取，歷史2685／2076不算本批結果。 |
| 原生 Auth／server-function HTTP／DB-RLS／持久化 reload | **BLOCKED / NOT_RUN**。沒有原生 target 存取或正式寫入。 |

## 拒絕、交易及資料回讀

SQL9個情境：service 拒絕、repository 拒絕、原 SQL constraints、角色拒絕、新股東／現有股東／DB integer上限正向控制、第3個 checklist 子項失敗、work-item 子步驟失敗。

缺受讓人／雙受讓人／空白名稱及0、負數、小數、NaN、Infinity、超範圍等直接輸入，核對具體 issues/code，並由另一 backend PID 的 observer 比對完整 rows + `xmin`；申請、checklist、work items、events／timeline／outbox、公司與股權名冊均保持原 baseline。角色涵蓋跨團隊 Staff／Manager、inactive Admin、無 team、Client 及缺 DB identity；純 unit 另有 Admin positive control。

成功控制讀回 **1個申請、5個 Missing checklist、1個正確 owner/team/source event 的工作項目**。股權名冊 rows／xmin 未改；這次建立申請沒有執行名冊轉讓。故意令第3個 checklist 或 work item INSERT 失敗時，申請及先前 children 一起 rollback，測試 trigger/function 的 DDL 亦隨 transaction 回滾。不是把部分成功改標為拒絕。

每次 client／migration／fixture／cleanup 前，核對專用 Docker endpoint、固定 image、精確 container ID／labels／mounts／tmpfs／loopback mapping，以及 Node內建 read-only TCP SCRAM probe 與 container 的 `pg_control_system` 身份；不能只憑 localhost／test 名稱。

- 成功 target：container **`a5edf66bebc0004fb008f934c2f5b8e47490ff82dc19b64d162425c22ce97c90`**，system ID **`7700116422122385447`**，DB `cosec_transfer_f7337fb9`；512MiB、1CPU、1GiB tmpfs、無 mount、restart=no、pull=never。
- 每個 scenario／attempt 的精確 IDs 及 child-first cleanup journal 均保留。Observer 確認 owned rows 全0、所有 public business counts 回到 baseline，再重新核對身份移除整個 container；不可變3個 foundation records 只隨 owned tmpfs 移除，沒有 trigger bypass。
- 首個失敗 target container `a4bbff7da68b64925da243d62fc54d2bad2271f55fa9a27c65508fc5754a9b2b`／system ID `7700114648708223016` 另有獨立證據，不能用新 target 成功倒填舊結果。兩個 container 均核實 absent、兩組 credentials 已移除，其他資源未動。

Edge 使用實際 dialog／styles、schema 與 create/read domain service；root身份、RPC、register及repository為本輪 memory/sessionStorage adapter。先核對 run／instance／root／port 再建 fixture，禁止外連／未 stub 邊界。無效 submit 的部分案例明確使用程式繞過 disabled/native validity，正向控制則點擊實際 enabled 按鈕。實際 reload 以新 document／QueryClient／boot 及新增 read 記錄核對同一申請；只證明該 sessionStorage ledger 的回讀，沒有把它當成 DB 保存。

## 保留的失敗與完整性

- `targeted-green1.*` 保留 **1 failed /98 passed**：空 existing-holder 錯誤曾是英文 `Invalid uuid`，改成欄位繁中提示。獨立 review 的1項 P2 已重現及補測修復，沒有獨立重審宣稱。
- `typecheck-first.*` 的3項 UI type errors 及 snapshot 保留；修正明確 return type／DOM target narrowing。`lint-first.*` 保留 SQL test 草稿128項問題（127格式、1 unused import），完成格式化／移除未用 import後最終 lint 通過。
- SQL首輪 **4 failed /5 passed** 保留。合成 calendar 錯用 `mon/tue`，現有 Weekday 要求全名；沒有改產品邏輯或測試期望。先核實零殘留並移除舊 target，另建新 target／新 fixture IDs，用正確合成 schedule 重跑；詳見 `db-calendar-repair.md`。
- 首次 SQL provision 在 **2,753,892,352 <3GiB** RAM gate 停止，未建 container/client。後續新 attempt 重新通過原門檻；沒有停止他人程序或降低標準。
- Browser `historical1` 為 Windows自動加入的4個 OS變數名稱 allowlist preflight；`historical2` 為虛擬 JSX entry 編譯失敗；`historical3` 因 Vite開發 HMR 觸發禁止 WebSocket 邊界而混有失敗。全部原 log／result／snapshot 保留。修正腳本 entry、以 direct CSS 載入真樣式後，`historical4` 才是無 boundary errors 的有效反證；沒有放寬禁止外連／WebSocket斷言。
- **655** 個 source/config 指紋在最終各項檢查前後相同，再與來源 commit Git blobs 逐一核對。這不是完整 unit suite 已執行的宣稱。
- **13批／2,029個 prior manifest 檔案** 原 bytes 核對通過；UC164依其 FINAL manifest驗證，保留舊包裝失敗。CSV保留 **35F／15R／100UC／34LA** 原始列、關聯及 JSON，只追加 UC166 本機 evidence。

## 未完成及回復

Native matrix仍 **70 BLOCKED／114 NOT_RUN／0 PASS**，release_gate=NO_GO。同版原生角色／Auth middleware、server-function HTTP、DB/RLS及持久化 browser reload仍 blocked；實體裝置、Safari/WebKit、screen reader未驗。

本批只驗拒絕後修正重試及同一 UI pending 去重；不承諾跨頁／遺失已提交回應後的新請求去重。股份存量／轉讓完成及已核准真實假期 calendar 屬既有分開範圍。下一步可按計劃核對下一個可獨立本機情境；原生缺口需獲准的同版 target 才能續驗。

回復為普通新 commit revert來源候選 `b367ee3eac2c09ee468c010bcfffab69b022adb9`，保留 evidence／已發布歷史，無正式資料回復步驟。沒有 push、merge、deploy、開main自動部署、正式migration／資料／帳戶／權限、訊息、付款、交件或付費provider操作。
