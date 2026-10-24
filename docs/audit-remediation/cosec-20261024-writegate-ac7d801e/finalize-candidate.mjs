import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const base='495fc88061a874b285e0fd7131b042243ab74b92';
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
const lines=n=>readFileSync(join(folder,n),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const plain=n=>stripVTControlCharacters(readFileSync(join(folder,n),'utf8'));
const write=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true}).toString().trim();
const sha=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);
const paths=git('diff','--name-only',base,sha).split(/\r?\n/).sort();assert.equal(paths.length,12);assert.deepEqual(paths,[...read('source-commit-receipt.json').paths].sort());
const freeze=read('source-post-checks.json');assert.equal(freeze.files.length,664);assert.deepEqual(freeze.files,read('source-final-before.json').files);verifyBlobs(root,sha,freeze.files);
const checks={};
for(const [kind,attempt]of [['targeted','final'],['typecheck','final'],['lint','second'],['unit','final'],['build','final']]){
 const stem=kind+'-'+attempt,r=read(stem+'.json');assert.equal(r.exit_code,0);assert.equal(r.error,null);checks[kind]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};
}
assert.match(plain('focus-red1.txt'),/Tests\s+9 failed \| 5 passed \(14\)/);
assert.match(plain('targeted-final.txt'),/Tests\s+130 passed \(130\)/);assert.match(plain('targeted-final.txt'),/Test Files\s+15 passed \(15\)/);
checks.targeted.summary={tests:130,files:15};
const unit=plain('unit-final.txt'),ut=[...unit.matchAll(/Tests\s+(\d+) passed(?: \| (\d+) skipped)?/g)].at(-1),uf=[...unit.matchAll(/Test Files\s+(\d+) passed(?: \| (\d+) skipped)?/g)].at(-1);
assert(ut&&uf);checks.unit.summary={tests:Number(ut[1]),files:Number(uf[1]),skipped_tests:Number(ut[2]??0),skipped_files:Number(uf[2]??0)};
assert.match(plain('db/test-first.txt'),/Tests\s+9 passed \(9\)/);
const result=lines('db/test-first.jsonl').find(r=>r.phase==='test-result');assert.equal(result.exitCode,0);assert.equal(result.error,null);
for(const [path,hash]of Object.entries(result.fingerprints))assert.equal(digest(readFileSync(join(root,path))),hash,path);
const cases=['missing','unknown','same-count-diverged','no-ledger','missing-marker','missing-index','recovery','late-write-rollback','webhook-recovery'];
for(const name of cases){
 const j=lines(`db/UC189-write-${name}-first.jsonl`);assert(!j.some(r=>r.phase.includes('failed')));
 assert(j.some(r=>r.phase==='scenario-passed'&&r.externalHttpCalls===0));assert(j.some(r=>r.phase==='all-public-business-counts-and-original-rows-restored'));
 if(!['recovery','late-write-rollback','webhook-recovery'].includes(name)){
  assert(j.some(r=>r.phase==='refusal-retry-full-row-xmin-readback'&&r.unchanged&&r.writerFactories===0&&r.staff&&r.client&&r.hmac));
  assert(j.some(r=>r.phase==='independent-original-full-row-rollback-readback'&&r.unchanged));
 }else assert(j.some(r=>r.phase==='independent-committed-full-row-readback'));
}
checks.sql={tests:9,files:1,exit_code:0,log:'db/test-first.txt',journal:'db/test-first.jsonl',cases};
const target=read('db/provision-provision2.json'),removed=lines('db/teardown-teardown3.jsonl').find(r=>r.phase==='teardown');assert(removed?.containerAbsent&&removed.ownedCredentialsRemoved);assert.equal(removed.containerId,target.containerId);
assert.equal(read('independent-review.json').remaining_findings,0);assert.deepEqual(read('local-process-inspection-final.json').matching_processes,[]);
const remote=read('remote-final.json');assert.equal(remote.main_sha,'1c57a67213af72bff8d776694e6ed8c986b921db');assert.equal(read('acceptance-verification.json').native_pass,0);
const inventory=read('entrypoint-inventory.json');assert.equal(inventory.post_functions,74);assert.equal(inventory.post_modules,17);
for(const row of inventory.modules)assert.equal(digest(readFileSync(join(root,row.file))),row.sha256);
write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:freeze.head,paths,files:freeze.files.filter(r=>paths.includes(r.path)),source_freeze:'source-post-checks.json',source_files_verified:664,all_final_checked_source_bytes_equal_committed:true});
write('release-candidate.json',{run_id:'cosec-20261024-writegate-ac7d801e',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:'codex/cosec-20261023',source_sha:sha,parent_sha:base,main_sha:remote.main_sha,production_sha_user_supplied_historical:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',phase:'LOCAL_UC189_NON_SCHEDULED_PARTIAL_SCOPED_NATIVE_BLOCKED',release_gate:'NO_GO',deployed:false,auth_runtime_verified:false,native_http_db_rls_verified:false,native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks,source_inventory:{post_functions:74,modules:17,scope:'source-only; not74 executed native journeys'},isolated_sql:{container_id:target.containerId,system_id:target.identity.systemId,database:target.database,removed:true,external_http_calls:0,auth:'injected session adapter + real SQL actor mapping; locally signed synthetic HMAC Request; disposable superuser, no native Auth/HTTP/RLS'},browser:'NOT_RUN_THIS_BATCH',limitations:['migration ID parity and two physical outbox facts only; full schema/checksums/privileges and concurrent DDL not verified','representative client rollback; not every late provider/domain error atomicity','infrastructure Auth proxy/session/login recovery outside business DB gate','native compiled HTTP/Auth/RLS/browser reload/platform ticks/providers/production schema remain BLOCKED'],rollback:{action:'ordinary new commit reverting '+sha+'; retain original evidence and published history',migration_added:false,production_action:false}});
const output=join(root,'.output'),walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p]});
write('build-artifacts.json',{root:output,files:walk(output).sort().map(path=>{const b=readFileSync(path);return{path:relative(output,path).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
console.log(JSON.stringify({source_sha:sha,related_unit:130,full_unit:checks.unit.summary,sql:9,source_files:664,native_pass:0}));
