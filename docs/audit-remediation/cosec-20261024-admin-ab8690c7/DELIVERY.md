# UC185 最後 Admin：本機 SQL、並發與審計驗收

本批補齊 UC185 尚無實際執行證據的本機 SQL 範圍：最後一名 active Admin 的停用／降級拒絕、兩名 Admin 的相反移除決策並發、重試去重、當前身份與完整資料／審計回讀。既有產品的共用 advisory lock、最後 Admin、身份及 revision 防線均通過，沒有為產生修補而改寫正確實作。本批為 `PARTIAL_SCOPED`，native 及 release gate 維持 `BLOCKED / NO_GO`。

## 版本及授權

| 項目 | 本輪實際值 |
| --- | --- |
| Repo / origin | `https://github.com/YNWAforever/kossilon-hub.git` |
| Root | `C:\Users\laich\Documents\kossilon-hub\cosec-20261023` |
| Branch | `codex/cosec-20261023` |
| 指定基線 | `e629583fbc4559e80f6b9c2cbb560928c7a1603b` |
| 程式／測試候選 | `9c3afceae55014a024b547d47daf9d7d97e9cc44`，普通本機子 commit；產品邏輯不變 |
| Run | `cosec-20261024-admin-ab8690c7` |
| 本輪 main 唯讀核對 | `1c57a67213af72bff8d776694e6ed8c986b921db`，見 `remote-final.json` |
| Production | 使用者提供的歷史 `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`；本輪未存取或核實 |

起始 clean，其他 worktree 及使用者工作保留。已讀 AGENTS.md、開發計劃、驗收原始欄位及隔離規則；文件內容沒有擴大授權。只修改本機程式／測試／證據與已核實的 disposable synthetic target。沒有 push、merge、deploy、main 自動部署、正式 migration／資料／帳戶／權限修改、訊息、付款、交件或付費服務。Graph metadata 在 8 秒逾時；先前遭拒的私有 indexing 沒有重試或換工具上傳。

## 既有覆蓋與新增範圍

原 UC185 指定一名 active Admin 嘗試停用／降級自己，須拒絕造成無 Admin 狀態，且不部分寫入。前批 matrix 明示 UI／政策 scoped 證據不代表 DB 並發已執行。既有 `repository.integration.test.ts` 雖包含兩個 self-demotion 測試，其 fixture 假定歷史 seed team 並暫改其他 Admin flags；本輪保留該程式，沒有盲跑在舊或共享 target。

本批新增 `src/features/admin/last-admin.integration.test.ts`，以及 `src/test/db-integration-files.ts` 的 DB test 登記。新測試只會在精確 run ID／target gate 通過後動態 import application module、建立 SQL client；unit 不會接 DB。`src/features/admin/repository.ts` 與 `server-fns.ts` 原始 bytes 保持基線不變。沒有新增 migration、Auth 帳戶或 provider 權限。

## 真 SQL 旅程與回讀

最終驗收 target 為新 r3 容器 `57bcd1b87aa1d3690623ac5ca4ba7927e6f2bd766193ca2005695fe481cc8e35`，system ID `7700171542743150630`，DB `cosec_admin_ab8690c7`，loopback port 54228。使用已安裝 image `sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232`、Docker `desktop-linux`／`npipe:////./pipe/dockerDesktopLinuxEngine`，512 MiB／1 CPU、1 GiB tmpfs、無 shared mount/bind、restart no、pull never。

每次 client／fixture／migration／cleanup 前核對 root、run labels、精確 image/container、實際 mapping、SCRAM TCP 與 server/DB/user 身份；localhost 或 test 名稱沒有充當隔離依據。空 DB 套用現有 50 個 migration，沒有 app seed。Migration 前後的檔案／migrator／catalog 依賴 SHA256、成功結果及 container/system ID 綁定為 provenance，test launch 前及 child 結束後再次比對，catalog 依賴亦納入最終 test fingerprint。精確合成 team、users、profiles IDs 見 `db/UC185-journey-third.jsonl` 的 planned-ids；完整 baseline／投影見相應 helper／provision／migration journals。

1. 只有 Admin A 時，self-disable、self-demote 各嘗試兩次，均明確拒絕。由獨立 observer 比對完整 user/profile JSON、`xmin`、revision、audit，均無變更。Manager／Staff／Client、inactive Admin、錯誤 auth ID 同樣拒絕；當前版本 no-op 不寫新事件。
2. 加入合成 Admin B。A self-disable 與 B self-demote 的並發中，由 repository 自行呼叫 normal client 的 `begin`；測試只在該內部 callback 結束、COMMIT 前放 barrier。Observer 在此時仍看到完整舊狀態。實際 `pg_stat_activity`／`pg_blocking_pids` 證明 B 等待 A 的 advisory lock。A 提交，B 重新檢查後拒絕；exactly one active Admin，B 完整 rows／`xmin`／audit 不變。
3. A 已停用的舊 session adapter 重新經真 SQL mapping 解析被拒絕；舊 Admin actor 亦被 repository 的當前身份檢查拒絕。B 用舊 revision 重試 A 更新得到 409，最新 revision no-op 不重寫或新增審計。
4. B 透過同一產品 command 合法重新啟用合成 A，作第二個並發正向控制。A self-demote 與 B self-disable 再次觀察到 repository transaction 及 advisory 阻塞；A 提交、B 拒絕，仍 exactly one active Admin，B 的完整 rows／`xmin`／audit 未變。
5. B 作為最後 Admin 再停用／降級各重試兩次，均無變更。A 的新身份回讀為 Staff，不能再作 Admin command；保留的舊 Admin actor 也不能繞過當前 profile 檢查。
6. 最終 A revision 1→2（disabled）→3（reactivated）→4（Staff）；B revision 1 保留。獨立連線的 actor、roster、完整 JSON row 及 3 筆 audit 相互對應；每筆核對 actor、target、event、old/new role、dedicated old/new team columns，以及 metadata 的 role/team/active/version 前後狀態。沒有拒絕後部分寫入或重試重複事件。

