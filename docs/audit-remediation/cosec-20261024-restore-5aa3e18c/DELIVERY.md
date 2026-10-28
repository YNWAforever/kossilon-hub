# UC193 本機還原演練及 UC189 GET 寫入防線

本批完成 UC193 的同版隔離 PostgreSQL 邏輯備份、還原及資料回讀驗收，並修補 UC189 的 GET 人士同步寫入入口。結果限於本機合成資料及注入 session 的層級，兩項均為 `PARTIAL_SCOPED`；正式交付 gate 維持 `NO_GO`。

## 精確版本與範圍

| 項目 | 實際值 |
| --- | --- |
| Repo / origin | `https://github.com/YNWAforever/kossilon-hub.git` |
| Root | `C:\Users\laich\Documents\kossilon-hub\cosec-20261023` |
| Branch | `codex/cosec-20261023` |
| 基線 | `b5bcdaef300999ff30f8372456827c7651cd4080` |
| 程式候選 | `eafa493cf2b1e50a672e927a3b8b86346f91a199`，基線的普通本機子 commit |
| Run ID | `cosec-20261024-restore-5aa3e18c` |
| 本輪唯讀核實 main | `1c57a67213af72bff8d776694e6ed8c986b921db`，見 `remote-final.json` |
| Production | 使用者提供的歷史 `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`；本輪未連線核實或操作 |

Intake 為 clean；其他 worktree 及既有使用者工作保留。附件是需求與歷史證據來源，沒有擴大本次授權。沒有 push、merge、deploy、正式 migration、正式資料／帳戶／權限修改、訊息、付款、交件或付費服務。Graph metadata 逾時；沒有重試先前遭拒的私有索引上傳。原有固定目標還原腳本已有正確完整資料比對，保留其實作，未執行該舊 target。

## 程式與有效回歸

`src/features/annual-return/repository.ts` 的 `syncCasePartiesFromOfficers` 可由 GET `listAnnualReturnCasePartiesForActor` 觸發 INSERT。單靠 HTTP method 的 schema admission 未涵蓋這個寫入點。`focus-red4.txt` 先重現：不相容 schema 仍 resolve `{created: 0}`，未按預期拒絕。現在在實際 INSERT 前重用 `assertApplicationWriteSchema(sql)`；沒有更改原相容判斷或 readiness 計算。

`read-seed-schema.test.ts` 驗證兩次嘗試均拒絕 `503 / SCHEMA_WRITE_BLOCKED`，沒有 INSERT。`restore-rehearsal.integration.test.ts` 新增一個完整真 SQL 旅程，於 `db-integration-files.ts` 登記，避免 unit 誤接 DB；runbook 補上當前隔離／還原／回讀與證據限制。沒有新增 migration。

## 本輪實際驗證

| 驗證 | 實際結果 | 證據 |
| --- | --- | --- |
| 修補前 focused regression | 1 failed / 1 file，失敗保留 | `focus-red4.txt` / `.json` |
| 修補後 focused regression | 1 passed / 1 file | `focus-green1.txt` / `.json` |
| 最終相關 unit | 78 passed / 8 files | `targeted-final.txt` / `.json` |
| 最終完整 unit | 2,768 passed / 287 files | `unit-final.txt` / `.json` |
| Typecheck | exit 0 | `typecheck-final.txt` / `.json` |
| Lint | exit 0；既有 `work-queue.tsx` Fast Refresh warning 保留 | `lint-final.txt` / `.json` |
| Build | exit 0；Cloudflare module、demo auth 關閉 | `build-final.txt` / `.json`，`build-artifacts.json` |
| 首次真 SQL 演練 | 1 failed / 1 file | `db/test-first.txt` / `.jsonl` |
| 第二次真 SQL 演練 | 1 passed / 1 file，含下列控制階段 | `db/test-second.txt` / `.jsonl` |

相關 unit 是完整 unit 的子集合；SQL 為一個多階段測試，沒有將階段數灌成測試數。測試執行時 HEAD 為基線、候選改動尚未 commit；`source-final2-before.json` 與 `source-post-checks.json` 的 667 個檔案 bytes 一致，再核對候選 Git blobs。SQL result 另外記錄 test、runner、相關 source 及 50 個 migration 指紋。最終 evidence commit 只加入本批證據，沒有聲稱其 commit metadata 已重新跑測試。

## 真 SQL／應用回讀範圍

