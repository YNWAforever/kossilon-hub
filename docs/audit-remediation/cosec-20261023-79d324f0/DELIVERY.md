# Kossilon CoSec OS — 本機候選交付

Run：`cosec-20261023-79d324f0`。本機候選來源 commit：`e8ecf3fad979adc4321a58eb64a90d0927e175de`，分支 `codex/cosec-20261023`。**程式與本機／隔離 SQL 證據分開交付；正式接受與發布保持 NO_GO。** 本機實作及以下授權範圍驗證已完成；完整原生接受仍按 blockers 保留。

工作目錄：`C:/Users/laich/Documents/kossilon-hub/cosec-20261023`。基線 main 經本輪 fetch 確認為 `1c57a67213af72bff8d776694e6ed8c986b921db`；使用者提供的 production `aa5d3cbddd895bca953b6eef7266ae1cc0b46215` 只作歷史輸入，本輪沒有重新登入或查詢 production。原四個工作樹及其 HEAD／dirty state 均保留，見 `preserved-worktrees*.json`。

## 已交付的程式成果

| 原任務 | 本機成果與具體限制 |
| --- | --- |
| R25.1 | 83 個完整 migration ID／來源 SQL／checksum 差異表及相容候選、影響與回復前提。主線鎖檔比較不等於實際 production artifact 已修補；current registry／SBOM／restore 未核實。見 `R25-compatibility.md`、`migration-comparison.csv`。 |
| R14 | 將 actor／active／role／team scope 帶至公司註冊 list/get/query；原三個拒絕條件先重現再修補，Admin 保留明確 scope。見 `R14.md`、`R14-node-final.txt`。 |
| R24 | 有界 session／actor／configuration 失敗恢復，拒絕假登入成功；actor 更換清快取。登出意圖保存至各 router/query-client 壽命，涵蓋 root error/retry；失敗／逾時保持阻擋。denied 換帳戶與 bootstrap 未具真 adapter 時不假報登出成功。見 `R24.md`、`REVIEW-1-auth-fix.md`、`REVIEW-3-auth-fix.md`。 |
| R26.1–3 | 同版補驗既有合法 UUID／Portal scope、readiness／完成狀態守門；修正文檔 metadata 查詢、current-version 覆核及共用 snapshot predicate。Today 不再遺漏文件全 verified 但尚未完成的人工後續工作，亦不把它當 filing-ready。 |
| R17 | 憑證直接定向讀取所屬案件，脫離另一份 200 案清單；補無憑證欠款、部分收款及跨頁入口。文件檔名／公司／category／source／有效 review 搜尋經 1,000 筆 SQL 分頁與 snapshot 核對。UI proof201／proof101 是 mocked component 證據，並非真付款。 |
| R16／R28 | 工作 Queue 接受後端搜尋／filter／sort／穩定 cursor，只 hydrate 當頁案件；清單與批次共用中英搜尋與 scope。10,000 工作的三組完整 ID 集合核對一致；微秒 timestamp cursor 真 SQL 失敗後修正。URL 使用實際 router serializer；返回、下一頁失敗、actor 更換及多值錯誤不擴大 scope。Clients 保留 query／cursor 返回。 |
| R15 | Today 加入有界、授權的公司註冊與公司變更工作，提供下一步及無法判定狀態；保留年報原契約與兩組 cursor。 |
| R19 | 客戶頁整合三種業務、文件／付款／首要阻礙；安全文件仍經版本／scan／permission 守門。案件成功、失敗及不存在時均可返回確切客戶，再回原 filtered register。 |
| R20 | 公司註冊與變更既有案件清單具公司搜尋／status／owner／due／sort／cursor；新增 picker 分開。300＋300 筆實際 SQL role/filter/page 驗證及首頁 refresh 修補。 |
| R18 | total 未知可請 server 計算 scope；WhatsApp 草稿只選精確草稿集合。批次顯示 operation/counts／heartbeat，終態停止 polling；取消、未知及重試不造成功結果。 |
| R21／R22 | 有界 conversation／message 搜尋與較舊頁載入；101 對話／201 訊息真 SQL 可達，微秒游標缺項先重現再修補。Manager 不顯示 Admin-only 匯入入口，未擴權。 |
| R26.4 | Operations 結構化 503 保留中性舊值並標 stale／可重試，403 隱藏；HKT、正式無 mock20、Admin／NAR preview 邊界補驗。 |
| R25.2／R27 | 已完成工作的同 slot 重播會留下真實非成功 heartbeat，不重做副作用。75 項 local stub/in-memory 回歸；既有 scan／OCR／AI／WhatsApp／handoff 本機契約補驗。沒有真 provider 呼叫、native tick 或外發。 |
| R23 | 新離線 verifier 固定原始 CSV hash、保留 184 列完整歷史並拒絕遺漏／改寫／錯 SHA／越界證據路徑及 blocked-as-pass。正式 100 UC／34 LA 未宣稱完成。 |

每項細節、RED／環境失敗／中間失敗及後續 GREEN 均保留於各 `R*.md` 與 `.txt`。重疊批次的測試數不可相加。單純環境 EPERM、fixture 精度建立錯誤、觀測 query 錯表名，不標作產品 assertion RED。

## 同版驗證及實際 runtime

最終實際命令結果記錄於 `release-candidate.json`、`*-candidate-result.json`、`static-final-freeze.json` 與下列 log。本輪真實結果如下，未沿用歷史2076或舊4pass/5fail：

