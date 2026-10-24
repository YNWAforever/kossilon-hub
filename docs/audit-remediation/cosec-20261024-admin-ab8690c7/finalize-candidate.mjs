import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='e629583fbc4559e80f6b9c2cbb560928c7a1603b';
assert.equal(process.cwd(),root);
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
const lines=n=>readFileSync(join(folder,n),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const plain=n=>stripVTControlCharacters(readFileSync(join(folder,n),'utf8'));
const write=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true}).toString().trim();
const sha=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);
const paths=git('diff','--name-only',base,sha).split(/\r?\n/).sort();
assert.deepEqual(paths,['src/features/admin/last-admin.integration.test.ts','src/test/db-integration-files.ts']);
assert.deepEqual(paths,[...read('source-commit-receipt.json').paths].sort());
const freeze=read('source-post-checks.json');assert.equal(freeze.files.length,668);
assert.deepEqual(freeze.files,read('source-final2-before.json').files);
verifyBlobs(root,sha,freeze.files);
for(const path of ['src/features/admin/repository.ts','src/features/admin/server-fns.ts']){
  const original=execFileSync('git',['show',base+':'+path],{cwd:root,windowsHide:true});assert(original.equals(readFileSync(join(root,path))));
}
const checks={};
for(const kind of ['targeted','typecheck','lint','build']){
  const stem=kind+'-final2',r=read(stem+'.json');assert.equal(r.exit_code,0);assert.equal(r.error,null);
  checks[kind]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};
}
const tests=plain('targeted-final2.txt').match(/Tests\s+(\d+) passed/),files=plain('targeted-final2.txt').match(/Test Files\s+(\d+) passed/);
assert(tests&&files);checks.targeted.summary={tests:Number(tests[1]),files:Number(files[1])};
assert.deepEqual(checks.targeted.summary,{tests:25,files:7});
assert.equal(read('typecheck-first.json').exit_code,2);assert.match(plain('typecheck-first.txt'),/TS2322/);
assert.equal(read('typecheck-second.json').exit_code,0);
assert.match(plain('db/test-first.txt'),/Tests\s+1 passed \(1\)/);assert.match(plain('db/test-third.txt'),/Tests\s+1 passed \(1\)/);
const result=lines('db/test-third.jsonl').find(r=>r.phase==='test-result');assert.equal(result.exitCode,0);assert.equal(result.error,null);
for(const[path,hash]of Object.entries(result.fingerprints))assert.equal(digest(readFileSync(join(root,path))),hash,path);
const journey=lines('db/UC185-journey-third.jsonl');assert(!journey.some(r=>r.phase.includes('failed')));
const phases=['sole-admin-disable-demote-retries-refused-no-write','roles-identity-denied-and-current-noop-preserved','disabled-session-stale-retry-and-fresh-noop','independent-actor-row-revision-and-audit-readback','journey-passed'];
for(const phase of phases)assert(journey.some(r=>r.phase===phase),phase);
for(const phase of ['observed-advisory-wait','opposite-removals-one-commit-one-refusal']){
  assert.deepEqual(journey.filter(r=>r.phase===phase).map(r=>r.label).sort(),['demote-before-disable','disable-before-demote']);
}
const final=journey.find(r=>r.phase==='independent-actor-row-revision-and-audit-readback');assert.equal(final.snapshot.activeAdmins,1);assert.equal(final.audit.length,3);
for(const row of final.audit){assert.equal(row.old_team_id,row.new_team_id);assert.equal(row.old_team_id,journey.find(r=>r.phase==='planned-ids').ids.team);}
for(const race of journey.filter(r=>r.phase==='opposite-removals-one-commit-one-refusal')){assert.equal(race.repositoryOpenedTransaction,true);assert.equal(race.loserCompleteRowsUnchanged,true);assert.equal(race.loserAuditUnchanged,true);}
const passed=journey.find(r=>r.phase==='journey-passed');assert.equal(passed.externalHttpCalls,0);
const helper=lines('db/helper-third.jsonl');assert(helper.some(r=>r.phase==='all-app-client-backends-closed'));
const seal=helper.find(r=>r.phase==='owned-disposal-seal');assert.equal(seal.succeeded,true);assert.equal(Object.keys(seal.projections).length,1);assert.equal(seal.cleanup.allClientsClosed,true);assert.equal(seal.cleanup.count,4);assert.equal(new Set(seal.cleanup.pids).size,4);
const teardown=lines('db/teardown-third.jsonl');assert(teardown.some(r=>r.phase==='database-inventory-matches-seal'));assert(teardown.some(r=>r.phase==='app-backends-absent-before-removal'));
const removed=teardown.find(r=>r.phase==='teardown');assert(removed.containerAbsent&&removed.ownedCredentialsRemoved);assert.equal(removed.containerId,seal.containerId);
const firstRemoved=lines('db/teardown-first.jsonl').find(r=>r.phase==='teardown');assert(firstRemoved.containerAbsent&&firstRemoved.ownedCredentialsRemoved);assert.notEqual(firstRemoved.containerId,removed.containerId);
const secondRemoved=lines('db/teardown-second.jsonl').find(r=>r.phase==='teardown');assert(secondRemoved.containerAbsent&&secondRemoved.ownedCredentialsRemoved);assert.equal(new Set([firstRemoved.containerId,secondRemoved.containerId,removed.containerId]).size,3);
const target=read('db/provision-third.json');assert.equal(target.containerId,seal.containerId);
const provenance=read('db/migration-provenance-third.json');assert.equal(provenance.containerId,target.containerId);assert.equal(provenance.systemId,target.identity.systemId);assert.equal(provenance.successful,true);assert.equal(Object.keys(provenance.migrationFingerprint).filter(p=>p.startsWith('db/migrations/')).length,50);
for(const[path,hash]of Object.entries(provenance.migrationFingerprint))assert.equal(digest(readFileSync(join(root,path))),hash,path);
assert.deepEqual(lines('db/test-third.jsonl').find(r=>r.phase==='test-migration-source-matches').migrationFingerprint,provenance.migrationFingerprint);
assert.deepEqual(lines('db/test-third.jsonl').find(r=>r.phase==='test-migration-source-still-matches').migrationFingerprint,provenance.migrationFingerprint);
for(const path of ['src/features/operations/schema-catalog.ts','src/features/operations/schema-health.ts'])assert.equal(result.fingerprints[path],provenance.migrationFingerprint[path]);
assert.equal(read('independent-review.json').remaining_findings,0);
assert.deepEqual(read('local-process-inspection-final.json').matching_processes,[]);
const remote=read('remote-final.json');assert.equal(remote.main_sha,'1c57a67213af72bff8d776694e6ed8c986b921db');
assert.equal(read('acceptance-verification.json').native_pass,0);
checks.sql={log:'db/test-third.txt',journal:'db/test-third.jsonl',tests:1,files:1,exit_code:0,scope:'one final real SQL journey including two repository-owned transaction/advisory-lock races and complete refused-state/audit readback',phases,first_pass_with_narrower_harness_preserved:'db/test-first.txt'};
write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:freeze.head,paths,files:freeze.files.filter(r=>paths.includes(r.path)),source_freeze:'source-post-checks.json',source_files_verified:668,all_final_checked_source_bytes_equal_committed:true,product_logic_changed:false});
write('release-candidate.json',{run_id:'cosec-20261024-admin-ab8690c7',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:'codex/cosec-20261023',source_sha:sha,parent_sha:base,main_sha:remote.main_sha,production_sha_user_supplied_historical:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',phase:'LOCAL_UC185_LAST_ADMIN_PARTIAL_SCOPED_NATIVE_BLOCKED',release_gate:'NO_GO',deployed:false,auth_runtime_verified:false,native_http_db_rls_verified:false,native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks,full_unit:{status:'NOT_RUN_THIS_BATCH',reason:'Only a new gated DB acceptance file and its exclusion registry changed; 25 related unit/component checks cover guards, auth and registry; earlier 2768 result remains historical.'},isolated_sql:{container_id:target.containerId,system_id:target.identity.systemId,databases:Object.keys(seal.projections),removed:true,external_http_calls:0,auth:'injected session adapter with real SQL current-identity mapping, actor-service/repository and independent reads; disposable superuser, no native Auth/HTTP/RLS'},product_bug_disposition:'Existing advisory lock/last-Admin/version/identity guards passed unchanged; no new product defect or invented red regression',browser:'NOT_RUN_THIS_BATCH',limitations:['No native Auth/session transport, HTTP error serialization, DB RLS, browser cancel/back/reload or provider account lifecycle acceptance','Two synthetic Admins and two deterministic lock-overlap orders; no complete account/handover/DDL concurrency audit','UC186 handover, invitations, calendars, provider integrations and all original native gaps remain outside this scoped UC185 proof'],rollback:{action:'ordinary new commit reverting '+sha+'; preserve audit evidence and published history',migration_added:false,production_action:false}});
const output=join(root,'.output'),walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p]});
write('build-artifacts.json',{root:output,files:walk(output).sort().map(path=>{const b=readFileSync(path);return{path:relative(output,path).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
console.log(JSON.stringify({source_sha:sha,related_unit:checks.targeted.summary,sql_journeys:1,observed_races:2,audit_events:3,native_pass:0,product_logic_changed:false}));
