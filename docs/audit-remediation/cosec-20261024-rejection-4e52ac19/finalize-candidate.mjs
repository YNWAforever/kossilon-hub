import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='6f29c4068fcbbaa2197efdf0b8969777b78f47c5';assert.equal(process.cwd(),root);
const json=name=>JSON.parse(readFileSync(join(folder,name),'utf8').replace(/^\uFEFF/,''));
const write=(name,value)=>writeFileSync(join(folder,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true}).toString().trim();
const sha=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);
const paths=git('diff','--name-only',base,sha).split(/\r?\n/).sort();
assert.deepEqual(paths,['src/features/documents/rejection-projection.test.ts','src/features/documents/rejection-readback.integration.test.ts','src/features/documents/repository.ts','src/routes/-document-rejection.interaction.test.tsx','src/routes/portal.tsx','src/test/db-integration-files.ts']);
const freeze=json('source-verified.json'),initial=json('source-final-tests.json');
assert.deepEqual(json('source-during-unit.json').files,initial.files);
assert.deepEqual(initial.files.filter((r,i)=>r.sha256!==freeze.files[i].sha256).map(r=>r.path),['src/features/documents/rejection-readback.integration.test.ts']);
assert.equal(json('marker-equivalence.json').emitted_javascript_equal,true);
assert.deepEqual(json('source-post-checks.json').files,freeze.files);
assert.deepEqual(json('source-during-verified.json').files,freeze.files);
const review=json('independent-review.json'),marker=json('marker-equivalence.json');
assert.equal(review.result,'NO_ACTIONABLE_FINDINGS');assert.deepEqual(review.findings,[]);
for(const row of review.reviewed_source_files){
  const current=digest(readFileSync(join(root,row.path)));
  if(current!==row.sha256){assert.equal(row.path,marker.path);assert.equal(row.sha256,marker.before_sha256);assert.equal(current,marker.after_sha256)}
}
assert.equal(freeze.head,base);assert.equal(freeze.files.length,643);verifyBlobs(root,sha,freeze.files);
write('source-candidate.json',{source_sha:sha,parent_sha:base,tested_head:base,paths,files:freeze.files.filter(row=>paths.includes(row.path)),source_freeze:'source-verified.json',source_files_verified:freeze.files.length,all_final_unit_source_bytes_equal_committed:true,sql_comment_equivalence:'marker-equivalence.json',production_changes:['src/features/documents/repository.ts','src/routes/portal.tsx']});
const checks={};
for(const kind of ['targeted','unit','typecheck','lint','build']){
  const stem=kind+(['unit','targeted'].includes(kind)?'-verified':'-final'),r=json(stem+'.json');assert.equal(r.exit_code,0);assert.equal(r.error,null);checks[kind]={receipt:stem+'.json',log:stem+'.txt',exit_code:0};
  if(['targeted','unit'].includes(kind)){
    const log=readFileSync(join(folder,stem+'.txt'),'utf8'),t=log.match(/\n\s*Tests\s+(\d+) passed \((\d+)\)/),f=log.match(/\n\s*Test Files\s+(\d+) passed \((\d+)\)/);
    assert(t&&f);assert.equal(t[1],t[2]);assert.equal(f[1],f[2]);checks[kind].summary={tests:Number(t[1]),files:Number(f[1])};
  }
}
assert.deepEqual(checks.targeted.summary,{tests:83,files:9});assert.deepEqual(checks.unit.summary,{tests:2630,files:275});
const browser=json('browser-accepted.json');assert.equal(browser.exit_code,0);assert.equal(browser.passed,9);
checks.browser={receipt:browser.receipt,log:browser.receipt.replace(/\.json$/,'.txt'),report:browser.report,exit_code:0,passed:browser.passed};
assert.equal(json('db/db-rejection-green.json').exit_code,0);checks.db={receipt:'db/db-rejection-green.json',log:'db/db-rejection-green.txt',exit_code:0,summary:{tests:1,files:1},scope:'isolated TCP PostgreSQL repository/membership with controlled Auth/scan fixtures'};
assert.equal(readFileSync(join(folder,'db/db-migrations.txt'),'utf8').split(/\r?\n/).filter(line=>line.startsWith('Applied ')).length,50);
const cleanup=json('db/db-cleanup.json');assert(cleanup.container_absent_after&&cleanup.credentials_removed);assert(Object.values(cleanup.own_row_counts_before_removal).every(n=>n===0));
const phases=readFileSync(join(folder,'db/sidecar-UC149-SQL-green.jsonl'),'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
assert(phases.some(r=>r.phase==='assertions-complete'&&r.assertionsPassed));assert(phases.some(r=>r.phase==='cleanup-readback'&&Object.values(r.remaining).every(n=>n===0)));
assert.deepEqual(json('local-process-inspection-final.json').matching_processes,[]);
const historical=json('browser-results-historical1.json');assert.equal(historical.results.length,1);assert.equal(historical.results[0].status,'failed');assert(historical.results[0].error.includes('退回原因'));assert.equal(historical.outer_error,null);
assert.equal(historical.sourceHashes['src/routes/portal.tsx'],digest(readFileSync(join(folder,'portal-before.tsx.snapshot'))));
const remote=json('remote-final.json');assert.equal(remote.main_sha,'1c57a67213af72bff8d776694e6ed8c986b921db');
write('release-candidate.json',{run_id:'cosec-20261024-rejection-4e52ac19',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:'codex/cosec-20261023',source_sha:sha,parent_sha:base,main_sha:remote.main_sha,production_sha_user_supplied_historical:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',phase:'LOCAL_UC149_PARTIAL_SCOPED_NATIVE_BLOCKED',release_gate:'NO_GO',deployed:false,auth_runtime_verified:false,native_http_db_verified:false,native_matrix:{BLOCKED:70,NOT_RUN:114,PASS:0},source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks,local_browser:{version:browser.version,passed:9,transport:'sessionStorage local RPC stub',report:browser.report},isolated_database:{system_id:'7700060938157912103',container_id:cleanup.container_id,removed:true,native_auth_storage_scanner:false},remaining:['native Reviewer+Client and HTTP DB/RLS/storage/scanner/reload','full evidence service SQL/SLA/audit runtime','UC150 ambiguous commit retry/resume','production-scale reason lookup performance'],rollback:{action:`ordinary new commit reverting ${sha}; preserve historical evidence`,production_action:false}});
const output=join(root,'.output'),walk=dir=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p]});
write('build-artifacts.json',{root:output,files:walk(output).sort().map(p=>{const b=readFileSync(p);return{path:relative(output,p).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
console.log(JSON.stringify({source_sha:sha,checks,verified_source_files:643,native_pass:0}));
