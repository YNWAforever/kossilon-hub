import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {digest,verifyBlobs} from '../cosec-20261024-handover-exec-a30e04f1/git-blob-verify.mjs';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),run='cosec-20261025-build-d29cd5ec',previous='../cosec-20261024-handover-exec-a30e04f1/',source='4d63818fe2562146f85e9a7b9917d8f0eb58f4c1',base='561f1ee2e761ab2d1b8ee1bff44533ea610d7614';
const read=n=>JSON.parse(readFileSync(join(folder,n),'utf8').replace(/^\uFEFF/,'')),save=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim();
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n),s=lstatSync(p);assert(!s.isSymbolicLink(),'Do not follow artifact/evidence symlinks');return s.isDirectory()?walk(p):[p];});
assert.equal(process.cwd(),root);
const baseline=read('baseline.json');
function prior(){let count=0;for(const r of baseline.prior){const path=join(folder,'..',r.run_id,r.manifest_file);assert.equal(digest(readFileSync(path)),r.manifest_sha256);for(const f of JSON.parse(readFileSync(path,'utf8')).files){const b=readFileSync(resolve(path,'..',f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);count++;}}assert.equal(count,2843);assert.equal(baseline.prior.length,21);assert.equal(digest(readFileSync(join(folder,previous,'acceptance-results.csv'))),baseline.original_csv_sha256);return count;}
function sameSource(){assert.equal(baseline.source_files.length,674);for(const f of baseline.source_files){const b=readFileSync(join(root,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);}verifyBlobs(root,source,baseline.source_files);verifyBlobs(root,base,baseline.source_files);assert.equal(git('diff','--name-only'),'');return 674;}
function actualBuild(){const r=read('build.json'),g=read('resource-gate.json');assert.equal(r.head,base);assert.equal(r.source_sha,source);assert.equal(r.exit_code,0);assert.equal(r.error,null);assert.equal(g.minimum_gib,3);assert.equal(g.allowed,true);assert(g.free_bytes>=3*2**30);assert.equal(r.deployed,false);return r;}
const mode=process.argv[2];
if(mode==='prepare'){
 assert.equal(git('rev-parse','HEAD'),base);const b=actualBuild();sameSource();prior();
 save('source-post-build.json',{head:base,source_sha:source,source_files_verified:674,files:baseline.source_files,product_changes_after_build:false});
 const out=join(root,'.output'),paths=walk(out);assert(paths.length>0&&paths.length<=10000);
 const files=paths.sort().map(p=>{assert(realpathSync(p).startsWith(realpathSync(out)+'\\'));const bytes=readFileSync(p);return{path:relative(root,p).replaceAll('\\','/'),bytes:bytes.length,sha256:digest(bytes)};});
 for(const p of ['.output/nitro.json','.output/server/wrangler.json'])assert(files.some(f=>f.path===p));
 assert(files.some(f=>f.path.startsWith('.output/server/')&&/\.(mjs|js)$/.test(f.path)));
 save('artifact-manifest.json',{run_id:run,source_sha:source,head:base,build_receipt:'build.json',purpose:'Local output inventory only; not deployed or runtime accepted',file_count:files.length,total_bytes:files.reduce((n,f)=>n+f.bytes,0),files});
 const inherited=read(previous+'check-summary.json'),checks={};
 for(const k of ['unit','sql','typecheck','lint']){const c=inherited.checks[k];assert(c.result.startsWith('PASS'));checks[k]={...c,execution:'INHERITED_SAME_SOURCE_NOT_RERUN_THIS_RUN',evidence_run:'cosec-20261024-handover-exec-a30e04f1'};for(const f of ['receipt','log','journey'])if(checks[k][f])checks[k][f]=previous+checks[k][f];}
 checks.build={result:'PASS',execution:'EXECUTED_THIS_RUN',receipt:'build.json',log:'build.txt',duration_ms:Date.parse(b.finished)-Date.parse(b.started)};
 save('check-summary.json',{run_id:run,source_sha:source,checks,all_required_local_checks_have_same_source_evidence:true,this_run_executed:['build'],not_run_this_run:['unit','SQL','typecheck','lint','CI','native Auth/HTTP/RLS/browser/provider'],native_pass:0,release_gate:'NO_GO'});
 save('source-candidate.json',{source_sha:source,source_parent_sha:'104af5c4875d2f10b595ec330fcb2e1d07e87201',evidence_base:base,source_files_verified:674,source_freeze:'source-post-build.json',product_changes_this_run:0,build:'PASS',artifact_manifest:'artifact-manifest.json'});
 save('release-candidate.json',{...read(previous+'release-candidate.json'),run_id:run,source_sha:source,evidence_base:base,phase:'UC186_SAME_SOURCE_BUILD_GATE_COMPLETED',required_local_checks:'PASS_WITH_EXPLICIT_INHERITED_EVIDENCE',checks,remaining_local:[],release_gate:'NO_GO',original_uc186:'PARTIAL_SCOPED',native_plan:previous+'NATIVE-PLAN.md',coverage:'COVERAGE.md',blockers:'blockers.md',isolated_runtime:{executed_this_run:false,db_clients_created:0,resources_created:0,inherited:previous+'owned-inventory.json'},artifact_manifest:'artifact-manifest.json',evidence_manifest:'evidence-manifest.json'});
 console.log(JSON.stringify({build:'PASS',source_files:674,prior_files:2843,artifact_files:files.length,artifact_bytes:files.reduce((n,f)=>n+f.bytes,0)}));
}else if(mode==='manifest'){
 save('evidence-manifest.json',{run_id:run,files:walk(folder).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(relative(folder,p))).sort().map(p=>{const b=readFileSync(p);return{path:relative(folder,p).replaceAll('\\','/'),bytes:b.length,sha256:digest(b)}})});
}else if(mode==='verify'){
 assert.equal(git('rev-parse','HEAD'),base);actualBuild();sameSource();const count=prior();assert.deepEqual(read('process-inspection.json').matching_processes,[]);
 const matrix=read('acceptance-verification.json');assert.equal(matrix.original_rows,184);assert.equal(matrix.native_pass,0);assert.equal(matrix.local_appended_only,'UC186');
 const artifacts=read('artifact-manifest.json');for(const f of artifacts.files){const bytes=readFileSync(join(root,f.path));assert.equal(bytes.length,f.bytes);assert.equal(digest(bytes),f.sha256);}
 const m=read('evidence-manifest.json');for(const f of m.files){const b=readFileSync(join(folder,f.path));assert.equal(b.length,f.bytes);assert.equal(digest(b),f.sha256);}
 assert.deepEqual(m.files.map(f=>f.path).sort(),walk(folder).map(p=>relative(folder,p).replaceAll('\\','/')).filter(p=>!['evidence-manifest.json','verification-report.json'].includes(p)).sort());
 save('verification-report.json',{source_sha:source,evidence_base:base,source_git_blobs:674,prior_runs:21,prior_manifested_files:count,current_manifested_files:m.files.length,original_rows:184,native_pass:0,build:'PASS',product_changes:0,artifact_files:artifacts.file_count,artifact_bytes:artifacts.total_bytes,release_gate:'NO_GO',push_merge_deploy:false});console.log('Verified same source, previous evidence,184 originals, local artifacts and native NO_GO.');
}else if(mode==='git'){
 const head=git('rev-parse','HEAD');assert.equal(git('rev-parse','HEAD^'),base);verifyBlobs(root,head,walk(folder).map(p=>({path:relative(root,p).replaceAll('\\','/')})));verifyBlobs(root,head,baseline.source_files);assert.equal(git('status','--porcelain=v1'),'');console.log(JSON.stringify({delivery_sha:head,source_sha:source,build:'PASS',status:'clean',native_pass:0,release_gate:'NO_GO',push_merge_deploy:false}));
}else throw Error('Expected prepare/manifest/verify/git');
