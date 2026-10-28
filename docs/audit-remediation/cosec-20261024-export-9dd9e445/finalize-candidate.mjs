import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..');
assert.equal(process.cwd(),root);
const read=path=>JSON.parse(readFileSync(join(folder,path),'utf8').replace(/^\uFEFF/,''));
const write=(path,value)=>writeFileSync(join(folder,path),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true});
const text=args=>git(args).toString('utf8').trim();
const freeze=read('source-freeze.json'),sourceSha=text(['rev-parse','HEAD']);
assert.notEqual(sourceSha,freeze.parent_sha);
const paths=freeze.files.map(f=>f.path);
assert.deepEqual(text(['diff','--name-only',freeze.parent_sha,sourceSha]).split(/\r?\n/).sort(),[...paths].sort());
const sourceFiles=freeze.files.map(f=>{const bytes=readFileSync(join(root,f.path));assert.equal(hash(bytes),f.sha256);assert(bytes.equals(git(['show',`${sourceSha}:${f.path}`])));return{...f,git_blob_equal:true};});
write('source-candidate.json',{source_sha:sourceSha,parent_sha:freeze.parent_sha,tested_head:freeze.parent_sha,tested_dirty_source:paths,paths,files:sourceFiles,scope:'Tests ran before source commit; exact tested source bytes equal the committed Git blobs.'});
writeFileSync(join(folder,'source.patch'),git(['diff','--binary',freeze.parent_sha,sourceSha,'--',...paths]),{flag:'wx'});
const checks={};
for(const [kind,stem] of Object.entries({unit:'unit-verified',typecheck:'typecheck-final',lint:'lint-final',build:'build-final',targeted:'targeted-final'})){
  const receipt=read(stem+'.json');assert.equal(receipt.exit_code,0,stem);
  checks[kind]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};
}
const strip=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const unit=strip(readFileSync(join(folder,'unit-verified.txt'),'utf8'));
const files=unit.match(/Test Files\s+(\d+) passed\s+\((\d+)\)/);
const tests=unit.match(/Tests\s+(\d+) passed\s+\((\d+)\)/);
assert(files&&tests);assert.equal(files[1],files[2]);assert.equal(tests[1],tests[2]);
assert.match(unit,/bulk-export.interaction.test.tsx.*\(5 tests\)/);
const lint=strip(readFileSync(join(folder,'lint-final.txt'),'utf8'));
const problems=lint.match(/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
if(problems)assert.equal(Number(problems[2]),0);
const checkSummary={unit_files:Number(files[1]),unit_pass:Number(tests[1]),unit_fail:0,unit_skip:0,ui_export_pass:5,ui_included_in_unit:true,targeted_backend_pass:21,sql_files:1,sql_pass_per_attempt:1,sql_attempts:2,sql_attempts_not_combined_with_unit:true,lint_errors:0,lint_warnings:problems?Number(problems[3]):0,native_auth_runtime:false};
const targeted=strip(readFileSync(join(folder,'targeted-final.txt'),'utf8'));assert.match(targeted,/21 passed \(21\)/);
write('check-summary.json',checkSummary);
const readback=read('readback-summary.json');assert.equal(readback.cases.length,2);
checks.sql={files:1,passed:1,attempt:'final',receipt:'db/db-export-final.json',log:'db/db-export-final.txt',summary:'readback-summary.json',earlier_attempt:'db/db-export-initial.json'};
checks.browser='NOT_RUN';checks.native='BLOCKED';
const remote=read('remote-final.json');assert.equal(remote.exit_code,0);assert.match(remote.output,/^1c57a67213af72bff8d776694e6ed8c986b921db\s+refs\/heads\/main/);
const walk=directory=>readdirSync(directory).flatMap(name=>{const path=join(directory,name);return statSync(path).isDirectory()?walk(path):[path];});
const output=join(root,'.output');
write('build-artifacts.json',{root:output,files:walk(output).sort().map(path=>{const bytes=readFileSync(path);return{path:relative(output,path).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)};})});
write('release-candidate.json',{run_id:'cosec-20261024-export-9dd9e445',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:text(['branch','--show-current']),source_sha:sourceSha,parent_sha:freeze.parent_sha,main_sha:'1c57a67213af72bff8d776694e6ed8c986b921db',main_recheck:'remote-final.json',production_sha_user_supplied_historical:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',phase:'LOCAL_UC157_VERIFIED_NATIVE_BLOCKED',release_gate:'NO_GO',auth_runtime_verified:false,deployed:false,source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks,rollback:{action:`ordinary new commit reverting ${sourceSha}; preserve evidence and published history`,production_action:false}});
const delivery=`# UC157 本機交付 — 付款匯出範圍與金額

Run cosec-20261024-export-9dd9e445。候選來源 ${sourceSha}；parent ${freeze.parent_sha}；branch codex/cosec-20261023。remote main 最後唯讀核對仍為 1c57a67213af72bff8d776694e6ed8c986b921db；首次 sandbox DNS 失敗與其後成功讀取分開保存。production 只保留使用者提供的歷史 SHA，未查詢／修改正式環境。

## 成果及修補

- CSV 保留被當前權限遮蔽的 disposition 列，空 identity／output，不再漏數；每頁核對 saved-job 指紋、總數、ordinal 與 cursor。跨頁 worker 改變 job 時拒絕交付不一致 CSV。
- UI click 固定 job／actor scope，換 job、換 actor 或 unmount 後丟棄舊請求結果。錯誤後明確重試、防連按、CSV bytes／filename／URL revoke 有 mocked UI 覆蓋。
- 沿用既有付款／審批及 repository 授權；沒有新 schema、endpoint 或正式資料修補。原 UC157／R17／R23 編號與關聯保持。

## 本輪實際檢查

| 層 | 結果與證據 |
| --- | --- |
| 後端先重現 | 6 failed／12 passed；targeted-red.json／txt 及原 source/test snapshots 保留 |
| 最終後端聚焦 | 21 passed，2 files；targeted-final.json／txt |
| UI 先重現 | 1 passed／4 failed：兩項 stale-scope 產品失敗，另兩項 Blob constructor double harness 失敗，分類保留 |
| UI 修補後聚焦 | 5 passed／0 failed；sidecar-green-report.json；亦納入完整 unit |
| 完整 unit 首輪 | 2529 passed／269 files；1 個 fork worker 啟動逾時，exit 1，未當通過；unit-final.json／txt 與 unit-first-failure.json 保留 |
| 完整 unit 重驗 | ${checkSummary.unit_pass} passed／${checkSummary.unit_files} files，0 failed／0 skipped；unit-verified.json／txt |
| 真隔離 SQL | initial 與 final 各 1 it passed，兩輪不同精確 UUID；不加算成 unit 或 103 個 tests |
| Typecheck／lint／build | 全部 exit 0；lint ${checkSummary.lint_warnings} warning。曾有 TS18046 failure，補型別 assertion 後重跑 final SQL 及 typecheck，失敗保留 |

測試在 parent HEAD 加六個本輪 source/test dirty 檔案執行；source-freeze、db-source-freeze 與 source-candidate 的逐檔 SHA256／Git blob 相等。source.patch 可 review，build-artifacts.json 記錄本輪 build bytes。沒有把舊 2076 或上一批 2538 結果當本輪結果。

首輪 worker 沒有回應，未執行 work-queue 檔案的 assertions；該檔與 parent Git blob 相同。底層啟動逾時原因未確立，沒有改測試期望或 app 來源來迎合它；單檔同 bytes diagnostic 與完整 suite 重驗結果分開保存。

## Runtime 實際範圍

真 SQL snapshot → preview → execute／相同 key replay → 100＋3 worker → saved getJob → 兩頁 CSV → 獨立磁碟解析及回讀。103 筆可匯出付款（101 未付、1 部分、1 全付），另 1 fixture 排除；HKD invoice 185400／received 2150.25／balance 183249.75。匯出前後 104 payments、2 receipt entries、6 audit events 的完整 snapshot 相同，outbox=0。

遮蔽後保留 103 列含 1 opaque forbidden／102 outputs；三種 supplied-role 拒絕與 persisted inactive profile 拒絕。獨立 SQL session 在兩頁間實際推進一項，export 拒絕 409，沒有 partial CSV。其後取消 102 項，保留已成功 1 項，resume processed=0、重匯 byte 相同。三種 CSV 每輪各一份，SHA256 及重新解析摘要見 readback-summary.json／db JSONL。

文件／部分全款前置的 scan verdict 為無外發本機 contract stub；沒有 genuine storage/scanner/provider。public users／profiles 是隔離合成資料，不是 native Auth。沒有 browser／HTTP／RLS／返回／reload／正式 download 證據。

## 隔離、原始證據及清理

client 前核對 Docker Desktop context、完整容器／pinned image ID、labels、loopback port、mounts=[]、tmpfs／memory 及實際路徑；TCP／container system ID 一致：7699935043524436008。只套 50 個既有 schema migrations 與三個精確 immutable SLA 前置。每輪 UUID 已先記錄，兩輪 own fixture readback 全 0；teardown 前全部 business／bulk 表為 0，僅 foundation user 至容器整體移除。

容器 6bdf2eb4bb2f401a121fbe05b533f294585822c3fe5e4b25b88c38f350cf97fe 及本輪憑證已移除，313 個既有容器保留，daemon 未停止。低 RAM 讀數與其後通過的逐項 gate 分開保存，未清理別人的資源。七批歷史 manifest 全部相等，原始失敗、早期 handoff 及澄清 append-only 保留。

## 未完成、回復及下一步

原 184 列保留 35 F／15 R／100 UC／34 LA；native **70 BLOCKED／114 NOT_RUN／0 PASS，NO_GO**。本輪 UC157／R17／R23 local 只追加 PARTIAL_SCOPED。具體缺口見 blockers.md；候選仍需同版隔離 native target 才能補 Auth／HTTP／RLS／browser reload。

沒有 push、merge、deploy、正式 migration／資料／帳戶／權限／訊息／付款動作。若需撤回來源修補，用普通新 commit revert 候選來源 SHA，保留歷史及證據；無正式資料回復。下一本機批次先核對尚未覆蓋情境與既有測試，再建立新 run；原生缺口保持 blocked。
`;
writeFileSync(join(folder,'DELIVERY.md'),delivery,{flag:'wx'});
console.log(JSON.stringify({source_sha:sourceSha,...checkSummary}));
