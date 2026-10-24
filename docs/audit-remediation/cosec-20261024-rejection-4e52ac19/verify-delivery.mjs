import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),local=name=>json(join(folder,name));
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const report=[],record=(name,v)=>report.push(`${name}: ${JSON.stringify(v)}`);
const manifest=local('evidence-manifest.json');
for(const row of manifest.files){const p=resolve(folder,row.path);assert(p.startsWith(folder+'\\'));const b=readFileSync(p);assert.equal(b.length,row.bytes);assert.equal(digest(b),row.sha256)}
const walk=dir=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[relative(folder,p).replaceAll('\\','/')]});
assert.deepEqual(walk(folder).filter(p=>!['evidence-manifest.json','verification-report.txt'].includes(p)).sort(),manifest.files.map(r=>r.path).sort());record('current_manifest_verified_files',manifest.files.length);
const prior=local('prior-evidence-integrity.json');
for(const item of prior.prior){const p=resolve(folder,'..',item.run_id,'evidence-manifest.json');assert.equal(digest(readFileSync(p)),item.manifest_sha256);for(const row of json(p).files){const b=readFileSync(resolve(p,'..',row.path));assert.equal(b.length,row.bytes);assert.equal(digest(b),row.sha256)}}
assert.equal(prior.prior.length,10);assert.equal(prior.total_files,1642);record('prior_bytes_preserved',{runs:10,files:1642});
const candidate=local('release-candidate.json'),source=local('source-candidate.json');assert.equal(candidate.source_sha,source.source_sha);assert.equal(candidate.release_gate,'NO_GO');assert.equal(candidate.auth_runtime_verified,false);assert.equal(candidate.native_http_db_verified,false);
const freeze=local(source.source_freeze);verifyBlobs(root,source.source_sha,freeze.files);assert.equal(freeze.files.length,643);
assert.deepEqual(git('diff','--name-only',source.parent_sha,source.source_sha).toString().trim().split(/\r?\n/).sort(),source.paths);
record('source_identity',{sha:source.source_sha,files:643,changed:source.paths});
assert.deepEqual(local('source-post-checks.json').files,freeze.files);
assert.deepEqual(local('source-during-verified.json').files,freeze.files);
assert.deepEqual(local('source-during-unit.json').files,local('source-final-tests.json').files);
assert.equal(local('marker-equivalence.json').emitted_javascript_equal,true);
for(const row of local('baseline.json').snapshots){assert.equal(digest(readFileSync(join(folder,row.filename))),row.sha256);assert.equal(digest(git('show',`${row.revision}:${row.path}`)),row.sha256)}record('original_snapshots_verified',2);
const validation=local('acceptance-validation.json');assert(validation.all_immutable_fields_equal);assert.equal(validation.rows,184);assert.deepEqual(validation.scoped_rows,['UC149']);assert.equal(validation.native_pass,0);record('acceptance',validation);
for(const check of Object.values(candidate.checks))assert.equal(local(check.receipt).exit_code,0);
assert.deepEqual(candidate.checks.unit.summary,{tests:2630,files:275});assert.deepEqual(candidate.checks.targeted.summary,{tests:83,files:9});record('checks',candidate.checks);
const browser=local(candidate.checks.browser.report);assert.equal(browser.results.length,9);assert(browser.results.every(r=>r.status==='passed'));assert.equal(browser.outer_error,null);for(const k of ['blocked_external_origins','page_errors','console_errors','http_errors'])assert.deepEqual(browser[k],[]);assert.equal(browser.native_auth_http_db_storage_scanner,false);record('browser',{passed:9,version:browser.browser_version,native:false});
const historical=local('browser-results-historical1.json');assert.equal(historical.results.length,1);assert.equal(historical.results[0].status,'failed');assert(historical.results[0].error.includes('退回原因'));assert.equal(historical.outer_error,null);record('baseline_browser_negative_control',{failed:1,reason:'baseline Portal omits rejection instruction'});
const sql=local('db/db-rejection-green.json'),cleanup=local('db/db-cleanup.json');assert.equal(sql.exit_code,0);assert(cleanup.container_absent_after&&cleanup.credentials_removed);assert(Object.values(cleanup.own_row_counts_before_removal).every(n=>n===0));record('isolated_sql',{passed:1,cleanup_all_zero:true,container_removed:cleanup.container_id,native_auth_storage_scanner:false});
for(const [name,failed,passed]of [['targeted-red-contract.txt',10,70],['targeted-duplicate-red.txt',1,80]]){
  const text=readFileSync(join(folder,name),'utf8');assert(new RegExp(`Tests\\s+${failed} failed \\| ${passed} passed`).test(text));
}record('retained_product_red',{contract_failed:10,duplicate_failed:1,first_setup_error_retained_separately:true});
assert.deepEqual(local('local-process-inspection-final.json').matching_processes,[]);record('owned_runtime_processes_remaining',0);
record('native_matrix',candidate.native_matrix);record('release_gate','NO_GO');
writeFileSync(join(folder,'verification-report.txt'),report.join('\n')+'\n',{flag:'wx'});console.log(report.join('\n'));