第二次旅程使用 Docker `desktop-linux`，endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`，已安裝 immutable image `sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232`。容器 `358cd27f6dec1079e15082d3d0dc2b6989f627bdb0939ef69e56635e3939e25f`、system ID `7700153473904025639`，loopback port 57560；無共享 mounts/binds，1 GiB tmpfs、512 MiB RAM、1 CPU、restart no、pull never。

每個 client／fixture／restore 前核實 root、run label、image、實際 mapping、server/DB/user 與 SCRAM 連線身份。DB allowlist 為 `cosec_restore_5aa3e18c`、`cosec_restore_5aa3e18c_restored`、`cosec_restore_5aa3e18c_broken`。只對新建空 source 跑本版 50 個 migration，沒有對正式資料補 seed。實際身份、精確合成 IDs、資料、catalog、archive commands 及各階段結果見 `db/provision-provision3.json`、`db/helper-second.jsonl`、`db/UC193-rehearsal-second.jsonl`。

1. 以合成 Staff/session 配合真 SQL actor mapping 建立公司及代表性年報案件，保留 missing checklist／payment pending 與 readiness blockers。公司 ID `8d66ffa6-fe31-44ea-bf4a-f6b380ff8d4b`，案件 ID `5aa3e18c-0193-4193-8193-f03064c2747b`。先同步人士，再擷取完整預期案件、public rows 與 catalog。
2. 真 `pg_dump` custom archive，綁定 SHA256。`pg_restore --exit-on-error --single-transaction` 還原到新 DB，完整比較 68 個 public table 的逐列投影、migration ledger 及 catalog。以新連線及獨立 observer PID 回讀公司、案件、人士、款項、checklist、readiness（含 `sourceVersion`）；另一 team 的 Staff 被 domain 權限拒絕。
3. 截斷 archive 實際 restore exit 1；broken DB 沒有半完成 public user schema。沒有用補 migration 或補 seed 將失敗改成成功。
4. 同一查詢先正向證明原投影相等，再於 transaction 中改資料但保留 row count，證明完整投影比對拒絕差異，最後 rollback。
5. 在 restored DB 的 transaction 中移除指定必要 index、加入尚未同步 officer。catalog 不匹配，實際 domain GET 同步入口拒絕 `503 / SCHEMA_WRITE_BLOCKED`；既有 party rows 與 `xmin` 不變，沒有半完成人士寫入；最後 rollback。離線回歸另涵蓋同一拒絕的重試。
6. Disposal inventory 分類控制證明相同名單通過、額外 DB 名稱拒絕；此項是純分類反例，沒有真的新增陌生 DB。第二次實際 cleanup 重新枚舉 DB 名單、比較 seal 及每個 DB 完整投影後才移除容器。

本輪 app SQL 使用 disposable superuser，session 為注入 adapter；不是原生 Auth、HTTP transport 或 DB RLS 驗收。`fetch` 禁用且外發呼叫為 0；沒有瀏覽器 reload 測試或 object-storage 還原。

## 失敗、review 與資源證據

首次 SQL 的 archive、資料及 catalog 比對已通過，完整 case equality 在 readiness `sourceVersion` 失敗。根因是預期 case 擷取早於 lazy party 同步、dump 晚於同步；MD5 payload 包含 parties。已調整 harness 擷取順序，完整 equality（含 `sourceVersion`）保留，沒有修改產品期望迎合缺陷。見 `harness-ordering-failure.json`、`restore-test-first.snapshot`、`runner-first.snapshot`、原始 `db/test-first.txt`；首次 target 以 `succeeded:false` seal 處置，沒有改標 pass。

獨立 static review 提出兩個 P2，均已修正並在第二次真 SQL 驗證：投影查詢加明確 alias、正向相等控制及 key 檢查，避免 undefined 形成假陽性；cleanup 在當下重新枚舉 DB inventory，避免只重查舊 seal 而漏掉新增 DB。Followup 只確認這兩個修正無 findings，沒有擴稱完整產品審核或 reviewer runtime。原 finding 及處理見 `independent-review.json`。

初期 3 GiB heavy／1.5 GiB focused 記憶體 gate 曾在 launch 前拒絕，保留 `resource-checks.jsonl`；沒有降低 gate 或停止他人程序。另有一次 PowerShell here-string 被送入 cmd 的準備指令失敗及 graph 阻塞的唯讀 cell 終止，均未執行目標 mutation；其後獨立準備與驗收成功，不算產品測試成功或失敗。

## 本機恢復觀察與清理

`local-recovery-metrics.json` 記錄：restore 加應用回讀約 5,394.72 ms，單次 pg_restore 約 382.32 ms；archive 279,723 bytes，SHA256 `abc60d6c12281c53364d3453feb10ab45ab61f327dc8bdd2fc05162d7384dccd`。Dump 時段為 08:48:37.339Z–08:48:38.082Z，08:48:38.086Z 的後續 source marker 在 restore 後不存在，符合該備份恢復點；合成 marker age bounds 4–747 ms，核實回讀時備份 age 16,947 ms。這些只是本機一次觀察，沒有承諾正式 RTO、RPO、零遺失或 SLA。

首次容器 `be1cfb8c93dd9885fc02b5a65eb1aacfaed7f1581b6dc4a0f1f59ee3d318e3dd` 與第二次容器均已移除，owned credential/state/seal files 已清除；見 `db/teardown-teardown-first.jsonl`、`db/teardown-teardown-second.jsonl`。首次 cleanup 使用當時 sealed DB 的逐一核對；只有第二次包含後補的即時 inventory 重枚舉。沒有停用 retention trigger 或 SQL 刪除 immutable history，清除的是已核實 owned tmpfs 整體。Archive bytes 只存在該 tmpfs 並已隨容器處置；保留的是 checksum、commands、完整投影與結果，不構成可重播備份留存證明。`local-process-inspection-final.json` 無本批 owned runtime process。

## 驗收矩陣、回復與下一步

`acceptance-results.csv` 保留全部 184 列原 F/R/UC/LA 編號及原始欄位（35 F／15 R／100 UC／34 LA），僅附加 UC189、UC193 的本批 scoped 結果。Native 維持 70 BLOCKED／114 NOT_RUN／0 PASS。16 批既有證據的 2,351 個 manifested files 保持 bytes 不變；由 `prior-evidence-integrity.json` 及 `verification-report.txt` 核對。本批 manifest 排除自身與驗證報告的 self-reference，兩者仍納入 evidence commit Git blob 核對。

回復候選程式可用普通新 commit revert `eafa493cf2b1e50a672e927a3b8b86346f91a199`，保留本批失敗與審計證據；不改寫歷史、無正式 migration 或資料回復步驟。Native 缺口與具體依賴見 `blockers.md`、`release-candidate.json`。下一個可推進 checkpoint 是獲准且同版的隔離原生站／角色及 Neon staging backup，或 UC134 的核准假期來源；本批沒有這些輸入，不以 demo、stub、toast 或本機 SQL 宣稱正式可用。
