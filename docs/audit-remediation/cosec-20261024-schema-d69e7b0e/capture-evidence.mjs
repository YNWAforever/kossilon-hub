import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {digest} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');
assert.equal(process.cwd(),root);
const base='1a9f3fef8e419a3cc75d0d62e90795c3d8134d68';
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const write=(path,value)=>writeFileSync(join(folder,path),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
assert.equal(git('rev-parse','HEAD').toString().trim(),base);
const snapshots=[["src/server/maintenance-trigger-runtime.ts","runtime.before.snapshot"],["src/server/maintenance-trigger-runtime.test.ts","runtime-test.before.snapshot"]].map(([path,file])=>{const bytes=readFileSync(join(folder,file));assert(bytes.equals(git('show',`${base}:${path}`)));return{path,snapshot:file,bytes:bytes.length,sha256:digest(bytes)}});
write('baseline.json',{base,root,branch:git('branch','--show-current').toString().trim(),origin:git('remote','get-url','origin').toString().trim(),intake_status:'clean before owned edits, verified in PLAN.md and intake command',status_at_capture:git('status','--porcelain=v1','--untracked-files=all').toString(),worktrees:git('worktree','list','--porcelain').toString(),main_readonly:'1c57a67213af72bff8d776694e6ed8c986b921db',production_historical_not_accessed:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',snapshots});
const previous='cosec-20261024-transfer-f7337fb9';
const expected=json(join(folder,'..',previous,'prior-evidence-integrity.json')).prior;
const previousManifest=json(join(folder,'..',previous,'release-candidate.json')).evidence_manifest;
const prior=[...expected.map(row=>({...row,manifest_file:row.manifest_file??'evidence-manifest.json'})),{run_id:previous,manifest_file:previousManifest}].map(row=>{
 const path=join(folder,'..',row.run_id,row.manifest_file),bytes=readFileSync(path),manifest=json(path);
 if(row.manifest_sha256)assert.equal(digest(bytes),row.manifest_sha256);
 for(const file of manifest.files){const b=readFileSync(resolve(path,'..',file.path));assert.equal(b.length,file.bytes);assert.equal(digest(b),file.sha256)}
 return{run_id:row.run_id,manifest_file:row.manifest_file,manifest_sha256:digest(bytes),verified_files:manifest.files.length};
});
assert.equal(prior.length,14);assert.equal(prior.reduce((n,row)=>n+row.verified_files,0),2159);
write('prior-evidence-integrity.json',{prior,total_files:2159,all_original_bytes_preserved:true,UC164_manifest:'Use FINAL manifest; original63-file manifest is retained pre-packaging history'});
console.log('Verified two original snapshots and 2159 prior manifested files across 14 runs.');
