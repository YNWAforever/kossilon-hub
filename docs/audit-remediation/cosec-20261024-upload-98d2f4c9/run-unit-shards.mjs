import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {digest} from './git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const json=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
assert.equal(json('unit-final.json').exit_code,0);
const filesFrom=log=>[...log.matchAll(/^\s*✓\s+\|unit\|\s+(\S+\.test\.tsx?)\s+\((\d+) tests?\)/gm)].map(r=>({path:r[1],tests:Number(r[2])}));
const inventory=filesFrom(readFileSync(join(folder,'unit-final.txt'),'utf8')).sort((a,b)=>a.path.localeCompare(b.path));
assert.equal(inventory.length,278);assert.equal(new Set(inventory.map(r=>r.path)).size,278);assert.equal(inventory.reduce((n,r)=>n+r.tests,0),2683);
const source=json('source-final-verified.json').files;
assert.deepEqual(source.map(r=>r.path),json('source-verified.json').files.map(r=>r.path));
function unchanged(){for(const row of source)assert.equal(digest(readFileSync(join(root,row.path))),row.sha256,row.path)}
unchanged();
assert(!existsSync(join(folder,'unit-verified.json'))&&!existsSync(join(folder,'unit-verified.txt')));
const groups=[];for(let i=0;i<inventory.length;i+=12)groups.push(inventory.slice(i,i+12).map(r=>r.path));
writeFileSync(join(folder,'unit-shard-inventory.json'),JSON.stringify({source_freeze:'source-final-verified.json',inventory_from:'unit-final.txt',inventory_files:278,baseline_tests:2683,current_expected_tests:2685,maximum_files_per_shard:12,shards:groups,reason:'Two unsharded launches refused at unchanged 3GiB gate. Serial bounded subsets use existing focused 1.5GiB budget; source paths unchanged.'},null,2)+'\n',{flag:'wx'});
const keep=/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>keep.test(k))),CI:'true',NO_COLOR:'1',TEMP:join(root,'.worktrees/upload-98d2f4c9-unit'),TMP:join(root,'.worktrees/upload-98d2f4c9-unit')};mkdirSync(env.TEMP,{recursive:true});
const started=new Date().toISOString(),results=[];let failed=false;
for(const [index,paths] of groups.entries()){
  const name='unit-shard-'+String(index+1).padStart(2,'0');
  const gate=spawnSync(process.execPath,[join(folder,'resource-gate.mjs'),name,'1.5'],{cwd:root,env,encoding:'utf8',windowsHide:true});
  if(gate.status!==0){failed=true;results.push({name,status:'resource_blocked',exit_code:gate.status});break}
  unchanged();
  const args=['node_modules/vitest/vitest.mjs','run','--project','unit',...paths,'--maxWorkers','1'];
  const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:30*1024*1024});
  const log=(result.stdout??'')+(result.stderr??'');writeFileSync(join(folder,name+'.txt'),log,{flag:'wx'});
  const observed=filesFrom(log);const receipt={name,command:[process.execPath,...args],files:paths,exit_code:result.status,error:result.error?.message??null,signal:result.signal,observed};
  writeFileSync(join(folder,name+'.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});results.push(receipt);
  if(result.status!==0){failed=true;break}
  assert.deepEqual(observed.map(r=>r.path).sort(),[...paths].sort());unchanged();
  console.log(JSON.stringify({shard:index+1,total_shards:groups.length,files:paths.length,passed:observed.reduce((n,r)=>n+r.tests,0)}));
}
const observed=results.flatMap(r=>r.observed??[]),tests=observed.reduce((n,r)=>n+r.tests,0);
if(!failed){assert.equal(observed.length,278);assert.equal(new Set(observed.map(r=>r.path)).size,278);assert.equal(tests,2685);unchanged()}
const receipt={kind:'unit',attempt:'verified',execution:'serial bounded subsets, complete unchanged unit inventory; not a single-process run',started,finished:new Date().toISOString(),exit_code:failed?1:0,error:failed?'See exact failed/resource-blocked shard':null,signal:null,env_keys:Object.keys(env),summary:{tests,files:observed.length,shards:results.length},inventory:'unit-shard-inventory.json',source_freeze:'source-final-verified.json',all_source_hashes_verified:!failed,shards:results.map(({name,exit_code,error,status})=>({name,exit_code,error,status}))};
writeFileSync(join(folder,'unit-verified.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const summary=failed?'INCOMPLETE - no full PASS claim':` Test Files 278 passed (278)\n      Tests 2685 passed (2685)`;
writeFileSync(join(folder,'unit-verified.txt'),'Aggregate of '+groups.length+' serial subsets; raw outputs in unit-shard-NN.txt.\n'+summary+'\n'+JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({execution:receipt.execution,exit_code:receipt.exit_code,summary:receipt.summary}));process.exitCode=receipt.exit_code;
