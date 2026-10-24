import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {digest,verifyBlobs} from '../cosec-20261024-handover-exec-a30e04f1/git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),base='531887acce5468f7321a3a2919a7afaa20dedac1',source='4d63818fe2562146f85e9a7b9917d8f0eb58f4c1';
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,'')),save=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'}),git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim();
const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n),s=lstatSync(p);assert(!s.isSymbolicLink());return s.isDirectory()?walk(p):[p]});
assert.equal(process.cwd(),root);const baseline=read('baseline.json');assert.equal(baseline.base,base);assert.equal(baseline.source_sha,source);
function prior(){let count=0;for(const r of baseline.prior){const p=join(folder,'..',r.run_id,r.manifest_file);assert.equal(digest(readFileSync(p)),r.manifest_sha256);for(const f of JSON.parse(readFileSync(p,'utf8')).files){const b=readFileSync(resolve(p,'..',f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);count++;}}assert.equal(count,2862);assert.equal(baseline.prior.length,22);for(const r of baseline.references)assert.equal(digest(readFileSync(join(folder,r.path))),r.sha256);return count;}
function checks(){
 const p=read('approval-request.json');assert.equal(p.execution_enabled,false);assert.deepEqual(p.approved_packet_ids,[]);assert.equal(p.approved_by,null);assert.equal(p.approved_at_hkt,null);assert.equal(p.expires_at_hkt,null);assert.equal(p.source_sha,source);assert.equal(p.evidence_base,base);assert.equal(p.release_gate,'NO_GO');assert(Object.values(p.bindings).every(v=>v===null));
 assert.equal(p.packets.length,13);assert.deepEqual(p.packets.map(x=>x.id),Array.from({length:13},(_,i)=>'AP-'+String(i).padStart(2,'0')));
 const visiting=new Set(),done=new Set(),visit=id=>{assert(!visiting.has(id),'Dependency cycle');if(done.has(id))return;const packet=p.packets.find(x=>x.id===id);assert(packet);assert.equal(packet.actual_actions,0);assert(packet.status.endsWith('NOT_APPROVED'));visiting.add(id);for(const d of packet.depends_on)visit(d);visiting.delete(id);done.add(id);};for(const q of p.packets)visit(q.id);
 assert.equal(p.common_limits.core_business_read_requests_total,200);assert.equal(p.common_limits.core_business_command_attempts_total,50);assert.equal(Object.values(p.core_command_reservations).reduce((n,x)=>n+x,0),50);assert.equal(p.common_limits.simultaneous_browser_contexts,2);assert.equal(p.common_limits.core_upload_put_attempts_total,4);assert.equal(p.common_limits.core_file_count,4);
 const provider=p.packets.find(q=>q.id==='AP-09');assert.equal(provider.approved_provider_calls,0);assert.equal(provider.approved_spend,0);assert.equal(provider.proposed_cost_ceiling_amount,null);
 const perf=p.packets.find(q=>q.id==='AP-10').proposed_additional_limit;assert.equal(perf.views*(perf.cold_navigations_per_view+perf.warm_navigations_per_view),perf.total_navigations);assert.equal(perf.total_navigations,360);
 const a=read('coverage-assessment.json');assert.equal(a.original_rows,184);assert.equal(a.mapped_uc_rows,100);assert.equal(a.native_pass,0);assert.equal(a.independent_local_core_gap_identified,false);assert.deepEqual(a.not_run_ids,['UC134']);assert.deepEqual(a.source_only_ids,['F01','F02','F21','F25','UC188','LA27','LA28']);
 const d=read('document-check.json');assert.equal(d.original_rows,184);assert.equal(d.mapped_uc,100);assert.equal(d.original_bytes_unchanged,true);assert.equal(d.original_oracles_and_relations_unchanged,true);assert.equal(d.native_pass,0);assert.equal(d.product_tests_executed,0);assert.equal(d.native_actions_executed,0);
 assert.equal(digest(readFileSync(join(folder,'acceptance-results.csv'))),baseline.original_csv_sha256);assert.equal(read('release-candidate.json').native_matrix.PASS,0);assert.equal(read('release-candidate.json').release_gate,'NO_GO');assert.equal(read('release-candidate.json').product_changes,0);
 verifyBlobs(root,source,baseline.source_files);verifyBlobs(root,base,baseline.source_files);assert.equal(baseline.source_files.length,674);assert.equal(git('diff','--name-only'),'');
 const artifacts=JSON.parse(readFileSync(join(folder,baseline.local_artifact.manifest),'utf8'));assert.equal(digest(readFileSync(join(folder,baseline.local_artifact.manifest))),baseline.local_artifact.manifest_sha256);assert.equal(artifacts.file_count,433);for(const f of artifacts.files){const b=readFileSync(join(root,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);}
 return{source_git_blobs:674,artifact_files:433,original_rows:184,mapped_UCs:100,packets:13,approved_packets:0,native_pass:0};
}
const mode=process.argv[2];
if(mode==='manifest'){
 save('evidence-manifest.json',{run_id:baseline.run_id,files:walk(folder).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(relative(folder,p))).sort().map(p=>{const b=readFileSync(p);return{path:relative(folder,p).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
}else if(mode==='verify'){
 assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('diff','--cached','--name-only'),'');const result=checks(),old=prior(),manifest=read('evidence-manifest.json');
 for(const f of manifest.files){const b=readFileSync(join(folder,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);}
 assert.deepEqual(manifest.files.map(f=>f.path).sort(),walk(folder).map(p=>relative(folder,p).replaceAll('\\','/')).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(p)).sort());
 save('verification-report.json',{check:'LOCAL_DOCUMENT_SOURCE_AND_EVIDENCE_INTEGRITY_ONLY',source_sha:source,evidence_base:base,...result,prior_runs:22,prior_manifested_files:old,current_manifested_files:manifest.files.length,application_tests_executed:[],native_actions_executed:0,resources_created:0,external_accesses:0,release_gate:'NO_GO',push_merge_deploy:false});console.log(JSON.stringify({integrity:'PASS',...result,prior_files:old,application_tests:'NOT_RUN',native_actions:0}));
}else if(mode==='git'){
 const head=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);verifyBlobs(root,head,walk(folder).map(p=>({path:relative(root,p).replaceAll('\\','/')})));verifyBlobs(root,head,baseline.source_files);assert.equal(git('status','--porcelain=v1'),'');console.log(JSON.stringify({delivery_sha:head,source_sha:source,status:'clean',approved_packets:0,native_pass:0,release_gate:'NO_GO',push_merge_deploy:false}));
}else throw Error('Expected manifest/verify/git');
