import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const folder=import.meta.dirname,r=JSON.parse(readFileSync(join(folder,'release-candidate.json'),'utf8'));
assert.equal(r.release_gate,'NO_GO');
const q=String.fromCharCode(96),code=v=>q+v+q;
const lines=[
'# UC150 回應遺失重試／恢復 — 本機交付','',
'本輪完成已提交但回應遺失的本機重試契約，UC150仍為PARTIAL_SCOPED；原生維持BLOCKED／NO_GO。原編號/原始JSON及空白F/R/LA關聯保留。恢復是完整檔案重送或同要求結果回讀，沒有byte-offset/multipart續傳。','',
'## 版本與修補','',
'Source candidate **'+code(r.source_sha)+'**，parent '+code(r.parent_sha)+'；branch codex/cosec-20261023，root '+code(r.root)+'，origin '+r.repo+'。交付前main唯讀仍 '+code(r.main_sha)+'；歷史production aa5d3cbddd895bca953b6eef7266ae1cc0b46215未存取。','',
'Optional uploadRequestId綁server actor與opaque key，依既有unique object_key精確metadata去重。已提交finalize重新核權/核bytes/版本鏈後只讀同結果，不重寫storage或重建文件/version/scan/analysis/checklist receipt。首次並發可能兩個相同PUT，DB receipt只一份。Storage等待後再核權，防止撤權後仍提交metadata。無schema/migration變更。','',
'Portal保存該actor/company/case的metadata與隨機request ID，無bytes/credentials。LostCREATE/LostFINALIZE皆保留原要求；reload後選繼續並重選原檔/hash核對，原checklist即使Received亦保留。錯檔、損壞/不能保存journal拒絕，取消/離頁保留可核對要求。真階段文字、無假百分比；由頭重傳限制明示。','',
'完整source/config **648files** 與final checked freeze及來源commit Git blobs相同。測試時HEAD仍為base+owned dirty diff，最終候選內容相等已逐檔證明；交付commit只加入本輪證據。','',
'## 本次實測','',
'| 層級 | 結果 |','| --- | --- |',
'| Full unit inventory | **'+r.checks.unit.summary.tests.toLocaleString('en-US')+' passed / '+r.checks.unit.summary.files+' files**；24個串行focused段完整聚合，unit-verified.*及unit-shard-* |',
'| Related unit/component/convention | **'+r.checks.targeted.summary.tests+' passed / '+r.checks.targeted.summary.files+' files**；targeted-review-green.* |',
'| Typecheck | exit0；typecheck-review.* |',
'| Lint | exit0，0 errors；既有work-queue Fast Refresh warning原樣保留；lint-final.* |',
'| Build | exit0；未部署；plugin/chunk warnings及產物指紋保留 |',
'| Local browser | **9 passed**，Edge '+r.local_browser.version+'；green3，0 external/page/console/HTTP errors |',
'| Baseline browser negative | **1 expected fail**：71dd6d0 Portal建立2intent/doc/version，修補各1 |',
'| Isolated PostgreSQL | **1 passed / 1 file**；green2，獨立observer+真鎖並發/零行cleanup |',
'| Native Auth/HTTP/DB-RLS/R2/scanner | **BLOCKED / NOT_RUN** |','',
'Browser RPC/sessionStorage為stub；SQL使用注入Auth adapter及持有實際近10MiB bytes的memory storage，scanner0call。兩者分層，不代表原生端到端成功。SQL system ID7700077617266991143，container '+code(r.isolated_sql.container_id)+'，先實際metadata/TCP gate再client/既有schema/fixture，無appseed。兩writer+observer回讀同ID/version、完整rows/xmin不變、scan/analysis/checklist各1；精確IDs/cleanup0後移除本輪target。無假clean/approval、無scan狀態改寫。','',
'## 失敗與完整性','',
'UI RED6fail/1pass、backend RED33fail/28pass（含診斷次序差異，不是33個unsafe缺陷）、storage等待撤權RED1fail/35pass皆保存原始source/log。Backend兩個fake matcher錯誤、Typecheck TS2775及取消測試未安裝matcher亦保留，不冒充產品失敗或native成功。獨立審查兩項P2：持久化expired要求無法重新開始、明確resume B被cached A優先；2fail/10pass重現後修補，138項相關與同版browser/fullunit重跑。原fullunit2683結果保留為修補前版本。','',
'SQL首輪1fail是expired metadata read誤期待throw，與事前PLAN不符。產品未改；以同ID/expiry/created/noDoc/完整row+xmin/PUT count不變取代該錯誤契約，finalize過期拒絕斷言保留。首輪精確清理0，green2新IDs通過。Browser首輪identity fetch失敗0cases，精確原因未知；negative baseline及最後通過均保留。詳見UC150.md。','',
'184原列 = 35F/15R/100UC/34LA，僅UC150追加本機PARTIAL_SCOPED。原/native immutable欄位全相等；**70BLOCKED / 114NOT_RUN / 0nativePASS**。前11批 **1,758個manifest檔案** bytes核實未變，本批SHA256 manifest/CSV validation/候選/驗證報告另附。歷史2076或UC1492630不是本輪結果。','',
'自身browser/server已關閉，精確本輪路徑程序0，SQL目標與連線檔已移除；保留其他使用者工作與共享資源。資源gate/失敗時間原始讀數不抹去。','',
'## 未完成及回復','',
'原生同版Auth/HTTP/DB-RLS/R2/scanner/persisted reload維持blocked；byte-offset/multipart未實作。Journal只限該session，損壞/遺失、換device與獨立新request不提供自動全域hash恢復/去重；首次並發可重複相同PUT，不能聲稱provider exactly-once。正式規模效能/實體裝置未驗。','',
'未push/merge/deploy、未開main自動部署，未改正式migration/資料/帳戶/權限，無真實訊息/付款/交件/付費服務。回復為普通新commit revert '+code(r.source_sha)+'，保留已發布歷史及稽核，無正式資料rollback動作。交付CSV、source/release-candidate及blockers可直接review。',''
];
writeFileSync(join(folder,'DELIVERY.md'),lines.join('\n'),{flag:'wx'});console.log('Wrote exact-version UC150 DELIVERY.');
