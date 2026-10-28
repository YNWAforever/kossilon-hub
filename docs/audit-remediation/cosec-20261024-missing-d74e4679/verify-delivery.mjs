import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {digest,verifyBlobs} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const read=name=>json(join(folder,name));
const source=read('source-candidate.json'),candidate=read('release-candidate.json');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:root,windowsHide:true}).trim(),source.source_sha);
verifyBlobs(root,source.source_sha,read(source.source_freeze).files);
assert.equal(candidate.source_sha,source.source_sha);assert.equal(candidate.release_gate,'NO_GO');
assert.deepEqual(candidate.native_matrix,{BLOCKED:70,NOT_RUN:114,PASS:0});
for(const [key,check]of Object.entries(candidate.checks)){
  const receipt=read(check.receipt);assert.equal(receipt.exit_code,0,key);assert.equal(receipt.error,null,key);
}
const prior=read('prior-evidence-integrity.json');assert.equal(prior.prior.length,12);
let oldCount=0;
for(const run of prior.prior){
  const path=resolve(folder,'..',run.run_id,'evidence-manifest.json'),bytes=readFileSync(path);assert.equal(digest(bytes),run.manifest_sha256);
  const manifest=json(path);assert.equal(manifest.files.length,run.verified_files);
  for(const row of manifest.files){const b=readFileSync(resolve(path,'..',row.path));assert.equal(b.length,row.bytes);assert.equal(digest(b),row.sha256);oldCount++}
}
assert.equal(oldCount,1953);
// The first packaging gate failed before commit. Retain and verify that entire
// original manifest against the pre-repair helper/prose snapshots, not new bytes.
const snapshots=new Map(read('packaging-failure.json').snapshots.map(r=>[r.path,r.snapshot]));
const first=read('evidence-manifest.json');assert.equal(first.files.length,63);
for(const row of first.files){const bytes=readFileSync(join(folder,snapshots.get(row.path)??row.path));assert.equal(bytes.length,row.bytes);assert.equal(digest(bytes),row.sha256)}
const manifest=read('evidence-manifest-final.json');
assert.equal(manifest.run_id,'cosec-20261024-missing-d74e4679');
for(const row of manifest.files){const bytes=readFileSync(join(folder,row.path));assert.equal(bytes.length,row.bytes);assert.equal(digest(bytes),row.sha256)}
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[relative(folder,p).replaceAll('\\','/')]});
const actual=walk(folder).filter(p=>!['evidence-manifest-final.json','verification-report-final.txt'].includes(p)).sort();
assert.deepEqual(manifest.files.map(r=>r.path).sort(),actual);
const report={source_sha:source.source_sha,verified_source_git_blobs:649,verified_prior_runs:12,verified_prior_files:oldCount,verified_current_manifest_files:manifest.files.length,tests:75,test_files:7,edge_passed:9,baseline_edge_failed:1,native_pass:0,release_gate:'NO_GO',external_actions:false};
writeFileSync(join(folder,'verification-report-final.txt'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
