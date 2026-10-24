import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='d2f96c899e30661943b2a59740c2e266a976d9d2';assert.equal(process.cwd(),root);
const git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim();
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
const lines=n=>readFileSync(join(folder,n),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const write=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p]});
const expected=['src/features/admin/handover-scope.integration.test.ts','src/features/admin/production-staff-admin.interaction.test.tsx','src/features/admin/production-staff-admin.tsx','src/features/admin/repository.ts','src/features/admin/types.ts','src/test/db-integration-files.ts'].sort();
function checks(){
 const rows={};for(const key of ['targeted','typecheck','lint','build']){const stem=key==='typecheck'?'typecheck-hardened':key+'-accepted2',r=read(stem+'.json');assert.equal(r.exit_code,0,key);assert.equal(r.error,null);rows[key]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};}
 const text=stripVTControlCharacters(readFileSync(join(folder,'targeted-accepted2.txt'),'utf8'));
 rows.targeted.tests=Number(text.match(/Tests\s+(\d+) passed/)[1]);rows.targeted.files=Number(text.match(/Test Files\s+(\d+) passed/)[1]);
 assert.equal(rows.targeted.tests,28);assert.equal(rows.targeted.files,7);
 const sql=lines('db/test-green-r4.jsonl').find(r=>r.phase==='test-result');assert.equal(sql.exitCode,0);assert.equal(sql.error,null);
 for(const[path,hash]of Object.entries(sql.fingerprints))assert.equal(digest(readFileSync(join(root,path))),hash,path);
 const red=lines('db/UC186-red.jsonl').find(r=>r.phase==='unsafe-offboarding-reproduced');assert.equal(red.staffMutationCommitted,true);
 assert.equal(lines('db/test-red.jsonl').find(r=>r.phase==='test-result').exitCode,1);
 assert.equal(lines('db/test-green.jsonl').find(r=>r.phase==='test-result').exitCode,1);
 assert.equal(digest(readFileSync(join(folder,'test-red.snapshot'))),lines('db/test-red.jsonl').find(r=>r.phase==='test-result').fingerprints[expected[0]]);
 const green=lines('db/UC186-green-r4.jsonl');assert(!green.some(r=>r.phase==='failed-preserved'));
 for(const phase of ['all-three-unsafe-changes-and-retries-refused-no-write','corporate-only-zero-work-refusals-no-write','synthetic-terminal-positive-control-rolled-back','bounded-100-preview-with-104-total','independent-final-readback','journey-passed'])assert(green.some(r=>r.phase===phase),phase);
 const bound=green.find(r=>r.phase==='bounded-100-preview-with-104-total').boundary;assert.equal(bound.openCases,104);assert.equal(bound.cases.length,100);assert.equal(bound.truncated,true);
 assert.equal(green.find(r=>r.phase==='journey-passed').externalHttpCalls,0);
 const containers=['red','green','green-r2','green-r3','green-r4'].map(slot=>{const events=lines('db/teardown-'+slot+'.jsonl');assert(events.some(r=>r.phase==='database-inventory-matches-seal'));const end=events.find(r=>r.phase==='teardown');assert(end.containerAbsent&&end.ownedCredentialsRemoved);return end.containerId;});assert.equal(new Set(containers).size,5);
 const seal=lines('db/helper-green-r4.jsonl').find(r=>r.phase==='owned-disposal-seal');assert.equal(seal.succeeded,true);assert.equal(seal.cleanup.count,2);assert.equal(seal.cleanup.allClientsClosed,true);
 assert.equal(read('review.json').remaining_findings,0);assert.deepEqual(read('local-process-inspection-final.json').matching_processes,[]);
 assert.equal(read('lintTest-hardened.json').exit_code,0);rows.lint.final_fixture_receipt='lintTest-hardened.json';
 assert.equal(read('remote-final.json').main_sha,'1c57a67213af72bff8d776694e6ed8c986b921db');
 rows.sql={log:'db/test-green-r4.txt',tests:1,files:1,scope:'synthetic real PostgreSQL enumeration/sequential refusal/terminal rollback/bounded preview; no lawful transfer/native Auth/HTTP/RLS proof'};
 return {rows,containers};
}
function prior(){let count=0;for(const row of read('baseline.json').prior){const dir=join(folder,'..',row.run_id),path=join(dir,row.manifest_file),bytes=readFileSync(path);assert.equal(digest(bytes),row.manifest_sha256);const raw=bytes.toString('utf8'),m=JSON.parse(raw.charCodeAt(0)===0xFEFF?raw.slice(1):raw);for(const f of m.files){const b=readFileSync(join(dir,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);count++;}}assert.equal(count,2534);return count;}
const mode=process.argv[2];
if(mode==='preflight'){
 const {rows}=checks();prior();console.log(JSON.stringify({related_unit:rows.targeted.tests,final_sql:1,native_pass:0,preflight:'passed'}));
}else if(mode==='candidate'){
 const sha=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);assert.deepEqual(git('diff','--name-only',base,sha).split(/\r?\n/).sort(),expected);
 const frozen=read('source-post-checks.json'),unitBuild=read('source-accepted2-before.json');assert.equal(frozen.files.length,669);
 assert.deepEqual(frozen.files.filter(r=>r.path!==expected[0]),unitBuild.files.filter(r=>r.path!==expected[0]));
 assert(!readFileSync(join(root,expected[0]),'utf8').includes('.soft('));verifyBlobs(root,sha,frozen.files);
 const {rows,containers}=checks();assert.equal(read('acceptance-verification.json').native_pass,0);prior();
 write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:frozen.head,paths:expected,source_freeze:'source-post-checks.json',source_files_verified:669,product_bytes_equal_unit_build:true,unit_build_freeze:'source-accepted2-before.json',test_only_hardening_after_unit_build:expected[0],other_668_files_unchanged:true,final_fixture_validated_by:['typecheck-hardened.json','lintTest-hardened.json','db/test-green-r4.jsonl']});
 write('release-candidate.json',{run_id:'cosec-20261024-handover-657a8815',source_sha:sha,parent_sha:base,repo:'https://github.com/YNWAforever/kossilon-hub.git',branch:'codex/cosec-20261023',phase:'UC186_LOCAL_ENUMERATION_REFUSAL_PARTIAL_SCOPED',release_gate:'NO_GO',deployed:false,native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},auth_runtime_verified:false,native_http_db_rls_verified:false,checks:rows,full_unit:'NOT_RUN_THIS_BATCH; historical2768 and previous25/SQL1 not reused',isolated_runtime:{auth:'injected session adapter + real SQL mapping',database_role:'disposable superuser',external_http_calls:0,containers_removed:containers},remaining_local:['complete lawful owner/reviewer transfer across case types','creation/assignment versus offboarding concurrency'],native_plan:'NATIVE-PLAN.md',coverage:'COVERAGE.md',rollback:'ordinary new commit reverting '+sha+'; preserve evidence, no production migration/data reversal',evidence_manifest:'evidence-manifest.json'});
 console.log(JSON.stringify({source_sha:sha,related_unit:rows.targeted.tests,sql:1,release_gate:'NO_GO'}));
}else if(mode==='manifest'){
 write('evidence-manifest.json',{run_id:'cosec-20261024-handover-657a8815',files:walk(folder).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(relative(folder,p))).sort().map(p=>{const b=readFileSync(p);return{path:relative(folder,p).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
}else if(mode==='verify'){
 const source=read('source-candidate.json'),candidate=read('release-candidate.json');assert.equal(git('rev-parse','HEAD'),source.source_sha);verifyBlobs(root,source.source_sha,read(source.source_freeze).files);checks();const old=prior();
 const manifest=read('evidence-manifest.json');for(const row of manifest.files){const b=readFileSync(join(folder,row.path));assert.equal(b.length,row.bytes);assert.equal(digest(b),row.sha256);}
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),walk(folder).map(p=>relative(folder,p).replaceAll('\\','/')).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(p)).sort());
 write('verification-report.json',{source_sha:source.source_sha,source_git_blobs:669,prior_runs:18,prior_manifested_files:old,current_manifested_files:manifest.files.length,unit:candidate.checks.targeted.tests,sql:1,full_unit:'NOT_RUN',native_pass:0,release_gate:'NO_GO',push_merge_deploy:false});console.log('Verified current manifest, source Git blobs, original evidence and scoped checks.');
}else if(mode==='git'){
 const source=read('source-candidate.json'),head=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),source.source_sha);verifyBlobs(root,head,walk(folder).map(p=>({path:relative(root,p).replaceAll('\\','/')})));verifyBlobs(root,head,read(source.source_freeze).files);assert.equal(git('status','--porcelain=v1'),'');console.log(JSON.stringify({delivery_sha:head,source_sha:source.source_sha,status:'clean',native_pass:0,push_merge_deploy:false}));
}else throw Error('Expected candidate/manifest/verify/git');
