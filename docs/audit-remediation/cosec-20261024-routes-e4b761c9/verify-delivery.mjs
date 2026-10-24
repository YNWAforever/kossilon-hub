import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const report=[],record=(name,value)=>report.push(`${name}: ${JSON.stringify(value)}`);
const manifest=json(join(folder,'evidence-manifest.json'));
for(const row of manifest.files){const path=resolve(folder,row.path);assert(path.startsWith(folder+'\\'));const bytes=readFileSync(path);assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256)}
const walk=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[relative(folder,path).replaceAll('\\','/')]});
assert.deepEqual(walk(folder).filter(p=>!['evidence-manifest.json','verification-report.txt'].includes(p)).sort(),manifest.files.map(r=>r.path).sort());
record('current_manifest_verified_files',manifest.files.length);
const prior=json(join(folder,'prior-evidence-integrity.json'));
for(const item of prior.prior){const p=resolve(folder,'..',item.run_id,'evidence-manifest.json');assert.equal(hash(readFileSync(p)),item.manifest_sha256);for(const row of json(p).files){const bytes=readFileSync(resolve(p,'..',row.path));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256)}}
record('prior_manifests_and_bytes_verified',{runs:prior.prior.length,files:prior.total_files});
const candidate=json(join(folder,'release-candidate.json')),source=json(join(folder,'source-candidate.json'));
assert.equal(candidate.source_sha,source.source_sha);assert.equal(candidate.release_gate,'NO_GO');assert.equal(candidate.auth_runtime_verified,false);assert.equal(candidate.native_http_db_verified,false);
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
for(const row of json(join(folder,source.source_freeze)).files){const bytes=readFileSync(join(root,row.path));assert.equal(hash(bytes),row.sha256);assert.equal(hash(git('show',`${source.source_sha}:${row.path}`)),row.sha256)}
assert.deepEqual(git('diff','--name-only',source.parent_sha,source.source_sha).toString().trim().split(/\r?\n/).sort(),source.paths);
record('source_git_blob_identity',{sha:source.source_sha,files:source.source_files_verified,production_changes:0});
const validation=json(join(folder,'acceptance-validation.json'));assert.equal(validation.all_immutable_fields_equal,true);assert.equal(validation.rows,184);assert.equal(validation.native_pass,0);record('acceptance_validation',validation);
for(const check of Object.values(candidate.checks)){assert.equal(json(join(folder,check.receipt)).exit_code,0)}
assert.equal(candidate.checks.unit.summary.tests,2617);assert.equal(candidate.checks.targeted.summary.tests,92);record('checks',candidate.checks);
const browser=json(join(folder,'browser-results-green2.json'));assert.equal(browser.results.length,12);assert(browser.results.every(r=>r.status==='passed'));for(const f of ['blocked_external_origins','page_errors','console_errors','http_errors'])assert.deepEqual(browser[f],[]);
assert.equal(browser.native_auth_http_db,false);assert.equal(browser.outer_error,null);record('local_browser',{passed:12,version:browser.browser_version,native:false});
const old=json(join(folder,'browser-results-historical1.json'));assert.equal(old.results.length,2);assert(old.results.every(r=>r.status==='failed'&&r.reads.length===0&&r.dom.includes('搜尋既有案件')));assert.equal(old.outer_error,null);record('historical_negative_control',{failed:2,current_product_defects:0});
for(const row of json(join(folder,'baseline.json')).snapshots){const bytes=readFileSync(join(folder,row.filename));assert.equal(hash(bytes),row.sha256);assert.equal(hash(git('show',`${row.revision}:${row.path}`)),row.sha256)}
record('original_snapshots','4 exact Git blobs verified');
assert.equal(json(join(folder,'comment-equivalence.json')).emitted_javascript_equal,true);record('final_source_freeze','Final full unit/focused/browser/typecheck/lint/build reference source-verified.json; initial failures retained separately');
assert.deepEqual(json(join(folder,'local-process-inspection-final.json')).matching_processes,[]);record('owned_runtime_processes_remaining',0);
record('native_matrix',candidate.native_matrix);record('release_gate','NO_GO');
writeFileSync(join(folder,'verification-report.txt'),report.join('\n')+'\n',{flag:'wx'});
console.log(report.join('\n'));
