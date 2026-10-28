import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const folder=import.meta.dirname,json=name=>JSON.parse(readFileSync(join(folder,name),'utf8').replace(/^\uFEFF/,''));
const r=json('release-candidate.json');assert.equal(r.release_gate,'NO_GO');
const sha=r.source_sha;
const text=`# UC149 退回原因與補傳 — 本機交付

UC149 本機範圍已修補及驗證，原生接受仍 **BLOCKED／NO_GO**。以 UC160 交付 \`6f29c4068fcbbaa2197efdf0b8969777b78f47c5\` 為基線；原 UC149 無 F/R/LA 關聯，保持原編號、關聯及原始 JSON。

## 版本與結果

- Source candidate **\`${sha}\`**，普通本機 commit；branch \`codex/cosec-20261023\`，root \`C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023\`，origin \`https://github.com/YNWAforever/kossilon-hub.git\`。
- Main 唯讀 recheck **\`${r.main_sha}\`**；歷史 production \`aa5d3cbddd895bca953b6eef7266ae1cc0b46215\` 沒有存取。完整 source/config **643 files** 與 final unit freeze／交付 Git blobs 一致。SQL 測試後只有 DB convention 註解標記，原檔 snapshot 及移除 comments 後 JavaScript 完全相同的證明另附。
- \`repository.ts\` 只讀同公司/案件/文件/當前被退回版本的 timeline reason；\`portal.tsx\` 顯示客戶具體說明、缺歷史理由提示、成功補傳/明確重試後重新讀文件與案件，並阻止進行中的 file/batch 重複提交。新文件仍待掃描/覆核，舊 review 不沿用。
- 獨立唯讀 review 無 actionable findings；review 不代跑測試，且早於 final full suite/browser。其 DB test 指紋為標記註解前版本，執行語意一致的範圍另有證明。

| 層級 | 本次實測 |
| --- | --- |
| Final full unit | **${r.checks.unit.summary.tests.toLocaleString('en-US')} passed / ${r.checks.unit.summary.files} files**；\`unit-verified.*\` |
| Final related unit/component/convention | **${r.checks.targeted.summary.tests} passed / ${r.checks.targeted.summary.files} files**；\`targeted-verified.*\` |
| Typecheck | exit0；\`typecheck-final.*\` |
| Lint | exit0／0 errors；1項既有 work-queue Fast Refresh warning；\`lint-final.*\` |
| Build | exit0，未部署；\`build-final.*\`，產物指紋 \`build-artifacts.json\`，plugin/bundle warnings 原樣保留 |
| Local browser | **9 passed**，Edge **${r.local_browser.version}**；\`browser-results-green3.json\`，0 external/page/console/HTTP errors |
| Baseline negative browser control | **1 expected failure**，精確 \`6f29c40\` Portal overlay 缺退回原因；\`browser-results-historical1.json\` |
| Isolated TCP PostgreSQL | **1 passed / 1 file**；獨立 observer 回讀、exact IDs cleanup=0、owned container absent；\`db/db-rejection-green.*\` |
| Native Auth / HTTP API / DB-RLS / storage-scanner | **BLOCKED / NOT_RUN**；不能由本機 SQL 或 memory transport 轉成 PASS |

Browser 用真 Documents/Portal 元件、TanStack Router 與 Edge，走 reviewer 選原因/說明→Client 回讀→known precommit finalize failure→retry→文件/requirement 重讀→reload→返回/重開。另含同 tick 重複提交1intent/1finalize、缺理由、pending 不顯示 stale reason、其他 Client 拒絕、文件讀取錯誤reload恢復、列表錯誤explicit retry、空態與清除檔案後返回/Back零寫入。Root actor/RPC 為 stub；成功後持久化只屬本輪 sessionStorage，不是原生 DB reload。

SQL 先核實實際 Docker endpoint/container/image/labels/mounts/tmpfs/path/port，再以 TCP server system ID **7700060938157912103** 比對 container。僅新可丟棄 tmpfs DB 套既有50項 schema migrations，無 app seed。實際 repository/membership/query 與獨立連線證明 scope/version 拒絕、timeline reason、replacement pending、舊 document/version/review/timeline 保持；精確 IDs 與零行回讀見 sidecar log。受控 scan DTO 與注入 Auth adapter 只是本機測試；Rejected checklist 初態用 fixture，沒有走完整 evidence-service/SLA/annual_return_audit_events SQL runtime。全部 fixture 清理為0後，只移除本輪 container/ignored 連線檔，保留 daemon、其他資源及本輪非秘密 cache。

## 保留的失敗與完整性

- 產品 RED：修正 setup 後 **10 failed / 70 passed**；加入重入回歸 **1 failed / 80 passed**。原始失敗 log、當時 test 及 base product snapshots 保留。第一輪額外1個拒絕畫面 setup 等待錯誤另列。
- Full unit 首輪 **1 failed / 2,629 passed**：DB test 缺既定分類 marker；保留隔離清單與檢查期望，只補說明註解，最終完整 suite 實際重跑。
- Browser green1 目標 fetch 失敗，0 cases；green2 **6 passed / 3 harness failures**（category exact-text selector、reload readiness）；原 harness/entry 及 raw logs 保留；green3九項通過。Evidence marker helper 初輪 CRLF 假設錯誤亦保留 snapshot/說明，沒有歸為產品缺陷。
- CSV **184原列 = 35F/15R/100UC/34LA**，只在 UC149 追加 \`PARTIAL_SCOPED\`。Immutable original/native fields 全相等；**70 BLOCKED / 114 NOT_RUN / 0 native PASS**。歷史 2076 unit 與4pass5fail不當作本次結果。
- 前10批 **1,642個manifest檔案** bytes 完整；本批 SHA256 manifest、source/candidate、CSV validation、驗證報告均附。原始 logs/CSV/snapshots 不做 whitespace 正規化。
- 自身 server/contexts 已關閉；精確本輪路徑程序檢查0，不停止任何他人程序。資源門檻與身份證據保留原始時間讀數。

## 未完成與回復

需要獲准同版原生 target/Reviewer+Client，才可補原生 Auth/HTTP/DB-RLS/storage/scanner/persisted reload；外部缺口維持 blocked。完整 evidence-service/SLA SQL、正式資料量效能未驗。UC150 的 ambiguous commit/lost-response retry、跨程序去重與續傳未關閉；本輪只保證 known precommit failure 與同頁 in-flight 防護。下一個獨立候選為 UC150，須先查覆蓋、重現再修補，不能套用本批證據。

沒有 push、merge、deploy、main自動部署、正式 migration/資料/帳戶/權限、真實訊息、付款或交件。回復方案為普通新 commit revert \`${sha}\`，保留稽核與既有歷史；無正式資料回復動作。詳見 \`UC149.md\`、\`blockers.md\`、\`release-candidate.json\`、\`source-candidate.json\` 及 \`acceptance-results.csv\`。
`;
writeFileSync(join(folder,'DELIVERY.md'),text,{flag:'wx'});console.log('Wrote exact-version UC149 DELIVERY.md.');
