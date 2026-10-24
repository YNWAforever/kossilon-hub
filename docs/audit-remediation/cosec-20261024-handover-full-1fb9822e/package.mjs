import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='7a70e3be143cf771b6693f4ec2bb491817f74ca9',run='cosec-20261024-handover-full-1fb9822e';
assert.equal(process.cwd(),root);
const git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim();
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
const lines=n=>readFileSync(join(folder,n),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const write=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p]});
const expected=['src/features/work-items/assignment.test.ts','src/features/work-items/assignment.ts','src/features/work-items/repository.ts','src/features/work-items/types.ts'].sort();
function prior(){const b=read('baseline.json');assert.equal(b.base,base);let count=0;for(const r of b.prior){const path=join(folder,'..',r.run_id,r.manifest_file);assert.equal(digest(readFileSync(path)),r.manifest_sha256);for(const f of JSON.parse(readFileSync(path,'utf8')).files){const bytes=readFileSync(resolve(path,'..',f.path));assert.equal(bytes.length,f.bytes);assert.equal(digest(bytes),f.sha256);count++;}}assert.equal(count,2655);return count;}
function checks(){
 const rows={};for(const key of ['targeted','typecheck','lint']){const stem=key+'-accepted',r=read(stem+'.json');assert.equal(r.exit_code,0,key);assert.equal(r.error,null);rows[key]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};}
 const text=stripVTControlCharacters(readFileSync(join(folder,'targeted-accepted.txt'),'utf8'));
 assert.match(text,/Tests\s+36 passed/);assert.match(text,/Test Files\s+8 passed/);rows.targeted.tests=36;rows.targeted.files=8;
 assert.equal(read('focus-red.json').exit_code,1);assert.match(readFileSync(join(folder,'focus-red.txt'),'utf8'),/2 failed \| 13 passed/);
 const resource=lines('resource-checks.jsonl').findLast(r=>r.stage==='build-accepted');assert(resource);assert.equal(resource.allowed,false);assert.equal(resource.started,false);assert(resource.free_bytes<3*2**30);assert(!existsSync(join(folder,'build-accepted.json')));rows.build={result:'NOT_RUN_RESOURCE',receipt:'resource-checks.jsonl',free_bytes:resource.free_bytes,minimum_gib:3};
 for(const attempt of ['red','red-ready','red-ready2','red-headroom-restored']){const records=lines('db/provision-'+attempt+'.jsonl');assert.equal(records.length,2);assert.equal(records[0].phase,'resource-gate');assert(records[0].freeBytes<records[0].minimumBytes);assert.equal(records[1].phase,'failed-preserved');assert(!existsSync(join(folder,'db/provision-'+attempt+'.json')));}
 const inv=read('owned-inventory.json');assert.deepEqual(inv.matching_containers,[]);assert.equal(inv.cache_exists,false);assert.equal(inv.db_clients_created,0);assert.equal(inv.fixtures_created,0);assert.deepEqual(read('local-process-inspection-final.json').matching_processes,[]);
 const pending=read('pending-test-status.json');assert.equal(pending.files.length,2);for(const f of pending.files){const bytes=readFileSync(join(folder,f.snapshot));assert.equal(bytes.length,f.bytes);assert.equal(digest(bytes),f.sha256);}
 assert(!existsSync(join(root,'src/features/admin/handover-execution.integration.test.ts')));
 for(const p of ['src/features/admin/production-staff-admin.interaction.test.tsx','src/test/db-integration-files.ts'])assert.equal(digest(readFileSync(join(root,p))),digest(execFileSync('git',['show',base+':'+p],{cwd:root,windowsHide:true})));
 const frozen=read('source-post-checks.json');assert.equal(frozen.files.length,669);assert.deepEqual(frozen.files,read('source-accepted-before.json').files);for(const f of frozen.files){const bytes=readFileSync(join(root,f.path));assert.equal(bytes.length,f.bytes);assert.equal(digest(bytes),f.sha256);}
 assert.equal(read('acceptance-verification.json').native_pass,0);assert.equal(read('acceptance-verification.json').original_rows,184);
 rows.sql={result:'NOT_RUN_RESOURCE',clients:0,fixtures:0,containers:0,full_handover:'NOT_IMPLEMENTED',concurrency:'NOT_RUN'};
 return rows;
}
const mode=process.argv[2];
if(mode==='preflight'){
 assert.equal(git('rev-parse','HEAD'),base);assert.deepEqual(git('diff','--name-only').split(/\r?\n/).sort(),expected);checks();prior();console.log('Prerequisite-only candidate verified: unit/type/lint passed; SQL/build blocked; full UC186 incomplete.');
}else if(mode==='candidate'){
 const sha=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);assert.deepEqual(git('diff','--name-only',base,sha).split(/\r?\n/).sort(),expected);const checksResult=checks();prior();verifyBlobs(root,sha,read('source-post-checks.json').files);
 write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:base,tested_worktree_content_equal:true,source_freeze:'source-post-checks.json',source_files_verified:669,paths:expected,scope:'null-required-skill eligibility prerequisite only',build:'NOT_RUN_RESOURCE',sql:'NOT_RUN_RESOURCE',red_source_provenance:'base product with initial new regression tests; no atomic pre-RED whole-source manifest; retained logs/snapshots, not final SHA RED'});
 write('release-candidate.json',{run_id:run,source_sha:sha,parent_sha:base,previous_candidate:'4e5b4532091d125d79ca19244a0699f26832166a',repo:'https://github.com/YNWAforever/kossilon-hub.git',branch:'codex/cosec-20261023',phase:'UC186_NULL_SKILL_PREREQUISITE_ONLY',release_gate:'NO_GO',full_uc186:'INCOMPLETE',deployed:false,native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},checks:checksResult,full_unit:'NOT_RUN_THIS_BATCH',auth_runtime_verified:false,native_http_db_rls_verified:false,isolated_runtime:{result:'NOT_RUN',clients:0,fixtures:0,resources_created:0,cleanup:'NOT_NEEDED'},remaining_local:['full lawful cross-business owner/reviewer handover command','idempotent operation retry/receipt, positive audit and readback','new-case/assignment versus disable both orders','real SQL null-skill recommendation path','build after RAM gate'],native_plan:'NATIVE-PLAN.md',coverage:'COVERAGE.md',blockers:'blockers.md',rollback:'ordinary new commit reverting '+sha+'; retain evidence; no DB or production effects',evidence_manifest:'evidence-manifest.json'});
 console.log(JSON.stringify({source_sha:sha,unit:36,sql:0,build:'NOT_RUN_RESOURCE',full_uc186:'INCOMPLETE',release_gate:'NO_GO'}));
}else if(mode==='manifest'){
 write('evidence-manifest.json',{run_id:run,files:walk(folder).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(relative(folder,p))).sort().map(p=>{const b=readFileSync(p);return{path:relative(folder,p).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
}else if(mode==='verify'){
 const source=read('source-candidate.json');assert.equal(git('rev-parse','HEAD'),source.source_sha);verifyBlobs(root,source.source_sha,read(source.source_freeze).files);checks();const old=prior();
 const manifest=read('evidence-manifest.json');for(const r of manifest.files){const b=readFileSync(join(folder,r.path));assert.equal(b.length,r.bytes);assert.equal(digest(b),r.sha256);}
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),walk(folder).map(p=>relative(folder,p).replaceAll('\\','/')).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(p)).sort());
 write('verification-report.json',{source_sha:source.source_sha,source_git_blobs:669,prior_runs:19,prior_manifested_files:old,current_manifested_files:manifest.files.length,unit:36,sql:'NOT_RUN',build:'NOT_RUN_RESOURCE',full_uc186:'INCOMPLETE',native_pass:0,release_gate:'NO_GO',push_merge_deploy:false});console.log('Verified source Git blobs, all prior files, current evidence manifest and honest incomplete gates.');
}else if(mode==='git'){
 const source=read('source-candidate.json'),head=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),source.source_sha);verifyBlobs(root,head,walk(folder).map(p=>({path:relative(root,p).replaceAll('\\','/')})));verifyBlobs(root,head,read(source.source_freeze).files);assert.equal(git('status','--porcelain=v1'),'');console.log(JSON.stringify({delivery_sha:head,source_sha:source.source_sha,status:'clean',native_pass:0,full_uc186:'INCOMPLETE',push_merge_deploy:false}));
}else throw Error('Expected preflight/candidate/manifest/verify/git');
