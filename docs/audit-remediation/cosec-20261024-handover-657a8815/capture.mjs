import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {digest} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='d2f96c899e30661943b2a59740c2e266a976d9d2',previous='cosec-20261024-admin-ab8690c7';
assert.equal(process.cwd(),root);
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true}).toString().trim();
const read=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('rev-parse','HEAD^'),'9c3afceae55014a024b547d47daf9d7d97e9cc44');
const old=read(join(folder,'..',previous,'prior-evidence-integrity.json')).prior;
const prior=[...old,{run_id:previous,manifest_file:'evidence-manifest.json'}].map(row=>{
 const path=join(folder,'..',row.run_id,row.manifest_file??'evidence-manifest.json'),bytes=readFileSync(path),manifest=read(path);
 if(row.manifest_sha256)assert.equal(digest(bytes),row.manifest_sha256);
 for(const item of manifest.files){const b=readFileSync(resolve(path,'..',item.path));assert.equal(b.length,item.bytes);assert.equal(digest(b),item.sha256);}
 return {run_id:row.run_id,manifest_file:row.manifest_file??'evidence-manifest.json',manifest_sha256:digest(bytes),verified_files:manifest.files.length};
});
assert.equal(prior.length,18);assert.equal(prior.reduce((n,r)=>n+r.verified_files,0),2534);
writeFileSync(join(folder,'baseline.json'),JSON.stringify({base,candidate:'9c3afceae55014a024b547d47daf9d7d97e9cc44',root,origin:git('remote','get-url','origin'),branch:git('branch','--show-current'),intake_status:'clean, first current-turn identity command; no subsequent delivery found',worktrees:git('worktree','list','--porcelain'),original_csv:{path:'../'+previous+'/acceptance-results.csv',sha256:digest(readFileSync(join(folder,'..',previous,'acceptance-results.csv')))},prior,total_prior_files:2534,private_graph:'8s metadata timeout; prior rejected private indexing not retried'},null,2)+'\n',{flag:'wx'});
console.log('Verified base/candidate relationship and 2534 prior manifested files across18 runs.');
