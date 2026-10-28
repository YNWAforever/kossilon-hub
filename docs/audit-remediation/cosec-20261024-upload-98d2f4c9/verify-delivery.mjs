import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),local=n=>json(join(folder,n));
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const report=[],record=(name,v)=>report.push(name+': '+JSON.stringify(v));
const manifest=local('evidence-manifest.json');
for(const row of manifest.files){const p=resolve(folder,row.path);assert(p.startsWith(folder+'\\'));const b=readFileSync(p);assert.equal(b.length,row.bytes);assert.equal(digest(b),row.sha256)}
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[relative(folder,p).replaceAll('\\','/')]});
assert.deepEqual(walk(folder).filter(p=>!['evidence-manifest.json','verification-report.txt'].includes(p)).sort(),manifest.files.map(r=>r.path).sort());record('current_manifest_verified_files',manifest.files.length);
const prior=local('prior-evidence-integrity.json');
for(const item of prior.prior){const p=resolve(folder,'..',item.run_id,'evidence-manifest.json');assert.equal(digest(readFileSync(p)),item.manifest_sha256);for(const row of json(p).files){const b=readFileSync(resolve(p,'..',row.path));assert.equal(b.length,row.bytes);assert.equal(digest(b),row.sha256)}}
assert.equal(prior.prior.length,11);assert.equal(prior.total_files,1758);record('prior_bytes_preserved',{runs:11,files:1758});
const candidate=local('release-candidate.json'),source=local('source-candidate.json');assert.equal(candidate.source_sha,source.source_sha);assert.equal(candidate.release_gate,'NO_GO');assert.equal(candidate.auth_runtime_verified,false);assert.equal(candidate.native_http_db_verified,false);
const freeze=local(source.source_freeze);assert.equal(freeze.files.length,648);verifyBlobs(root,source.source_sha,freeze.files);assert.deepEqual(local('source-post-checks.json').files,freeze.files);
assert.deepEqual(git('diff','--name-only',source.parent_sha,source.source_sha).toString().trim().split(/\r?\n/).sort(),source.paths);record('source_identity',{sha:source.source_sha,files:648,changed:source.paths});
for(const row of local('baseline.json').snapshots){assert.equal(digest(readFileSync(join(folder,row.filename))),row.sha256);assert.equal(digest(git('show',row.revision+':'+row.path)),row.sha256)}
assert(readFileSync(join(folder,'server-fns-before.ts.snapshot')).equals(git('show',source.parent_sha+':src/features/documents/server-fns.ts')));record('original_snapshots_verified',3);
for(const check of Object.values(candidate.checks))assert.equal(local(check.receipt).exit_code,0);
assert.deepEqual(candidate.checks.unit.summary,{tests:2685,files:278});assert.deepEqual(candidate.checks.targeted.summary,{tests:138,files:12});
const unit=local('unit-verified.json'),inventory=local('unit-shard-inventory.json');assert.equal(unit.summary.shards,24);assert.equal(unit.all_source_hashes_verified,true);assert.equal(inventory.shards.length,24);
const observed=[];
for(const [index,paths] of inventory.shards.entries()){
  const name='unit-shard-'+String(index+1).padStart(2,'0'),r=local(name+'.json');assert.equal(r.exit_code,0);assert.equal(r.error,null);assert(paths.length<=12);assert.deepEqual(r.files,paths);assert.deepEqual(r.observed.map(x=>x.path).sort(),[...paths].sort());observed.push(...r.observed);
  const raw=readFileSync(join(folder,name+'.txt'),'utf8');for(const row of r.observed)assert(raw.includes(row.path));
}
assert.equal(observed.length,278);assert.equal(new Set(observed.map(r=>r.path)).size,278);assert.equal(observed.reduce((n,r)=>n+r.tests,0),2685);record('final_unit_execution',{shards:24,files:278,tests:2685,resource_policy:'unchanged 3GiB single-run gate refused twice; <=12-file serial subsets at existing focused 1.5GiB gate'});record('checks',candidate.checks);
const browser=local(candidate.checks.browser.report);assert.equal(browser.results.length,9);assert(browser.results.every(r=>r.status==='passed'));assert.equal(browser.outer_error,null);for(const k of ['blocked_external_origins','page_errors','console_errors','http_errors'])assert.deepEqual(browser[k],[]);assert.equal(browser.native_auth_http_rpc_db_storage_scanner,false);record('browser',{passed:9,version:browser.browser_version,native:false});
const historical=local('browser-results-historical1.json');assert.equal(historical.results.length,1);assert.equal(historical.results[0].status,'failed');const binding=local('browser-handoff.json');assert.equal(binding.actual_runtime.baseline_intents,2);assert.equal(binding.actual_runtime.baseline_documents,2);assert.equal(binding.actual_runtime.baseline_versions,2);record('baseline_negative_control',{failed:1,intents:2,documents:2,versions:2});
const cleanup=local('db/db-cleanup.json');assert.equal(local('db/db-upload-green2.json').exit_code,0);assert(cleanup.container_absent_after&&cleanup.credentials_removed);assert(Object.values(cleanup.own_row_counts_before_removal).every(n=>n===0));record('isolated_sql',{passed:1,cleanup_all_zero:true,removed:cleanup.container_id,system_id:'7700077617266991143',scanner_calls:0,native:false});
const validation=local('acceptance-validation.json');assert.equal(validation.rows,184);assert(validation.all_immutable_fields_equal);assert.deepEqual(validation.scoped_rows,['UC150']);assert.equal(validation.native_pass,0);record('acceptance',validation);
const review=local('review-resolution.json');assert.equal(review.resolved.length,2);assert.equal(review.reproduced_failures,2);assert.equal(review.remaining,0);record('review_resolution',review);
assert.deepEqual(local('local-process-inspection-after-checks.json').matching_processes,[]);record('owned_runtime_processes_remaining',0);record('native_matrix',candidate.native_matrix);record('release_gate','NO_GO');
writeFileSync(join(folder,'verification-report.txt'),report.join('\n')+'\n',{flag:'wx'});console.log(report.join('\n'));
