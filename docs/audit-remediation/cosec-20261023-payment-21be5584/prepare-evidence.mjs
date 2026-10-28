import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const folder=import.meta.dirname, root=resolve(folder,'../../..');
assert.equal(realpathSync(root),process.cwd());
const json=(path)=>JSON.parse(readFileSync(join(folder,path),'utf8').replace(/^\uFEFF/,''));
const save=(path,value)=>writeFileSync(join(folder,path),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root});
const sha=git('rev-parse','HEAD').toString().trim();
assert.equal(sha,'3f2eeb3a4eb4ccb05535f19ac2136a2bafc6a093');
const parent='a6d5d89d0bf9c020ec9b98e0eed8749e13de5b24';
const freeze=json('accepted-source-freeze.json');
const equivalence=freeze.files.map(file=>{
  assert.equal(hash(readFileSync(join(root,file.path))),file.sha256);
  assert.equal(hash(git('show',sha+':'+file.path)),file.sha256);
  return {...file,git_blob_equal:true};
});
save('git-blob-equivalence.json',{source_sha:sha,parent_sha:parent,files:equivalence});
save('source-candidate.json',{source_sha:sha,parent_sha:parent,paths:freeze.files.map(f=>f.path),files:equivalence,tested_head:freeze.head,scope:'test and serialized DB registry only; application code unchanged'});
writeFileSync(join(folder,'source.patch'),git('diff','--binary',parent,sha));
const summaries=[];
for(const file of readdirSync(join(folder,'db')).filter(f=>/^UC155-.*-accepted\.jsonl$/.test(f)).sort()){
  const events=readFileSync(join(folder,'db',file),'utf8').trim().split('\n').map(JSON.parse);
  const phase=(p)=>events.filter(e=>e.phase===p), one=(p)=>{assert.equal(phase(p).length,1);return phase(p)[0];};
  const ids=one('planned-ids').ids, commands=one('same-version-commands'), lock=one('lock-observed');
  assert.equal(commands.winner.expectedVersion,commands.loser.expectedVersion);
  assert.equal(commands.winner.proofVersionId,commands.loser.proofVersionId);
  assert.notEqual(commands.winner.decision,commands.loser.decision);
  assert(lock.blockers.includes(lock.firstPid)); assert.equal(lock.wait_type,'Lock');
  const conflict=one('concurrent-result').error;
  assert.equal(conflict.status,409); assert.equal(conflict.body.code,'version_conflict');
  const before=one('before'), after=one('winner-readback'), retry=one('retry-readback');
  for(const field of ['payment','sourceVersion','entries','audits','timeline','document','storedPayment','storedDocument','outbox']) assert.deepEqual(after[field],retry[field]);
  assert.equal(after.payment.amount,1800); assert.equal(Number(after.storedPayment.amount),1800);
  assert.equal(after.payment.balance,1800-after.payment.receivedAmount);
  const review=after.audits.filter(e=>e.metadata.command==='review'&&e.metadata.proofVersionId===commands.winner.proofVersionId);
  assert.equal(review.length,1); assert.equal(review[0].actor_id,commands.winnerActorId);
  const auditIds=new Set(before.audits.map(e=>e.id));
  const delta=after.audits.filter(e=>!auditIds.has(e.id));
  assert.equal(delta.length,2); assert(delta.every(e=>e.actor_id===commands.winnerActorId));
  assert.equal(phase('stale-replay').length,2);assert.equal(phase('fresh-terminal-retry').length,2);
  for(const event of [...phase('stale-replay'),...phase('fresh-terminal-retry')]){assert.equal(event.error.status,409);assert.equal(event.error.body.code,'version_conflict');}
  assert.equal(after.outbox,0);
  assert(Object.values(one('cleanup').remaining).every(n=>n===0));
  summaries.push({scenario:after.scenario,case_id:ids.case,payment_id:ids.payment,proof_version_id:commands.winner.proofVersionId,source_version:commands.winner.expectedVersion,winner:commands.winner.decision,winner_actor_id:commands.winnerActorId,loser_actor_id:commands.loserActorId,conflict,invoice:1800,received:after.payment.receivedAmount,balance:after.payment.balance,status:after.payment.status,paid_at:after.payment.paidAt,proof_document_id:after.payment.paymentProofDocumentId,review_audit_count:1,new_payment_audit_count:delta.length,stale_retries:2,fresh_terminal_retries:2,retry_invariant:true,cleanup_zero:true,events:'db/'+file});
}
assert.equal(summaries.length,6);
save('readback-summary.json',{run_id:'cosec-20261023-payment-21be5584',cases:summaries,sql_files:1,sql_pass:6,native_auth:false,http:false,browser_reload:false,scanner:'local contract stub only'});
const attempts=[['initial','fixture missing staff_profiles'],['profiles','six passed; before raw-row assertions'],['final','new readback query used DTO column names'],['verified','new readback asserted numeric text formatting instead of numerical value and unchanged raw value'],['accepted','six passed; final exact bytes']];
save('attempts.json',attempts.map(([attempt,classification])=>({attempt,classification,exit_code:json('db/db-payment-'+attempt+'.json').exit_code,events:readdirSync(join(folder,'db')).filter(f=>f.endsWith('-'+attempt+'.jsonl')).map(f=>'db/'+f)})));
const prior=[];
for(const run of ['cosec-20261023-79d324f0','cosec-20261023-cont-d55d8d7e','cosec-20261023-xlsx-db68ab95','cosec-20261023-r22-fe4a5635','cosec-20261023-assignment-86b2aa9a']){
  const base=resolve(folder,'..',run), manifest=JSON.parse(readFileSync(join(base,'evidence-manifest.json'),'utf8').replace(/^\uFEFF/,''));
  for(const file of manifest.files) assert.equal(hash(readFileSync(join(base,file.path))),file.sha256.toLowerCase(),run+'/'+file.path);
  prior.push({run,entries:manifest.files.length,unchanged:true});
}
save('prior-evidence-integrity.json',prior);
save('intake.json',{run_id:'cosec-20261023-payment-21be5584',repo:git('remote','get-url','origin').toString().trim(),root,branch:git('branch','--show-current').toString().trim(),parent_sha:parent,initial_dirty:false,main_sha:'1c57a67213af72bff8d776694e6ed8c986b921db',main_verified_read_only:true,production_supplied_historical_sha:'aa5d3cbddd895bca953b6eef7266ae1cc0b46215',production_accessed:false,worktrees:git('worktree','list','--porcelain').toString(),discovery:'Known local sources; graph indexing previously rejected by automatic approval review for private-code disclosure; no retry or upload this run.',input_plan:resolve(root,'../cosec-input-20261023-79d324f0/Development_Plan.md'),authorization:'local changes + exact verified disposable resources; no push/merge/deploy or production actions'});
save('release-candidate.json',{run_id:'cosec-20261023-payment-21be5584',repo:'https://github.com/YNWAforever/kossilon-hub.git',root,branch:'codex/cosec-20261023',source_sha:sha,parent_sha:parent,main_sha:'1c57a67213af72bff8d776694e6ed8c986b921db',phase:'LOCAL_UC155_VERIFIED_NATIVE_BLOCKED',release_gate:'NO_GO',auth_runtime_verified:false,deployed:false,source_manifest:'source-candidate.json',evidence_manifest:'evidence-manifest.json',checks:{unit_component:{files:5,pass:76,log:'targeted-accepted.txt',receipt:'targeted-accepted.json'},sql:{files:1,pass:6,log:'db/db-payment-accepted.txt',receipt:'db/db-payment-accepted.json'},typecheck:'typecheck-accepted.json',lint:{receipt:'lint-accepted.json',errors:0,warnings:1},full_unit:{status:'NOT_RUN_THIS_BATCH',historical_result:'2497 in previous assignment run; not recast as current'},build:{status:'NOT_RUN_THIS_BATCH',reason:'Only a DB test and test registry changed; application/build/config/dependencies unchanged'},browser:'NOT_RUN',native:'BLOCKED'},rollback:{action:'ordinary new commit reverting this test-only source commit if needed; preserve history/evidence',production_action:false}});
console.log(`Prepared ${summaries.length} UC155 summaries; preserved ${prior.length} prior evidence sets.`);
