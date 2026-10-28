import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..');
assert.equal(realpathSync(root),process.cwd());
const json=p=>JSON.parse(readFileSync(join(folder,p),'utf8').replace(/^\uFEFF/,''));
const save=(p,v)=>writeFileSync(join(folder,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...a)=>execFileSync('git',a,{cwd:root});
const source=git('rev-parse','HEAD').toString().trim(),parent='1b8dffc256b934ed11864a07883c80d8de5f8749';
assert.notEqual(source,parent,'Commit tested source before preparation');
const freeze=json('source-freeze-final.json');
const files=freeze.files.map(f=>{assert.equal(hash(readFileSync(join(root,f.path))),f.sha256);assert.equal(hash(git('show',source+':'+f.path)),f.sha256);return {...f,git_blob_equal:true};});
const dbEquivalence=json('db-runtime-equivalence.json');
execFileSync(process.execPath,[join(folder,'verify-db-equivalence.mjs')],{cwd:root});
for(const f of json('db-source-freeze.json').files) assert.equal(hash(readFileSync(join(root,f.path))),f.path===dbEquivalence.path?dbEquivalence.after_sha256:f.sha256,'DB-tested bytes changed');
save('source-candidate.json',{source_sha:source,parent_sha:parent,paths:files.map(f=>f.path),files,tested_head:freeze.head});
save('git-blob-equivalence.json',{source_sha:source,parent_sha:parent,files});
writeFileSync(join(folder,'source.patch'),git('diff','--binary',parent,source));
const cases=[];
for(const file of readdirSync(join(folder,'db')).filter(f=>/^UC13[567]-.*-green\.jsonl$/.test(f)).sort()){
  const events=readFileSync(join(folder,'db',file),'utf8').trim().split('\n').map(JSON.parse);
  const phase=p=>events.filter(e=>e.phase===p),one=p=>{assert.equal(phase(p).length,1,p);return phase(p)[0];};
  const planned=one('planned-ids'),final=one('final-readback'),cleanup=one('cleanup');
  const n=final.companies.length;
  assert.equal(n,planned.scenario.startsWith('UC136-')?2:1);
  assert.equal(final.contacts.length,n);assert.equal(final.officers.length,n);assert.equal(final.timeline.length,n);
  assert(final.timeline.every(e=>e.event_type==='client_created'&&e.actor_id===planned.ids.users[0]&&e.case_id===null));
  assert(Object.values(cleanup.remaining).every(n=>n===0));
  if(planned.scenario.startsWith('UC136-race-')){
    const lock=one('lock-observed');assert.equal(lock.wait_type,'Lock');assert(lock.blockers.includes(lock.winnerPid));
    assert.equal(one('concurrent-refused').error.name,'ClientWriteError');
    const p=one('physical-sessions');assert.equal(new Set([p.observerPid,p.winnerPid,p.loserPid]).size,3);
  }
  if(planned.scenario==='UC137-certificate'){
    const normalized=one('normalized-readback');assert.equal(normalized.companies[0].cr_number,'F0012345');assert.equal(normalized.companies[0].br_number,'12345678-000');
    assert.equal(phase('normalized-duplicate-refused').length,2);assert(phase('normalized-duplicate-refused').every(e=>e.error.field==='brNumber'));
  }
  const refusals=events.filter(e=>/refused|denied|invalid-result/.test(e.phase));
  cases.push({scenario:planned.scenario,planned_ids:planned.ids,company_ids:final.companies.map(c=>c.id),final_companies:n,final_contacts:final.contacts.length,final_secretaries:final.officers.length,client_created_events:final.timeline.length,refusals:refusals.map(e=>({phase:e.phase,field:e.error?.field,issues:e.error?.issues,message:e.error?.message})),lock_observed:phase('lock-observed').length===1,normalized:phase('normalized-readback')[0]?.companies.map(c=>({cr_number:c.cr_number,br_number:c.br_number})),cleanup_zero:true,events:'db/'+file});
}
assert.equal(cases.length,10);
const reds=[];
for(const field of ['companyName','registeredOffice','companySecretary']){
  const path=`db/UC135-${field}-red.jsonl`,events=readFileSync(join(folder,path),'utf8').trim().split('\n').map(JSON.parse);
  const invalid=events.find(e=>e.phase==='invalid-readback');assert.equal(invalid.companies.length,1);assert.equal(invalid.contacts.length,1);assert.equal(invalid.officers.length,1);assert.equal(invalid.timeline.length,1);
  reds.push({scenario:'UC135-'+field,company_id:invalid.companies[0].id,invalid_field_value:invalid.companies[0][{companyName:'company_name',registeredOffice:'registered_office',companySecretary:'company_secretary'}[field]],events:path});
}
for(const attempt of ['red','green']){
  const logs=readdirSync(join(folder,'db')).filter(f=>f.startsWith('UC13')&&f.endsWith('-'+attempt+'.jsonl'));assert.equal(logs.length,10);
  for(const file of logs){const events=readFileSync(join(folder,'db',file),'utf8').trim().split('\n').map(JSON.parse);const cleanup=events.find(e=>e.phase==='cleanup');assert(cleanup&&Object.values(cleanup.remaining).every(n=>n===0));}
}
save('readback-summary.json',{run_id:'cosec-20261023-clients-d20c646a',sql_files:1,sql_pass:10,cases,product_red:{failed:3,passed:7,raw_invalid_commits:reds},all_twenty_fixture_cleanup_zero:true,native_auth:false,http:false,browser_reload:false,app_seed:false});
const prior=[];
for(const run of ['cosec-20261023-79d324f0','cosec-20261023-cont-d55d8d7e','cosec-20261023-xlsx-db68ab95','cosec-20261023-r22-fe4a5635','cosec-20261023-assignment-86b2aa9a','cosec-20261023-payment-21be5584']){
  const base=resolve(folder,'..',run),manifest=JSON.parse(readFileSync(join(base,'evidence-manifest.json'),'utf8').replace(/^\uFEFF/,''));
  for(const f of manifest.files) assert.equal(hash(readFileSync(join(base,f.path))),f.sha256.toLowerCase(),run+'/'+f.path);
  prior.push({run,entries:manifest.files.length,unchanged:true});
}
save('prior-evidence-integrity.json',prior);
save('intake.json',{repo:git('remote','get-url','origin').toString().trim(),root,branch:git('branch','--show-current').toString().trim(),initial_head:parent,initial_dirty:false,main_sha:'1c57a67213af72bff8d776694e6ed8c986b921db',main_verified_read_only:true,production_supplied_historical_sha:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',production_accessed:false,worktrees:git('worktree','list','--porcelain').toString(),discovery:'Known local files; prior private-code graph-index approval rejection retained; no upload/retry',authorization:'Local changes and verified disposable resources only; no push/merge/deploy/production/providers'});
const checks=Object.fromEntries(['unit','typecheck','lint','build'].map(k=>{const stem=k+(['typecheck','lint'].includes(k)?'-verified':'-final');const r=json(stem+'.json');assert.equal(r.exit_code,0);return [k,{receipt:stem+'.json',log:stem+'.txt',exit_code:0}];}));
save('release-candidate.json',{run_id:'cosec-20261023-clients-d20c646a',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:'codex/cosec-20261023',source_sha:source,parent_sha:parent,main_sha:'1c57a67213af72bff8d776694e6ed8c986b921db',phase:'LOCAL_UC135_137_VERIFIED_NATIVE_BLOCKED',release_gate:'NO_GO',auth_runtime_verified:false,deployed:false,source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks:{...checks,sql:{files:1,passed:10,receipt:'db/db-clients-green.json',log:'db/db-clients-green.txt',summary:'readback-summary.json'},browser:'NOT_RUN',native:'BLOCKED'},rollback:{action:'ordinary new commit reverting this source commit if needed; retain evidence/history',production_action:false}});
console.log(`Prepared ${cases.length} SQL cases and three original invalid-commit receipts; ${prior.length} prior evidence sets unchanged.`);
