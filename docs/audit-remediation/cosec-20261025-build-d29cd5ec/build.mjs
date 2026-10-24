import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {freemem,totalmem} from 'node:os';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='561f1ee2e761ab2d1b8ee1bff44533ea610d7614',source='4d63818fe2562146f85e9a7b9917d8f0eb58f4c1',run='cosec-20261025-build-d29cd5ec';
const git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim();
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),digest=b=>createHash('sha256').update(b).digest('hex');
const save=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
assert.equal(process.cwd(),root);assert.equal(root,'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('rev-parse','HEAD^'),source);assert.equal(git('branch','--show-current'),'codex/cosec-20261023');assert.equal(git('remote','get-url','origin'),'https://github.com/YNWAforever/kossilon-hub.git');
assert.equal(git('diff','--name-only'),'');assert.equal(git('diff','--cached','--name-only'),'');
for(const p of git('ls-files','--others','--exclude-standard').split(/\r?\n/).filter(Boolean))assert(p.startsWith('docs/audit-remediation/'+run+'/'),'Unowned change: '+p);
assert.deepEqual(readdirSync(root).filter(f=>f.startsWith('.env')&&f!=='.env.example'),[]);
const previous=join(folder,'../cosec-20261024-handover-exec-a30e04f1'),baseline=read(join(previous,'baseline.json'));
const old=[...baseline.prior,{run_id:'cosec-20261024-handover-exec-a30e04f1',manifest_file:'evidence-manifest.json',manifest_sha256:digest(readFileSync(join(previous,'evidence-manifest.json')))}];
let priorFiles=0;for(const r of old){const path=join(folder,'..',r.run_id,r.manifest_file);assert.equal(digest(readFileSync(path)),r.manifest_sha256);for(const f of read(path).files){const b=readFileSync(resolve(path,'..',f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);priorFiles++;}}
assert.equal(old.length,21);assert.equal(priorFiles,2843);
const frozen=read(join(previous,'source-post-checks.json'));assert.equal(frozen.files.length,674);
for(const f of frozen.files){const b=readFileSync(join(root,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);}
save('baseline.json',{run_id:run,root,head:base,source_sha:source,branch:git('branch','--show-current'),origin:git('remote','get-url','origin'),prior:old,prior_manifested_files:priorFiles,original_csv_sha256:digest(readFileSync(join(previous,'acceptance-results.csv'))),source_files:frozen.files,started_utc:new Date().toISOString(),initial_status:'Only new run documentation/helpers; product source unchanged'});
const keep=/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>keep.test(name)));
env.CI='true';env.NO_COLOR='1';env.NITRO_PRESET='cloudflare-module';env.VITE_ENABLE_DEMO_AUTH='false';env.WRANGLER_SEND_METRICS='false';
env.TEMP=join(root,'.worktrees',run);env.TMP=env.TEMP;mkdirSync(env.TEMP,{recursive:true});
const free=freemem(),allowed=free>=3*2**30;save('resource-gate.json',{checked_utc:new Date().toISOString(),free_bytes:free,total_bytes:totalmem(),minimum_gib:3,allowed,started:false,policy:'Original3GiB gate; no other process/resource stopped'});console.log(JSON.stringify({run_id:run,free_bytes:free,minimum_gib:3,allowed}));
if(!allowed){console.log('NOT_RUN_RESOURCE: no build launched');process.exitCode=3;}else{
 const started=new Date().toISOString(),command=['node_modules/vite/bin/vite.js','build'];
 const r=spawnSync(process.execPath,command,{cwd:root,env,encoding:'utf8',timeout:240000,maxBuffer:30*1024*1024,windowsHide:true});
 writeFileSync(join(folder,'build.txt'),(r.stdout??'')+(r.stderr??''),{flag:'wx'});
 save('build.json',{run_id:run,head:base,source_sha:source,started,finished:new Date().toISOString(),command:[process.execPath,...command],exit_code:r.status,signal:r.signal,error:r.error?.message??null,env_keys:Object.keys(env),native_auth:false,native_http:false,db_clients_created:0,deployed:false});
 console.log(JSON.stringify({exit_code:r.status,error:r.error?.message??null,log:'build.txt'}));process.exitCode=r.status??1;
}
