import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..');
const base='c9d783478572b1e11331018d46e09e20f427b832';
assert.equal(process.cwd(),root);
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>writeFileSync(join(folder,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
assert.equal(git('rev-parse','HEAD').toString().trim(),base);
const path='src/features/corporate-changes/components/production-corporate-change-detail.tsx';
const bytes=readFileSync(join(folder,'detail-before.tsx.snapshot'));
assert.equal(hash(git('show',`${base}:${path}`)),hash(bytes));
write('baseline.json',{base,branch:git('branch','--show-current').toString().trim(),origin:git('remote','get-url','origin').toString().trim(),root,intake_status:'clean before owned edits, see PLAN.md',status_at_evidence_capture:git('status','--porcelain=v1','--untracked-files=all').toString(),worktrees:git('worktree','list','--porcelain').toString(),snapshot:{revision:base,path,filename:'detail-before.tsx.snapshot',bytes:bytes.length,sha256:hash(bytes)},production_historical_not_accessed:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',remote_main_readonly:'1c57a67213af72bff8d776694e6ed8c986b921db'});
const previous='cosec-20261024-upload-98d2f4c9';
const prior=[...json(join(folder,'..',previous,'prior-evidence-integrity.json')).prior.map(r=>r.run_id),previous].sort().map(run_id=>{
  const path=resolve(folder,'..',run_id,'evidence-manifest.json'),bytes=readFileSync(path),manifest=json(path);
  for(const row of manifest.files){const b=readFileSync(resolve(path,'..',row.path));assert.equal(b.length,row.bytes);assert.equal(hash(b),row.sha256)}
  return{run_id,manifest_sha256:hash(bytes),verified_files:manifest.files.length};
});
assert.equal(prior.length,12);assert.equal(prior.reduce((n,r)=>n+r.verified_files,0),1953);
write('prior-evidence-integrity.json',{prior,total_files:1953,all_original_bytes_preserved:true});
console.log('Verified original snapshot and 1953 prior manifested files across 12 runs.');