| 檢查 | 同版結果／證據 |
| --- | --- |
| 整體 typecheck | `typecheck-aggregate-repair.txt`：PASS；最後兩個測試檔修正後重跑，內容與候選一致。 |
| lint | 完整 `lint-candidate-final.txt`：0 errors／1 既有 Fast Refresh warning；其後 Auth 兩檔及最後兩個測試檔各自 lint PASS（`lint-auth-final-freeze.txt`、`aggregate-failures-lint.txt`）；其餘來源 fingerprint 未變。 |
| 完整 unit/component | `unit-candidate-final.txt`：**265 files／2464 PASS／0 fail／0 skip**。使用 `--project unit --maxWorkers 2`，清除 DB/provider 環境。 |
| Node 註冊 handler | `node-candidate-final.txt`：**21 PASS／0 fail／0 skip**；最終同SHA執行，Vitest 不收錄此 `.cjs`。 |
| 最終受影響 SQL | `db-candidate-final.txt`：**16 files／146 PASS／0 fail／0 skip**，含 Admin 並發／NAR crash-resume／100列 durable apply。前一 scoped run 13檔118 PASS及另一候選146 PASS各自保留，不相加。 |
| 最後本機 demo browser | `browser-candidate-final.txt`：**12 PASS**，mobile390／desktop1280，Edge155，只讀 demo；歷史9份 bytes unchanged。證據副本 `evidence/browser-e8ecf3f/`。 |
| build | `build-candidate-final.txt`：**PASS**；本機 `cloudflare-module` preset，demo auth 關閉。`build-artifact-manifest.json` 綁定實際輸出 hash；沒有 deploy／preview／Wrangler執行。 |
| 184 列完整性 | `delivery-integrity-final.txt`：**184／184**、0 native passes、NO_GO；四份原始 CSV hash及全欄歷史保留。 |

SQL target 是本輪新建、可丟棄、無 mounts 的 512 MiB PostgreSQL 容器 `4f5c362905d14782f4bc2c4bf74af3fc8f2b4e76259342e873bfd1ea78424580`，run/repo labels、完整 image ID、tmpfs、loopback `127.0.0.1:60953`、資料庫 `cosec_79d324f0` 及 runner URL 在 client 前核對。沒有複製正式資料；既有50 migrations 與 synthetic seed 僅在此 target 執行。見 `isolated-target.json`、`db-candidate-target.json`。

新 volume／role／history／queue fixtures 各有唯一 run UUID、精確 IDs、snapshot 集合及 rollback 後零筆回讀。最終 SQL log 另保留舊 suite 實際參數／引用 IDs；該 inventory 不把每個引用 ID 當新增資料。DB suite 使用 supplied actors／repository policy 與實際 SQL，**不是原生 Auth cookie、app-role/RLS、HTTP 或 authenticated reload**。demo browser 使用 Edge 及 emulated viewport，不能替代 Safari／實體裝置／200% zoom 接受。

## 證據、候選及回復

- `acceptance-results.csv`：35 F、15 R、100 UC、34 LA；每列完整 `original_row_json` 保留所有原欄位及歷史結果，新增本機 scope／evidence／native-result 分開。新 native 結果為70 BLOCKED／114 NOT_RUN，零 native pass；不是產品通過率。
- `source-inputs/`：四份原始 CSV 的 raw-byte 快照，固定 hash 已獨立重讀核對；zip／計劃 hash 在 `input-hashes.json`。
- `release-candidate.json`：來源／基線／環境／檢查／限制；`source-candidate-final.json` 固定最終 working bytes，`source-final-verification.json` 確認所有檢查後未變。`source.patch` 是基線至候選的完整來源差異。`REVIEW-1.md`、`REVIEW-2.md`、`REVIEW-3.md` 保留原 finding，再由各 disposition 記錄修補，未改寫原審查。
- `blockers.md`：真 Auth／多角色／HTTP／reload、production schema/artifact、原生排程、provider／收件人／交件、restore、完整 UAT／效能／裝置的具體前提。

只建立普通本機 commit；沒有 push／merge／deploy／開 main 自動部署／正式 migration／正式帳戶或資料修改／真訊息／付款／交件／付費服務。程式回復可在另一個乾淨隔離 checkout 檢視基線或以普通新 commit revert 本輪來源；本輪沒有新增 migration。這不授權把 production 降回舊 artifact；正式 schema／資料相容性及 patched rollback artifact 仍按 `R25-compatibility.md` 的具體方案先核對。

`cleanup-precheck.json` 再核對完整容器身份及零其他DB連線後，已移除該精確容器、本輪 credential file及 `.run-path` helper；`cleanup-result.json` 確認其他原有容器IDs均保留。source checkout、原始輸入、無損壓縮 SQL log與所有證據保留。`run-final-db.ps1` 是固定本輪已移除target的執行收據，不能直接套用其他localhost；未來重跑需新run及重新證明隔離身份。

Private-repo graph indexing/upload 曾因未核實外部 disclosure 風險被自動審核拒絕；未改換路徑重試上傳。本輪使用已授權本機來源檢查。某 worker 擴大 server test 執行亦曾被拒絕，父工作先檢視 import／清除連線設定後才以安全純 unit 範圍完成，不將拒絕計作產品失敗。


本輪 source commits 為 `8bc1e0d`（產品／回歸）及 `e8ecf3f`（兩個檢查器修正）；`AGGREGATE-REPAIR.md` 保留第一次2459pass/5fail原因及修正。最終所有 runtime source/test fingerprints未變。Node24.18.0／npm11.16.0；本機Bun1.3.14與package pin1.4.2不同，此限制保留，沒有更新鎖檔或宣稱CI通過。


交付證據以另一個普通本機 documentation commit 保存；其 HEAD 可能晚於 tested source SHA。source-candidate-final.json、source-final-verification.json及Git source差異核對證明產品與測試內容完全相同；沒有把未驗證的產品改動加到最終交付。build保留既有chunk-size與inlineDynamicImports/codeSplitting警告，尚未宣稱效能SLO達標。