這是一個多階段 SQL 測試（最終 1 passed／1 file），沒有把兩個 race 或多個 assertions 當成多個測試。使用注入 session adapter、實際 SQL actor mapping／ForActor service／repository、disposable PostgreSQL superuser；不代表原生 Auth／HTTP serialization／DB RLS／瀏覽器 reload。全域 fetch 禁用，實際外發 HTTP 為 0。

## 本輪檢查及保留證據

| 檢查 | 實際結果／限制 | 證據 |
| --- | --- | --- |
| 最終相關 unit／component | 25 passed／7 files | `targeted-final2.txt`／`.json` |
| 最終 typecheck | exit 0 | `typecheck-final2.txt`／`.json` |
| 最終 lint | exit 0；既有 work-queue Fast Refresh warning 保留 | `lint-final2.txt`／`.json` |
| 最終 build | exit 0；Cloudflare module，demo auth false | `build-final2.txt`／`.json`、`build-artifacts.json` |
| 最終 SQL | 1 passed／1 file | `db/test-third.txt`／`.jsonl`、`db/UC185-journey-third.jsonl` |
| 完整 unit | 本批未重跑；測試與 DB exclusion 登記改動，由相關 guards／auth／registry 檢查覆蓋 | 前批 2,768 pass 保留為歷史，沒有沿用成本次結果 |
| Native／browser | BLOCKED／本批未執行 | `blockers.md`、CSV 原 native 欄位 |

首次 typecheck 的 tuple 推斷錯誤（TS2322／TS2493）保留於 `typecheck-first.txt`，原 test bytes 見 `test-before-typefix.snapshot`。修正僅是測試並發結果 array 的型別；第二次 typecheck 通過，之後補強後另有最終檢查。首次 build 嘗試在 3 GiB RAM gate 前被拒絕而未 launch，保留 `resource-checks.jsonl` 的失敗時讀值；沒有降低 gate、停止別人的工作或將未跑算通過。

首次 SQL `db/test-first.txt` 亦真實通過，但有較窄的 harness。獨立 static review 的 4 個 P2／1 個 P3 finding 及修正全部保留於 `independent-review.json`，原檔見 `test-first.snapshot`、`runner-first.snapshot`：改為觀察 repository 自行開 transaction；失敗 client closure 不得 seal；綁定成功 migration 來源；逐一比對被拒絕者完整 rows／xmin／audit；加 old/new team columns 驗證。第二次 `db/test-second.txt` 通過後，followup 指出 migration 的 catalog 依賴還須在 child 結束後核對，故保留 `runner-second.snapshot`，補齊後以第三個新 target 再次演練並通過。沒有改標首次／第二次結果，也沒有聲稱 review finding 是產品缺陷。最終 followup 確認五項靜態修正已處理，reviewer 沒有執行 runtime。

另有純 classifier 反例：未關閉 client 狀態、變動 migration fingerprint 會被拒絕；沒有真的製造 client-close failure 或修改 migration 來冒充實際故障。最終實際 cleanup 另有正向 server 回讀證明。

## 版本、清理及矩陣完整性

測試時 HEAD 為指定基線，兩個 test／registry 變更尚未 commit。補強後 `source-final2-before.json` 與 `source-post-checks.json` 的 668 個 source/config/runbook 檔案指紋一致，再核對候選及 evidence commit 的 Git blobs；SQL result 亦核對實際 runner/source 指紋。沒有將 commit metadata 或整理 evidence 的動作冒充重新執行測試。

首次容器 `4067d8f610f870f47cc6c1192cd34e31778f90785d2920040ad22568f1ff097d`、第二次 `ac5a042627b5fd052a7a93e4876f3b8f4709eceea0b585d88a2aef3988a67341` 與最終 r3 容器均已核實移除，見 `db/teardown-first.jsonl`／`db/teardown-second.jsonl`／`db/teardown-third.jsonl`。首次測試成功及 await end 結果保留；第二次起增加 closure seal、4 個 app PID 的 server absence 與移除前再次核對。三次均在精確 DB inventory／完整 public 投影核對後只移除 owned tmpfs 和憑證，沒有 SQL 刪除 immutable audit、停用 trigger 或清理其他 container。最終 process inspection 沒有本批 owned runtime process。

17 批原證據、2,435 個 manifested files 保持原 bytes。驗收 CSV 保留 184 列原編號及原始欄位（35 F／15 R／100 UC／34 LA），只附加 UC185 scoped local 結果；F08／LA26／R 關聯及其歷史狀態不變。Native 維持 70 BLOCKED／114 NOT_RUN／0 PASS，release NO_GO。Manifest、CSV、Git blobs 由配套 verifiers 核對，結果見 `verification-report.txt`。

回復可用普通新 commit revert 本批候選，保留失敗／review／審計證據；沒有正式 migration、資料或帳戶回復步驟。下一步需同版隔離原生角色／Auth／HTTP／RLS／browser 才可推進 UC185 完整 UAT。UC186 完整離職交接、invitation、核准日曆與其他原生／provider 缺口沒有由本批代為驗收，見 blockers.md。
