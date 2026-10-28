# UC189 本機 schema 拒絕驗收

基線 `1a9f3fef8e419a3cc75d0d62e90795c3d8134d68`；程式候選 **`57cc413fdd37aca1eb230fe2973757e8526f1209`**。交付文件 commit 是程式候選的直接下一個 commit，可由 `verify-git-evidence.mjs` 核對。分支 `codex/cosec-20261023`，沒有 push、merge、deploy。

本批完成 **UC189 的排程入口本機子範圍**。原 F01／R23／R25／UC189／LA27 編號及歷史失敗保留；原生驗收仍 **BLOCKED**，發布 **NO_GO**。正式資料庫與部署版本沒有被存取或驗收。

## 成果與原因

既有程式已有 schema 診斷及相容性判斷，但排程入口沒有使用結果。新增回歸先重現：缺 migration、未知 migration、同數量但不同 ID、空／不存在 ledger、缺實體條件及讀取錯誤，仍會執行 job 並寫成功 heartbeat。

- `maintenance-schema.ts` 比較本版 50 個完整 migration ID，以及既有 catalog 對 dispatch marker 欄位／索引的實體觀察。空觀察、未知、缺少或重複 required fact 都拒絕。
- `runRuntimeMaintenanceTick` 在建立 job repository、claim、執行 job、寫 heartbeat 之前讀 catalog。每次重試重新讀取；拒絕時關閉 reader，錯誤不帶 DB payload。沒有對不相容 DB 補寫成功或失敗 tick。
- Operations repository 支援注入 SQL／transaction，沿用既有 SQL 和所有權規則，方便同版 transaction 故障及回讀；不關閉呼叫端的 client。正常 production factory 行為保留。
- 沒有修改 migration、正式 registry、provider、付款或交件邏輯。原 Operations ID 診斷與原測試期望保留。

## 本次實際測試

| 層級 | 真結果與證據 |
| --- | --- |
| 修補前 focused regression | **10 fail / 11 pass**；`focus-red1.txt`。失敗證明危險路徑仍可執行，沒有調低期望。 |
| 最終相關 unit／component | **117 pass / 10 files**；`targeted-final2.txt`。含 runtime、HTTP credential／owner 拒絕、schema、Operations 讀取與 UI error/cache/retry 測試。HTTP／UI 為單元或 component 層。 |
| 最終真 SQL | **7 pass / 1 file**；`db/test-final3.txt` 及每項 `UC189-*-final3.jsonl`。 |
| Typecheck | exit 0，`typecheck-final2.json`。 |
| Lint | exit 0，`lint-final2.json`；1 項既有 `work-queue.tsx` Fast Refresh warning。 |
| Build | exit 0，`build-final3.json`；Cloudflare module candidate，demo auth false。 |
| 獨立 review | 靜態 review 無 actionable finding；`independent-review.json`。reviewer 沒跑測試／runtime；其後測試錯誤聚合調整沒有宣稱獨立重審。 |
| 完整 unit／新 browser runtime | 本批未執行，不引用歷史總數為本次通過。 |

SQL 的 7 個情境：缺 `0034_notification_outbox_dispatch_marker.sql`、加入精確未知 ID、刪一加一而總數仍為 50、無 ledger、缺 marker 欄位、缺索引、恢復後重試／相同 scheduled slot 去重。前六項各重試兩次，均未建立 job repository，job effects／claim／heartbeat 為 0。

恢復情境注入 **無外發、無業務 effect 的 job**，但使用真正的 durable job／heartbeat SQL：一項 job 完成一次，重試 skipped，不重做；兩個 heartbeat 分別保留 succeeded 與非成功 replay，`platformTriggerVerified=false`。全部在 transaction 中回滾，不構成真 scheduler tick。

## 隔離、回讀與證據完整性

新 target 以 `desktop-linux`／固定 named-pipe endpoint、已安裝的 pinned image、run/root labels、container ID、loopback port mapping、零 mount／bind、1 GiB tmpfs、512 MiB／1 CPU 核對，再以 Node built-in SCRAM TCP 唯讀 probe 比對實際 `pg_control_system`、DB/user/data directory。通過後才 import app modules／建立真 client／執行本機既有 migrations；沒有 `db:seed`。

兩個 target ID、system ID、實際 port 均在 `db/provision-*.json`。最終 target 使用 `db/provision-provision2.json`。每情境記錄精確 fault ID，所有 catalog／ledger 故障只在 transaction 內。writer 與 observer 為不同 backend PID。拒絕前後核對實體 catalog 與寫入數；回滾後 observer 的完整 ledger／job／run／outbox rows 和 xmin 與原基線完全一致。全部 public business counts 及 migration configuration 恢復；`db/teardown-teardown1.jsonl`、`db/teardown-teardown2.jsonl` 證明兩個容器已不存在、憑證已清理，沒有碰其他容器。

最終 657 個 source/config 檔案在 `source-final2-before.json` 至 `source-post-build.json` 相同，並核對程式 commit 的 Git blobs。14 批舊證據、2,159 個 manifested 檔案保留原 bytes；本批以 `evidence-manifest.json`、`verification-report.txt` 驗證。CSV 保留 **35 F／15 R／100 UC／34 LA** 原始欄位，只為 UC189 追加 scoped local evidence；native **70 BLOCKED／114 NOT_RUN／0 PASS** 不變。

## 保留的失敗與實際限制

- 初次 migration 準備在讀測試檔 fingerprint 時發現檔案未建立，於 migration 啟動前停止；`db/migrate-migrate1.jsonl`。這是執行次序錯誤，沒有 DB migration 寫入。
- 初次 typecheck 的 transaction `begin` 兩項錯誤、lint 的 `no-unsafe-finally` 一項錯誤保留。已修正 transaction read 分支及錯誤聚合；沒有修改測試期望。
- 初次 SQL 7 pass 的 Operations releaseCatalog transaction 注入診斷缺口，於後續同版修正及重跑消除；三次 SQL 實際結果與版本指紋全部保留，不合併虛增 test count。
- `build-final2` 的原始 free RAM **3,103,531,008 < 3 GiB**，因此未啟動 build。`build-final2-resource-blocked.json` 保留當時讀數；`final3` 新讀數通過後才執行。沒有降低門檻或停止其他工作。
- 首次 CSV evidence-path 檢查早於候選檔生成，因缺 `release-candidate.json` 停止；`packaging-validation-history.json` 保留。生成候選後，同一 CSV 已通過全部路徑與原始欄位檢查，沒有改寫期望。

Guard 僅涵蓋排程入口、migration ID parity 及兩項 outbox 實體條件，沒有證明完整 schema、checksum、權限、其他 API 寫入入口或 concurrent DDL 安全。歷史相容例外仍拒絕，不能據此改寫 production ledger。SQL 是 disposable superuser／注入 dependency，並非原生 Auth／HTTP／RLS／persisted browser reload。

詳見 [候選版本](release-candidate.json)、[程式版本](source-candidate.json)、[驗收 CSV](acceptance-results.csv)、[blockers](blockers.md)。下一個本機 checkpoint 可補 UC189 非排程寫入入口的 admission coverage；原生環境、完整角色／權限、三個 native tick、正式 artifact／schema 及還原驗收繼續 blocked。回復候選為普通新 commit revert 程式 SHA；沒有 migration 可發布，也不改寫已發布歷史。
