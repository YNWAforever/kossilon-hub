import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='104af5c4875d2f10b595ec330fcb2e1d07e87201',run='cosec-20261024-handover-exec-a30e04f1';
assert.equal(process.cwd(),root);
const git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim();
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
const lines=n=>readFileSync(join(folder,n),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const write=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p]});
const expected=[
 'src/features/admin/production-staff-admin.interaction.test.tsx','src/features/admin/production-staff-admin.tsx',
 'src/features/admin/repository.ts','src/features/admin/server-fns.test.ts','src/features/admin/server-fns.ts','src/features/admin/types.ts',
 'src/features/annual-return/repository.ts','src/features/annual-return/server-fns.ts','src/features/bulk-operations/repository.ts',
 'src/features/corporate-changes/repository.ts','src/features/documents/maintenance.ts','src/features/incorporation/repository.ts',
 'src/features/nar-import/apply.ts','src/features/work-items/repository.ts','src/test/db-integration-files.ts',
 'src/features/admin/handover-execution.integration.test.ts','src/features/admin/handover.ts',
 'src/features/admin/staff-handover-panel.interaction.test.tsx','src/features/admin/staff-handover-panel.tsx','src/features/auth/staff-lifecycle.ts'
].sort();
function prior(){const b=read('baseline.json');assert.equal(b.base,base);assert.equal(b.prior.length,20);let count=0;for(const r of b.prior){const path=join(folder,'..',r.run_id,r.manifest_file);assert.equal(digest(readFileSync(path)),r.manifest_sha256);for(const f of JSON.parse(readFileSync(path,'utf8')).files){const bytes=readFileSync(resolve(path,'..',f.path));assert.equal(bytes.length,f.bytes);assert.equal(digest(bytes),f.sha256);count++;}}assert.equal(count,2718);return count;}
function checks(){
 const summary=read('check-summary.json');assert.equal(summary.native_pass,0);assert.equal(summary.release_gate,'NO_GO');
 for(const key of ['unit','typecheck','lint']){const c=summary.checks[key];assert.equal(c.result,'PASS');assert.equal(read(c.receipt).exit_code,0);}
 assert.equal(summary.checks.unit.tests,2780);assert.equal(summary.checks.unit.files,288);
 const build=summary.checks.build;if(build.result==='PASS')assert.equal(read(build.receipt).exit_code,0);else{assert.equal(build.result,'NOT_RUN_RESOURCE');const g=lines('resource-checks.jsonl').findLast(r=>r.stage===build.stage);assert(g&&!g.allowed&&!g.started);assert(g.free_bytes<3*2**30);}
 assert.equal(summary.checks.sql.result,'PASS_LOCAL_INJECTED_SESSION_SUPERUSER');
 for(const [stem,code] of [['db/test-red',1],['db/test-green-r2',1],['db/test-green-r3',1],['db/test-green-r4',0]]){assert.equal(lines(stem+'.jsonl').find(r=>r.phase==='test-result').exitCode,code);}
 const journey=lines('db/UC186-green-r4.jsonl');const done=journey.find(r=>r.phase==='journey-passed');assert(done);assert.equal(done.externalHttpCalls,0);for(const k of ['nativeAuth','nativeHttp','dbRls'])assert.equal(done[k],false);assert(journey.some(r=>r.phase==='extension-complete'));
 assert.equal(read('targeted-delayed-red-ready.json').exit_code,1);assert.equal(read('targeted-delayed-green.json').exit_code,0);assert.equal(read('focus-ui-red.json').exit_code,1);
 const inv=read('owned-inventory.json');assert.deepEqual(inv.matching_containers,[]);assert.deepEqual(inv.remaining_owned_state_or_credential_files,[]);assert.deepEqual(read('local-process-inspection-final.json').matching_processes,[]);
 const frozen=read('source-post-checks.json');assert.equal(frozen.files.length,674);assert.deepEqual(frozen.files,read('source-full-green-before.json').files);for(const f of frozen.files){const b=readFileSync(join(root,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);}
 const acceptance=read('acceptance-verification.json');assert.equal(acceptance.native_pass,0);assert.equal(acceptance.original_rows,184);assert.equal(acceptance.local_appended_only,'UC186');assert.equal(acceptance.layers_preserved,true);
 assert.equal(read('review.json').remaining_actionable_scoped_findings,0);
 return summary;
}
const mode=process.argv[2];
if(mode==='preflight'){
 assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('diff','--cached','--name-only'),'');
 const changed=[...git('diff','--name-only').split(/\r?\n/),...git('ls-files','--others','--exclude-standard','src').split(/\r?\n/)].filter(Boolean).sort();assert.deepEqual(changed,expected);checks();prior();console.log('Verified source scope, actual local results,184 original records and prior2718 evidence files.');
}else if(mode==='candidate'){
 const sha=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);assert.deepEqual(git('diff','--name-only',base,sha).split(/\r?\n/).sort(),expected);const result=checks();prior();verifyBlobs(root,sha,read('source-post-checks.json').files);
 write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:base,tested_worktree_content_equal:true,source_freeze:'source-post-checks.json',source_files_verified:674,paths:expected,scope:'UC186 lawful cross-business case/work owner/reviewer handover and lifecycle admission',checks:result.checks,red_source_provenance:'Separate SQL/UI RED snapshots and freezes retained; RED versions are not claimed to be the final candidate'});
 write('release-candidate.json',{run_id:run,source_sha:sha,parent_sha:base,previous_candidate:'209aef6c78fe1ded6ad3a68eba4eaa9bd7304243',repo:'https://github.com/YNWAforever/kossilon-hub.git',branch:'codex/cosec-20261023',phase:'UC186_LOCAL_CASE_WORK_HANDOVER_AND_CONCURRENCY',release_gate:'NO_GO',original_uc186:'PARTIAL_SCOPED',local_core_functional_scope:'PASS',required_local_checks:result.all_required_local_checks_passed?'PASS':'INCOMPLETE',deployed:false,native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},checks:result.checks,auth_runtime_verified:false,native_http_db_rls_verified:false,isolated_runtime:{result:'PASS_LOCAL_SQL_INJECTED_SESSION_SUPERUSER',containers_created:5,cleanup:'ALL_5_DISPOSED_SEALED_AND_CREDENTIALS_REMOVED',external_http_calls:0,inventory:'owned-inventory.json'},remaining_local:result.all_required_local_checks_passed?[]:['build after original3GiB RAM gate'],native_plan:'NATIVE-PLAN.md',coverage:'COVERAGE.md',blockers:'blockers.md',rollback:'ordinary new commit reverting '+sha+'; retain evidence; no production effects; committed future real business handovers require separately authorized compensation',evidence_manifest:'evidence-manifest.json'});
 console.log(JSON.stringify({source_sha:sha,unit:2780,sql:1,build:result.checks.build.result,release_gate:'NO_GO'}));
}else if(mode==='manifest'){
 write('evidence-manifest.json',{run_id:run,files:walk(folder).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(relative(folder,p))).sort().map(p=>{const b=readFileSync(p);return{path:relative(folder,p).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
}else if(mode==='verify'){
 const source=read('source-candidate.json');assert.equal(git('rev-parse','HEAD'),source.source_sha);verifyBlobs(root,source.source_sha,read(source.source_freeze).files);const result=checks(),old=prior();
 const manifest=read('evidence-manifest.json');for(const r of manifest.files){const b=readFileSync(join(folder,r.path));assert.equal(b.length,r.bytes);assert.equal(digest(b),r.sha256);}
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),walk(folder).map(p=>relative(folder,p).replaceAll('\\','/')).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(p)).sort());
 write('verification-report.json',{source_sha:source.source_sha,source_git_blobs:674,prior_runs:20,prior_manifested_files:old,current_manifested_files:manifest.files.length,unit:2780,unit_files:288,sql:1,build:result.checks.build.result,required_local_checks:result.all_required_local_checks_passed?'PASS':'INCOMPLETE',original_uc186:'PARTIAL_SCOPED',native_pass:0,release_gate:'NO_GO',push_merge_deploy:false});console.log('Verified674 source Git blobs, prior2718 files, current evidence, local checks and unchanged native NO_GO.');
}else if(mode==='git'){
 const source=read('source-candidate.json'),head=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),source.source_sha);verifyBlobs(root,head,walk(folder).map(p=>({path:relative(root,p).replaceAll('\\','/')})));verifyBlobs(root,head,read(source.source_freeze).files);assert.equal(git('status','--porcelain=v1'),'');console.log(JSON.stringify({delivery_sha:head,source_sha:source.source_sha,status:'clean',native_pass:0,release_gate:'NO_GO',push_merge_deploy:false}));
}else throw Error('Expected preflight/candidate/manifest/verify/git');
