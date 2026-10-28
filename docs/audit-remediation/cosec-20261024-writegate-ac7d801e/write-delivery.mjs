import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const folder=import.meta.dirname;
const receipt=JSON.parse(readFileSync(join(folder,'source-commit-receipt.json'),'utf8').replace(/^\uFEFF/,''));
assert.match(receipt.source_sha,/^[a-f0-9]{40}$/);
const text=`# UC189 非排程寫入入口本機驗收

基線 \\BASE\\；程式候選 **\\SOURCE\\**。交付文件 commit 為程式候選的直接下一個 commit，以 verify-git-evidence.mjs 核對。分支 codex/cosec-20261023；沒有 push、merge、deploy 或改寫已發布歷史。

本批完成 UC189 的非排程入口本機子範圍。原 F01／R23／R25／UC189／LA27 編號及歷史失敗保留；native **BLOCKED**、release **NO_GO**，不宣稱正式可用。

## 成果

既有 scheduler guard 沒有覆蓋非排程入口。先重現 **9 fail / 5 pass（3 files）**：Staff／Client 可通過 schema 不相容的寫入前 actor 解析；webhook 與手動 maintenance 亦到達 writer／recorder factory。原始 log 是 focus-red1.txt，原程式 snapshots 保留。

- requireActor 在解析出有效身份後，對 mutating request 執行新的 read-only schema precondition；GET／HEAD／OPTIONS 診斷讀取保留。既有角色／公司授權仍由原有規則決定。每次調用重新檢查，不快取先前成功。
- ApplicationSchemaError 攜帶 statusCode=503／SCHEMA_WRITE_BLOCKED（原生 RPC 序列化未驗收），包含香港中文恢復訊息，沒有 DB credentials、connection payload 或 topology。
- HMAC webhook 先驗證簽章及 JSON，再檢查 schema，通過後才建立 repository；拒絕返回 503 供重試，不寫失敗或成功 event 假裝收到。production config 預設使用真正 guard，unit 另驗證此預設路徑。
- runFirmMaintenance 的 production entry 在 input validation 後、recorder／repository／provider assembly 前檢查。原 scheduler precondition 沒有重寫。
- 74 個 POST 函式／17 個模組共用授權路徑；特殊 handoff export 經 createDocumentContextForRequest -> requireActor。入口清單及獨立靜態 review 見 entrypoint-inventory.json、independent-review.json；清單不是 74 條 runtime 通過證據。

## 本次真結果

| 驗證層 | 實際結果 |
| --- | --- |
| 修補前 focused | 9 fail / 5 pass，focus-red1.txt |
| 最終相關 unit | **130 pass / 15 files**，targeted-final.txt |
| 最終完整 unit | **2,767 pass / 286 files；0 skipped**，unit-final.txt。130 項是其子集，不加總。 |
| 真 PostgreSQL | **9 pass / 1 file**，db/test-first.txt 及逐情境 JSONL |
| Typecheck | exit 0，typecheck-final.json |
| Lint | exit 0，lint-second.json；只有既有 work-queue Fast Refresh warning |
| Build | exit 0，build-final.json；Cloudflare module，demo auth false |
| Review | 獨立靜態 review 無 finding；reviewer 沒跑 SQL／tests。其後新增 SQL harness／transport typing 沒有宣稱獨立重審。 |
| 原生 Auth／HTTP／RLS／browser | 未執行，維持 BLOCKED |

## SQL 範圍與無半完成寫入

六項 schema fault：缺精確 required migration、未知 ID、刪一加一而數量相同、無 ledger、缺 marker 欄位、缺索引。每項使用真 SQL actor mapping，分別核對 Staff、Client 與實際本機 HMAC handler；重試兩次均拒絕，writerFactories=0，完整 business rows／xmin 與拒絕前一致，診斷 GET 仍可解析角色。fault 與基礎 fixtures 在 transaction 內回滾，再由另一個 backend PID 核對原始 rows／catalog。

另三項驗證恢復與錯誤：

1. Schema fault 以 savepoint 回滾後，用同版授權／domain／repository 建立公司；commit 後獨立 observer 讀回公司、contact、officer 與 timeline 完整資料。重試遭原 duplicate 規則拒絕，不新增資料或改動原 rows／xmin。
2. 刻意經 real repository 測晚期 contact constraint 失敗，確認 company／contact／officer／timeline 全部回滾；修正輸入後再 commit 並獨立回讀。沒有修改 constraint 或測試期望來迎合失敗。
3. HMAC schema refusal 後恢復，再用真正 WhatsApp repository commit 本機合成 inbound；重試後仍只有一個 message／event。這是合成來源與本機 Request handler，不是 provider delivery；不宣稱 contact upsert 的時間欄位完全不變。

所有 SQL 情境在 import app modules／建立 client 前，先核對 exact root、Docker context／named pipe、pinned installed image、labels、container ID、loopback mapped port、零 mount／bind、tmpfs，並用 Node built-in SCRAM TCP probe 比對實際 system ID、DB/user/data directory。只對新空 tmpfs DB 套用現有 migrations，沒有 db:seed。新 run ID 與精確 foundation／新增子記錄／webhook IDs 全部寫入 journal。外部 HTTP calls=0。

每項 cleanup 前重新核對 target，按精確 owned IDs 刪除，再獨立讀回全 public business counts 和原 migration configuration。container／system identity 見 db/provision-provision2.json；db/teardown-teardown3.jsonl 證明容器及 owned credential files 已移除，沒有處理其他 container／worktree。

## 版本與歷史證據

664 個 source/config 檔案在 source-final-before.json 至 source-post-checks.json 相同，並驗證程式 SHA 的 Git blobs。15 批原證據共 2,267 個 manifested 檔案原 bytes 保留。本批以 evidence-manifest.json、verification-report.txt 與提交後 Git blob verification 交付。

驗收 CSV 保留 **35 F／15 R／100 UC／34 LA** 的 original/native 欄位，只為 UC189 追加本批 scoped local evidence。Native **70 BLOCKED／114 NOT_RUN／0 PASS** 不變，LA27 原 fail 沒有改寫。

保留的非產品失敗包括：初次 SQL/build resource gate、lint 啟動前 resource gate、Docker named-pipe sandbox denial、兩次 teardown 前 RAM refusal；均未越過其寫入／移除 gate。唯讀 image inspect 及後續 exact isolated actions 經 sandbox escalation 通過，沒有 automatic approval rejection。初次 inventory 工具只識別直接 auth import，未識別 annual-return/session helper，已核對實際 helper 後修正清單；inventory-history.json 保留。所有原始 failed readings／red logs 未覆寫。

## 限制與下一步

Guard 只核對 migration ID parity 與現有兩項 outbox 實體條件，沒有證明完整 schema／checksum／權限或 concurrent DDL 安全；也不是所有後續外部 effect 的 atomic transaction。Auth proxy/session/login recovery 基礎設施保持獨立。所有 native same-version Auth、compiled HTTP、RLS、persisted browser reload、native tick、provider、production artifact/schema 及 restore 驗收仍 blocked。

詳細候選／驗收／回復前提見 [release-candidate.json](release-candidate.json)、[source-candidate.json](source-candidate.json)、[acceptance-results.csv](acceptance-results.csv)、[blockers.md](blockers.md)。下一步是取得已核准同版原生 target／角色後，接續 UC189 的 native HTTP／角色／資料回讀驗收；本機結果不代替該門檻。回復候選為普通新 commit revert 程式 SHA；無新增 migration、無 production 動作。
`.replaceAll('\\BASE\\','`'+receipt.parent_sha+'`').replaceAll('\\SOURCE\\','`'+receipt.source_sha+'`');
writeFileSync(join(folder,'DELIVERY.md'),text,{flag:'wx'});
