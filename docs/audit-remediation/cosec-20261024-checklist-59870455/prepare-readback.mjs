import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const folder=import.meta.dirname;
const read=path=>JSON.parse(readFileSync(join(folder,path),'utf8').replace(/^\uFEFF/,''));
const logical=rows=>rows.map(({updated_at,row_version,...row})=>row);
const cases=[];
for(const [attempt,directory] of [['green','db'],['final','db-final']]){
  assert.equal(read(`${directory}/db-checklist-${attempt}.json`).exit_code,0);
  const path=`${directory}/sidecar-UC159-SQL-${attempt}.jsonl`;
  const events=readFileSync(join(folder,path),'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const one=phase=>{const result=events.filter(e=>e.phase===phase);assert.equal(result.length,1,phase);return result[0]};
  const ids=one('planned-ids').ids,identity=one('sql-identity');
  assert.notEqual(identity.writerIdentity.pid,identity.observerIdentity.pid);
  assert.equal(identity.writerIdentity.database,identity.observerIdentity.database);
  const transitions=events.filter(e=>e.phase==='committed-transition'),retries=events.filter(e=>e.phase==='same-value-retry'),denials=events.filter(e=>e.phase==='refused-without-item-update');
  assert.equal(transitions.length,25);assert.equal(retries.length,25);assert.equal(denials.length,7);
  let previous=one('observer-baseline').rows;
  for(let index=0;index<25;index++){
    const t=transitions[index],r=retries[index];
    assert.equal(t.itemId,r.itemId);assert.equal(t.step,r.step);assert.equal(t.status,r.status);
    assert.deepEqual(logical(t.rows),logical(r.rows));
    assert.deepEqual(t.rows.filter(x=>x.id!==t.itemId),previous.filter(x=>x.id!==t.itemId));
    assert.equal(t.rows.find(x=>x.id===t.itemId).status,t.status);
    const target=t.rows.find(x=>x.id===t.itemId);
    assert.equal(target.received_at!==null,['Received','Verified'].includes(t.status));
    assert.equal(target.verified_at!==null,t.status==='Verified');
    previous=r.rows;
  }
  for(const id of ids.checklist)assert.deepEqual(transitions.filter(e=>e.itemId===id).map(e=>e.status),['Received','Verified','Rejected','Missing','Received']);
  for(const refusal of denials)assert.deepEqual(refusal.rows,previous);
  assert(one('assertions-complete').assertionsPassed);
  const cleanup=one('cleanup-readback');assert(cleanup.assertionsPassed);assert(Object.values(cleanup.remaining).every(n=>n===0));
  assert(!events.some(e=>['scenario-failed','cleanup-failed'].includes(e.phase)));
  const teardown=read(`${directory}/db-cleanup.json`);assert(teardown.container_absent_after&&teardown.credentials_removed);assert(Object.values(teardown.own_row_counts_before_removal).every(n=>n===0));
  const server=read(`${directory}/db-server-before-teardown.json`);assert(server.tcp_and_container_system_id_equal);
  cases.push({attempt,events:path,planned_ids:ids,sql_tests_passed:1,checklist_count:5,committed_transitions:25,same_value_retries:25,refusals:denials.map(e=>({name:e.name,repositoryCalls:e.repositoryCalls})),
    business_state_and_timestamps_equal_on_retry:true,write_metadata_on_retry:'updated_at and xmin are refreshed by existing SQL; no claim of zero duplicate SQL writes',
    rejected_requests_full_rows_unchanged:true,independent_sessions:identity,final_rows:previous,cleanup:cleanup.remaining,container_id:teardown.container_id,system_id:server.identity.system_id,
    native_auth_rls:false});
}
const flatten=value=>value&&typeof value==='object'?Object.values(value).flatMap(flatten):[value];
assert.deepEqual(flatten(cases[0].planned_ids).filter(id=>flatten(cases[1].planned_ids).includes(id)),[]);
assert.notEqual(cases[0].container_id,cases[1].container_id);assert.notEqual(cases[0].system_id,cases[1].system_id);
const red=read('browser-results-red5.json'),green=read('browser-results-green.json');
assert(red.results.every(t=>t.status==='failed'));assert(green.results.every(t=>t.status==='passed'));
assert.equal(red.results.length,3);assert.equal(green.results.length,3);
assert(red.results[1].error.includes('"disabled":true'));assert(red.results[1].error.includes('"focused":false'));
for(const browser of [red,green]){
  assert.deepEqual(browser.page_errors,[]);assert.deepEqual(browser.http_errors,[]);assert.deepEqual(browser.blocked_external_origins,[]);
  assert.equal(browser.native_auth_http_rls,false);assert(browser.rpc_stub_resolutions>0);
}
const journey=green.results[1].evidence;
assert.deepEqual(journey.reopened_values,Array(5).fill('Rejected'));assert.equal(journey.calls.length,5);assert(journey.reads_after>journey.reads_before);
assert(journey.pending.focused&&!journey.pending.disabled&&journey.pending.ariaDisabled==='true');
const retry=green.results[2].evidence;assert.equal(retry.rpc_calls,2);assert.equal(retry.saved_after_rejection,'Missing');assert.equal(retry.saved_after_retry,'Rejected');
for(const file of ['cleanup-final.json','cleanup-final-db-final.json']){
  const cleanup=read(file);assert(cleanup.container_absent&&cleanup.credentials_absent&&cleanup.preexisting_count>=313&&cleanup.preexisting_missing.length===0);
}
const summary={run_id:'cosec-20261024-checklist-59870455',cases,local_browser:{red:'browser-results-red5.json',green:'browser-results-green.json',red_failed:3,green_passed:3,version:green.browser_version,
  source_red_sha256:red.source_sha256,source_green_sha256:green.source_sha256,keyboard:true,five_saved_and_reopened:true,focus_retained_and_not_stolen:true,explicit_retry:true,rpc:'IN_MEMORY_STUB',native_auth_http_rls:false},
  earlier_browser_attempts:[{attempt:'red',classification:'SANDBOX_LOOPBACK_EACCES_NO_BROWSER'},{attempt:'red2',classification:'HARNESS_ROUTER_STUB_EXPORT_MISSING'},{attempt:'red3',classification:'HARNESS_NOT_READY_BLANK_DOM_NOT_PRODUCT_RESULT'},{attempt:'red4',classification:'MIXED_HARNESS_OPTIMIZE_DEP_504_AND_PENDING_RENDER_RACE_NOT_FINAL_BASELINE'}],
  preexisting_container_counts:{initial:read('cleanup-final.json').preexisting_count,final:read('cleanup-final-db-final.json').preexisting_count},native:'BLOCKED_NOT_RUN',release_gate:'NO_GO'};
if(process.argv.includes('--verify'))assert.deepEqual(read('readback-summary.json'),summary);
else writeFileSync(join(folder,'readback-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log('Verified two exact SQL targets, 25 transitions/25 retries/7 denials each, cleanup0, and Edge three-red/three-green local keyboard evidence.');
