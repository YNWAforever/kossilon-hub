import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const base='36dad48dc30a86329f0afcc2ffb46749be71e94e';assert.equal(git('rev-parse','HEAD').toString().trim(),base);
const versions={base,branch:git('branch','--show-current').toString().trim(),origin:git('remote','get-url','origin').toString().trim(),remote_main_readonly:'1c57a67213af72bff8d776694e6ed8c986b921db',production_historical_not_accessed:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',status_at_capture:git('status','--porcelain=v1').toString(),worktrees:git('worktree','list','--porcelain').toString(),no_env_files:readdirSync(root).filter(n=>n.startsWith('.env')&&n!=='.env.example')};assert.deepEqual(versions.no_env_files,[]);
versions.snapshots=[];
for(const name of ['incorporation','corporate-changes'])for(const [revision,suffix]of [['43e2b9765cb8174fcd154b94c268c5b73e587373^','before-43e2b97'],[base,'baseline']]){
  const path=`src/routes/${name}.tsx`,bytes=git('show',`${revision}:${path}`),filename=`${name}-${suffix}.tsx.snapshot`;
  writeFileSync(join(folder,filename),bytes,{flag:'wx'});versions.snapshots.push({revision,path,filename,bytes:bytes.length,sha256:hash(bytes)});
}
assert(git('merge-base','--is-ancestor','43e2b9765cb8174fcd154b94c268c5b73e587373',base).length===0);
writeFileSync(join(folder,'baseline.json'),JSON.stringify(versions,null,2)+'\n',{flag:'wx'});
const audit=resolve(folder,'..'),prior=[];
for(const name of readdirSync(audit).filter(n=>n.startsWith('cosec-')&&n!=='cosec-20261024-routes-e4b761c9')){
  const path=join(audit,name,'evidence-manifest.json');if(!existsSync(path))continue;
  const manifest=JSON.parse(readFileSync(path,'utf8'));
  for(const row of manifest.files){const bytes=readFileSync(join(audit,name,row.path));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}
  prior.push({run_id:name,manifest_sha256:hash(readFileSync(path)),verified_files:manifest.files.length});
}
assert.equal(prior.length,9);assert.equal(prior.reduce((n,r)=>n+r.verified_files,0),1527);
writeFileSync(join(folder,'prior-evidence-integrity.json'),JSON.stringify({prior,total_files:1527,all_verified:true},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({snapshots:versions.snapshots.length,prior_runs:prior.length,prior_files:1527}));
