import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='6f29c4068fcbbaa2197efdf0b8969777b78f47c5';
assert.equal(process.cwd(),root);
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>writeFileSync(join(folder,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
assert.equal(git('rev-parse','HEAD').toString().trim(),base);
const snapshots=[['src/routes/portal.tsx','portal-before.tsx.snapshot'],['src/features/documents/repository.ts','document-repository-before.ts.snapshot']].map(([path,filename])=>{
  const bytes=readFileSync(join(folder,filename));assert.equal(hash(git('show',`${base}:${path}`)),hash(bytes));return{revision:base,path,filename,bytes:bytes.length,sha256:hash(bytes)};
});
write('baseline.json',{base,branch:git('branch','--show-current').toString().trim(),origin:git('remote','get-url','origin').toString().trim(),root,intake_status:'clean, recorded in PLAN.md before owned edits',status_at_evidence_capture:git('status','--porcelain=v1','--untracked-files=all').toString(),worktrees:git('worktree','list','--porcelain').toString(),snapshots,production_historical_not_accessed:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215'});
const old=resolve(folder,'../cosec-20261024-routes-e4b761c9');
const prior=[...json(join(old,'prior-evidence-integrity.json')).prior.map(r=>r.run_id),'cosec-20261024-routes-e4b761c9'].sort().map(run_id=>{
  const path=resolve(folder,'..',run_id,'evidence-manifest.json'),bytes=readFileSync(path),manifest=json(path);
  for(const row of manifest.files){const b=readFileSync(resolve(path,'..',row.path));assert.equal(b.length,row.bytes);assert.equal(hash(b),row.sha256)}
  return{run_id,manifest_sha256:hash(bytes),verified_files:manifest.files.length};
});
assert.equal(prior.length,10);assert.equal(prior.reduce((n,r)=>n+r.verified_files,0),1642);
write('prior-evidence-integrity.json',{prior,total_files:1642,all_original_bytes_preserved:true});
console.log('Verified two original source snapshots and 1642 prior manifested files across 10 runs.');
