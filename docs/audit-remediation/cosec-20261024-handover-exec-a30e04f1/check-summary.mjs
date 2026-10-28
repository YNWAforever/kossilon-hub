import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const folder=import.meta.dirname,read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,''));
const checks={};
for(const kind of ['unit','typecheck','lint','build']){
 const stem=kind==='unit'?'unit-final':existsSync(join(folder,kind+'-accepted.json'))?kind+'-accepted':kind+'-final';
 if(existsSync(join(folder,stem+'.json'))){const r=read(stem+'.json');assert.equal(r.exit_code,0,stem);assert.equal(r.error,null,stem);checks[kind]={result:'PASS',receipt:stem+'.json',log:stem+'.txt'};}
 else {
  const gates=readFileSync(join(folder,'resource-checks.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(r=>r.stage.startsWith(kind+'-'));
  const gate=gates.at(-1);assert(gate && !gate.allowed && !gate.started,kind+' missing result must have actual resource refusal');checks[kind]={result:'NOT_RUN_RESOURCE',receipt:'resource-checks.jsonl',stage:gate.stage,free_bytes:gate.free_bytes,minimum_gib:gate.minimum_gib};
 }
}
const t=readFileSync(join(folder,'unit-final.txt'),'utf8');assert.match(t,/Tests\s+2780 passed/);assert.match(t,/Test Files\s+288 passed/);checks.unit.tests=2780;checks.unit.files=288;
const records=readFileSync(join(folder,'db/test-green-r4.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert.equal(records.find(r=>r.phase==='test-result').exitCode,0);
checks.sql={result:'PASS_LOCAL_INJECTED_SESSION_SUPERUSER',tests:1,files:1,log:'db/test-green-r4.txt',journey:'db/UC186-green-r4.jsonl'};
const summary={run_id:'cosec-20261024-handover-exec-a30e04f1',checks,all_required_local_checks_passed:Object.values(checks).every(c=>c.result.startsWith('PASS')),native_pass:0,release_gate:'NO_GO',historical_tests_not_reused:true};
writeFileSync(join(folder,'check-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
