import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');
assert.equal(process.cwd(),root);
const base='1a9f3fef8e419a3cc75d0d62e90795c3d8134d68';
const read=name=>JSON.parse(readFileSync(join(folder,name),'utf8').replace(/^\uFEFF/,''));
const lines=name=>readFileSync(join(folder,name),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const write=(name,value)=>writeFileSync(join(folder,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true}).toString().trim();
const sha=git('rev-parse','HEAD'); assert.equal(git('rev-parse','HEAD^'),base);
const paths=git('diff','--name-only',base,sha).split(/\r?\n/).sort();
assert.deepEqual(paths,[...read('source-commit-receipt.json').paths].sort()); assert.equal(paths.length,6);
const freeze=read('source-post-build.json');assert.equal(freeze.files.length,657);
assert.deepEqual(read('source-final2-before.json').files,freeze.files);verifyBlobs(root,sha,freeze.files);
const checks={};
for(const kind of ['targeted','typecheck','lint','build']) {
 const stem=kind+(kind==='build'?'-final3':'-final2'),receipt=read(stem+'.json');assert.equal(receipt.exit_code,0);assert.equal(receipt.error,null);
 checks[kind]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};
}
const plain=name=>stripVTControlCharacters(readFileSync(join(folder,name),'utf8'));
assert.match(plain('focus-red1.txt'),/Tests\s+10 failed \| 11 passed \(21\)/);
assert.match(plain('targeted-final2.txt'),/Test Files\s+10 passed \(10\)/);
assert.match(plain('targeted-final2.txt'),/Tests\s+117 passed \(117\)/);
assert.match(plain('db/test-final3.txt'),/Tests\s+7 passed \(7\)/);
checks.targeted.summary={tests:117,files:10};
const sql=lines('db/test-final3.jsonl'),result=sql.find(r=>r.phase==='test-result');assert.equal(result.exitCode,0);assert.equal(result.error,null);
assert(sql.some(r=>r.phase==='after-test-zero-business-readback'));
for(const [path,hash] of Object.entries(result.fingerprints))assert.equal(digest(readFileSync(join(root,path))),hash,path);
const cases=['missing','unknown','same-count-diverged','no-ledger','missing-marker','missing-index','recovery-replay'];
for(const name of cases) {
 const journal=lines(`db/UC189-${name}-final3.jsonl`);
 assert(!journal.some(r=>r.phase.includes('failed')));
 assert(journal.some(r=>r.phase==='scenario-passed'&&r.externalHttpCalls===0));
 assert(journal.some(r=>r.phase==='independent-full-row-xmin-rollback-readback'&&r.unchanged));
 assert(journal.some(r=>r.phase==='all-public-counts-and-original-rows-restored'));
 if(name!=='recovery-replay')assert(journal.some(r=>r.phase==='refusal-retry-readback'&&r.effects===0&&r.jobFactories===0));
}
const cleanups=['teardown1','teardown2'].map(attempt=>{
 const row=lines(`db/teardown-${attempt}.jsonl`).find(r=>r.phase==='teardown');assert(row?.containerAbsent&&row.ownedCredentialsRemoved);return row;
});
assert.notEqual(cleanups[0].containerId,cleanups[1].containerId);
const target=read('db/provision-provision2.json');assert.equal(target.containerId,cleanups[1].containerId);
checks.sql={log:'db/test-final3.txt',journal:'db/test-final3.jsonl',tests:7,files:1,cases,exit_code:0};
assert.equal(read('independent-review.json').remaining_findings,0);
assert.deepEqual(read('local-process-inspection-final.json').matching_processes,[]);
const remote=read('remote-final.json');assert.equal(remote.main_sha,'1c57a67213af72bff8d776694e6ed8c986b921db');
assert.equal(read('acceptance-verification.json').native_pass,0);
write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:freeze.head,paths,files:freeze.files.filter(row=>paths.includes(row.path)),source_freeze:'source-post-build.json',source_files_verified:657,all_final_checked_source_bytes_equal_committed:true});
write('release-candidate.json',{
 run_id:'cosec-20261024-schema-d69e7b0e',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:'codex/cosec-20261023',source_sha:sha,parent_sha:base,main_sha:remote.main_sha,
 production_sha_user_supplied_historical:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',phase:'LOCAL_UC189_PARTIAL_SCOPED_NATIVE_BLOCKED',release_gate:'NO_GO',deployed:false,auth_runtime_verified:false,native_http_db_rls_verified:false,
 native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks,full_unit:'NOT_RUN_THIS_BATCH',browser:'NOT_RUN_THIS_BATCH; existing Operations component tests only',
 isolated_sql:{container_id:target.containerId,system_id:target.identity.systemId,database:target.database,removed:true,external_http_calls:0,authentication:'disposable PostgreSQL SCRAM only; no application Auth or RLS',recovery_job:'injected no-effect job; real durable claim/run SQL; transaction rolled back',prior_target_removed:true},
 limitations:['scheduler entry only; other mutation entrypoints not covered','migration-ID parity plus two outbox physical facts only; no full-catalog/checksum/permissions acceptance','historical schema exceptions remain fail-closed without a separately reviewed target/build policy','native same-version Auth/HTTP/platform ticks and persisted browser reload BLOCKED','no production schema, provider, backup/restore or release acceptance'],
 rollback:{action:'ordinary new commit reverting '+sha+'; preserve evidence and published history',database_changes:'none to deploy; no migration added',production_action:false}
 });
const output=join(root,'.output'),walk=dir=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p]});
write('build-artifacts.json',{root:output,files:walk(output).sort().map(path=>{const b=readFileSync(path);return{path:relative(output,path).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
console.log(JSON.stringify({source_sha:sha,unit:117,sql:7,source_files:657,native_pass:0}));
