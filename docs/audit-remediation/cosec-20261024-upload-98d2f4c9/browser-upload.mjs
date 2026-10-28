// UC150: real Edge + real Router + production Portal, with sessionStorage RPC transport.
// Parent must run this only after GO and the resource gate, through run-checks.mjs browser greenN.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,expect} from '@playwright/test';

const folder=import.meta.dirname,root=resolve(folder,'../../..'),attempt=process.argv[2];
assert.match(attempt??'',/^(setup|green|historical)[0-9]*$/);
assert.equal(realpathSync(process.cwd()),root);
assert.equal(root,'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
assert.equal(folder,join(root,'docs','audit-remediation','cosec-20261024-upload-98d2f4c9'));
const run='cosec-20261024-upload-98d2f4c9',historical=attempt.startsWith('historical');
const normalized=path=>path.replaceAll('\\','/'),digest=value=>createHash('sha256').update(value).digest('hex');
const sourcePaths=['src/routes/portal.tsx','src/features/documents/upload-resume.ts','src/features/documents/server-fns.ts','src/features/documents/repository.ts','src/features/annual-return/outstanding.ts'];
const overlays=historical?{[normalized(join(root,'src/routes/portal.tsx'))]:readFileSync(join(folder,'portal-before.tsx.snapshot'),'utf8')}:{};
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,digest(overlays[normalized(join(root,path))]??readFileSync(join(root,path)))]));
const harnessHashes=Object.fromEntries(['browser-upload.mjs','browser-entry.tsx.snapshot'].map(path=>[path,digest(readFileSync(join(folder,path)))]));
const cache=join(root,'.worktrees',`upload-98d2f4c9-browser-${attempt}`);
assert.equal(realpathSync(join(root,'.worktrees')),join(root,'.worktrees'));
assert(!existsSync(cache),'Cache already exists; use a fresh attempt');
for(const file of [`browser-target-${attempt}.json`,`browser-results-${attempt}.json`,`browser-checkpoints-${attempt}.jsonl`])assert(!existsSync(join(folder,file)),'Attempt already exists');
mkdirSync(cache);
const rpc={
  documents:`export const listDocumentPage=({data})=>window.__uc150.listDocuments(data);export const createDocumentUploadIntent=({data})=>window.__uc150.intent(data);export const finalizeDocumentUpload=({data})=>window.__uc150.finalize(data);export const downloadDocument=()=>{throw Error('Download outside UC150 browser scope')};`,
  annual:`export const getAnnualReturnCase=()=>{throw Error('Staff read outside UC150 client scope')};export const listAnnualReturnCasePage=()=>{throw Error('Staff list outside UC150 client scope')};`,
  portal:`export const getClientPortalCase=({data})=>window.__uc150.clientCase(data);export const listClientPortalCases=({data})=>window.__uc150.clientCases(data);`,
};
const resolutions=[];
const server=await createServer({
  configFile:false,envFile:false,envDir:false,root,cacheDir:join(cache,'vite'),
  plugins:[{
    name:'uc150-local-boundaries',enforce:'pre',
    resolveId(id,importer){
      if(id==='virtual:uc150')return '\0uc150-main.tsx';
      const from=normalized(importer??'');
      const resolved=normalized(id.startsWith('@/')?join(root,'src',id.slice(2)):id.startsWith('.')&&importer?resolve(dirname(importer),id):isAbsolute(id)?id:id).replace(/\.tsx?$/,'');
      for(const [suffix,name]of [['/features/documents/server-fns','documents'],['/features/annual-return/server-fns','annual'],['/features/annual-return/client-portal-server-fns','portal']]){
        if(resolved.endsWith(suffix)){resolutions.push({id,from,boundary:name});return '\0uc150-rpc-'+name}
      }
      if(/(?:server-fns|server\/db|neon-auth-server|\.server(?:\.|$))/.test(id))throw Error(`Unstubbed server boundary: ${id}`);
    },
    load(id){
      const path=normalized(id.split('?')[0]);if(path in overlays)return overlays[path];
      if(id==='\0uc150-main.tsx')return readFileSync(join(folder,'browser-entry.tsx.snapshot'),'utf8');
      for(const [name,code]of Object.entries(rpc))if(id===`\0uc150-rpc-${name}`)return code;
    },
    configureServer(s){s.middlewares.use((req,res,next)=>{
      if(req.url==='/__uc150_identity'){
        res.setHeader('content-type','application/json');res.end(JSON.stringify({run_id:run,root:normalized(root)}));return;
      }
      if(/^\/portal(\/|\?|$)/.test(req.url)){
        res.setHeader('content-type','text/html');res.setHeader('x-uc150-run',run);
        res.end('<!doctype html><html lang="zh-Hant"><title>UC150 local only</title><body><div id="app"></div><script type="module" src="/@id/__x00__uc150-main.tsx"></script></body></html>');return;
      }
      next();
    })},
  },react()],
  resolve:{alias:{'@':join(root,'src')}},
  server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{strict:true,allow:[root]}},
  optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','@tanstack/react-query','@tanstack/react-router','@radix-ui/react-slot','lucide-react','class-variance-authority','clsx','tailwind-merge','sonner','zod']},
  logLevel:'warn',
});
let browser,origin,outerError,outerFailure;
const results=[],blocked=[],pageErrors=[],consoleErrors=[],httpErrors=[];
const id='98d2f4c9-0150-4150-8150-000000000004',item='98d2f4c9-0150-4150-8150-000000000007';
const awaiting='我們已收到您提供的 1 份文件，現正覆核，您毋須再提交。';
function makePdf(size){
  // A blank one-page PDF with a padded legal content stream and exact xref offsets.
  const header='%PDF-1.4\n% UC150 local recovery payload only\n',objects=[
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n',
  ];
  const offsets=[0];let position=Buffer.byteLength(header);
  for(const object of objects){offsets.push(position);position+=Buffer.byteLength(object)}
  offsets.push(position);let streamLength=size-600;
  for(let tries=0;tries<8;tries++){
    const prefix=Buffer.from(header+objects.join('')+`4 0 obj\n<< /Length ${streamLength} >>\nstream\n`);
    const end='\nendstream\nendobj\n',xref=prefix.length+streamLength+Buffer.byteLength(end);
    const tail=Buffer.from(end+'xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const remaining=size-prefix.length-tail.length;
    if(remaining!==streamLength){streamLength=remaining;continue}
    assert(streamLength>=4);const stream=Buffer.alloc(streamLength,32);stream.write('q\nQ\n');
    const result=Buffer.concat([prefix,stream,tail]);assert.equal(result.length,size);assert.equal(result.subarray(xref,xref+4).toString(),'xref');return result;
  }
  throw Error('Cannot size the owned PDF fixture');
}
let body,small;
const selectFile=async(page,{bytes=small,lastModified=150,requirement=true}={})=>{
  if(requirement){
    await page.getByLabel('回應哪一項要求',{exact:true}).selectOption(item);
    await page.getByRole('combobox').filter({has:page.locator('option[value="signature"]')}).selectOption('signature');
  }
  // DataTransfer supplies an actual browser File and a controlled lastModified.
  // File bytes then pass through the unmodified Portal's arrayBuffer/SHA256/base64 code.
  await page.getByLabel('要上載的文件',{exact:true}).evaluate((input,{base64,lastModified})=>{
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),transfer=new DataTransfer();
    transfer.items.add(new File([bytes],'QA-resume.pdf',{type:'application/pdf',lastModified}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },{base64:bytes.toString('base64'),lastModified});
};
const saved=page=>page.evaluate(()=>structuredClone(window.__uc150.saved));
const reads=page=>page.evaluate(()=>structuredClone(window.__uc150.reads));
const journals=page=>page.evaluate(()=>structuredClone(window.__uc150.journals()));
const callCount=(rows,name)=>rows.filter(row=>row.name===name).length;
const ready=async page=>expect(page.getByRole('heading',{name:'QA UC150 Company',exact:true})).toBeVisible({timeout:30000});
const receipt=page=>expect(page.getByText('已收到，等待掃描',{exact:true})).toBeVisible();
const oneCommit=state=>{
  assert.equal(state.intents.length,1);assert.equal(state.documents.length,1);assert.equal(state.versions.length,1);assert.equal(state.commitCount,1);assert.equal(state.scanCalls,0);
  assert.equal(state.documents[0].uploadStatus,'quarantined');assert.equal(state.documents[0].reviewStatus,'pending');assert.equal(state.documents[0].scanVerdictSource,null);
  assert.equal(state.documents[0].reviewedVersionId,null);assert.equal(state.intents[0].documentId,state.documents[0].id);
  assert.equal(state.intents[0].currentVersionId,state.versions[0].id);assert.equal(state.linkedDocumentId,state.documents[0].id);assert.equal(state.checklistStatus,'Received');
};
const retryButton=page=>page.getByRole('button',{name:'重試',exact:true});
async function loseFinalization(page,bytes=small){
  await page.evaluate(()=>window.__uc150.loseFinalize());await selectFile(page,{bytes});
  await page.getByRole('button',{name:'安全上載',exact:true}).click();
  await expect(page.getByText('失敗：Response lost after document commit',{exact:true})).toBeVisible({timeout:15000});
  oneCommit(await saved(page));
}
try{
  await server.listen();const address=server.httpServer.address();assert.equal(address.address,'127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const preflight=await fetch(origin+'/__uc150_identity');assert(preflight.ok);assert.deepEqual(await preflight.json(),{run_id:run,root:normalized(root)});
  body=makePdf(10*1024*1024-1024);small=makePdf(1024);
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';assert(existsSync(edge));
  writeFileSync(join(folder,`browser-target-${attempt}.json`),JSON.stringify({
    run_id:run,root,origin,host:address.address,port:address.port,configFile:false,envFile:false,envDir:false,hmr:false,
    sourceHashes,harnessHashes,historical_overlay:historical?'71dd6d0 original Portal working bytes':null,fixture_ids:{case:id,item},
    transport:'Owned sessionStorage RPC stub; no native Auth/HTTP RPC/DB/storage/scanner',
    near_limit_pdf_bytes:body.length,near_limit_pdf_sha256:digest(body),resume_semantics:'Full-file resend and same logical request replay; no chunk/byte-offset resume',
    fixture_gate:'Both process and browser GET exact run/root identity before synthetic fixture initialization',
  },null,2)+'\n',{flag:'wx'});
  browser=await chromium.launch({executablePath:edge,headless:true});
  const test=async(name,path,heading,fn)=>{
    const context=await browser.newContext({serviceWorkers:'block'});let page,isReady=false;
    try{
      await context.route('**/*',route=>{
        const u=new URL(route.request().url());if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue();
        blocked.push({name,origin:u.origin});return route.abort();
      });
      page=await context.newPage();page.setDefaultTimeout(7000);
      page.on('pageerror',error=>pageErrors.push({name,error:error.message}));
      page.on('console',event=>{if(event.type()==='error')consoleErrors.push({name,error:event.text()})});
      page.on('response',response=>{if(response.status()>=400)httpErrors.push({name,url:response.url(),status:response.status()})});
      await page.goto(origin+path);await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible({timeout:30000});isReady=true;
      const evidence=await fn(page);results.push({name,status:'passed',evidence});
    }catch(error){
      results.push({name,status:isReady?'failed':'setup_failed',error:error.message,url:page?.url(),
        dom:await page?.locator('body').innerText().catch(()=>null),
        reads:await page?.evaluate(()=>window.__uc150?.reads).catch(()=>null),
        saved:await page?.evaluate(()=>window.__uc150?.saved).catch(()=>null),
        journals:await page?.evaluate(()=>window.__uc150?.journals()).catch(()=>null)});
      if(page)writeFileSync(join(folder,`browser-failure-${attempt}-${results.length}.snapshot`),await page.content().catch(()=>''),{flag:'wx'});
    }finally{
      await context.close();appendFileSync(join(folder,`browser-checkpoints-${attempt}.jsonl`),JSON.stringify(results.at(-1))+'\n');
    }
    if(results.at(-1).status==='setup_failed')throw Error('Harness setup failed; remaining cases not run');
  };

  await test('UC150 near-limit PDF finalize commit/response loss/retry/single saved document',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
    await loseFinalization(page,body);const before=await saved(page),beforeReads=await reads(page);
    assert.equal(before.versions[0].sizeBytes,body.length);assert.equal(before.versions[0].checksum,digest(body));
    await retryButton(page).click();await receipt(page);await expect(page.getByText(awaiting,{exact:true})).toBeVisible();
    const after=await saved(page),log=await reads(page);oneCommit(after);
    const requests=log.filter(row=>row.name==='createDocumentUploadIntent'),finals=log.filter(row=>row.name==='finalizeDocumentUpload');
    assert.equal(requests.length,2);assert.match(requests[0].data.uploadRequestId,/^[a-f0-9-]{36}$/);assert.equal(requests[0].data.uploadRequestId,requests[1].data.uploadRequestId);
    assert.equal(finals.length,2);assert.deepEqual(finals.map(row=>row.data.intentId),[after.intents[0].id,after.intents[0].id]);
    for(const row of finals){assert.equal(row.data.decoded_size_bytes,body.length);assert.equal(row.data.checksum,digest(body));assert.equal(row.data.body_base64_length,4*Math.ceil(body.length/3));assert(row.data.pdf_magic.startsWith('%PDF-1.4'))}
    assert.deepEqual(after.documents,before.documents);assert.deepEqual(after.versions,before.versions);
    assert(log.slice(beforeReads.length).some(row=>row.name==='getClientPortalCase'));assert(log.slice(beforeReads.length).some(row=>row.name==='listDocumentPage'));
    await expect(page.getByRole('button',{name:'下載',exact:true})).toHaveCount(0);
    const boot=await page.evaluate(()=>window.__uc150.bootId);await page.reload();await ready(page);
    await expect(page.getByText(awaiting,{exact:true})).toBeVisible();await expect(page.getByText('QA-resume.pdf',{exact:true})).toHaveCount(1);
    assert.notEqual(await page.evaluate(()=>window.__uc150.bootId),boot);assert.deepEqual((await saved(page)).documents,after.documents);
    return {actual_file_bytes:body.length,sha256:digest(body),intent_count:1,document_count:1,version_count:1,full_body_submissions:2,reads:log,document:after.documents[0],fresh_query_client_after_reload:true,scan_calls:0};
  });
  if(!historical){
    await test('UC150 create commit/response loss/retry preserves request identity',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await page.evaluate(()=>window.__uc150.loseCreate());await selectFile(page);await page.getByRole('button',{name:'安全上載',exact:true}).click();
      await expect(page.getByText('失敗：Response lost after intent commit',{exact:true})).toBeVisible();
      const failed=await saved(page);assert.equal(failed.intents.length,1);assert.equal(failed.documents.length,0);assert.equal(callCount(await reads(page),'finalizeDocumentUpload'),0);
      await retryButton(page).click();await receipt(page);await expect(page.getByText(awaiting,{exact:true})).toBeVisible();
      const after=await saved(page),log=await reads(page);oneCommit(after);const requests=log.filter(row=>row.name==='createDocumentUploadIntent');
      assert.equal(requests.length,2);assert.equal(requests[0].data.uploadRequestId,requests[1].data.uploadRequestId);assert.equal(callCount(log,'finalizeDocumentUpload'),1);
      return {lost_create_committed_intents:1,no_finalize_before_retry:true,final_state:after,reads:log};
    });
    await test('UC150 reload journal/reselect changed lastModified/Received requirement preserves original binding',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await loseFinalization(page);const first=(await saved(page)).intents[0],oldBoot=await page.evaluate(()=>window.__uc150.bootId);
      const journalBefore=await journals(page);assert.equal(Object.values(journalBefore).flat().length,1);
      await page.reload();await ready(page);assert.notEqual(await page.evaluate(()=>window.__uc150.bootId),oldBoot);
      await expect(page.getByText(awaiting,{exact:true})).toBeVisible();await expect(page.getByLabel('回應哪一項要求',{exact:true})).toHaveCount(0);
      await page.getByRole('button',{name:'繼續此上載',exact:true}).click();await selectFile(page,{lastModified:151,requirement:false});
      assert.equal(await page.getByLabel('要上載的文件',{exact:true}).evaluate(input=>input.files[0].lastModified),151);
      await page.getByRole('button',{name:'安全上載',exact:true}).click();await receipt(page);
      const after=await saved(page),log=await reads(page),requests=log.filter(row=>row.name==='createDocumentUploadIntent');oneCommit(after);
      assert.equal(requests.length,2);assert.equal(requests.at(-1).data.uploadRequestId,first.uploadRequestId);assert.equal(requests.at(-1).data.checklistItemId,item);assert.equal(requests.at(-1).data.category,'signature');
      assert.equal(Object.values(await journals(page)).flat()[0].phase,'received');
      await expect(page.getByRole('button',{name:'繼續此上載',exact:true})).toHaveCount(0);
      const boot=await page.evaluate(()=>window.__uc150.bootId);
      await page.getByRole('link',{name:'返回您的周年申報',exact:true}).click();await expect(page.getByRole('heading',{name:'您的周年申報',exact:true})).toBeVisible();
      await page.getByRole('link',{name:'開啟',exact:true}).click();await ready(page);await expect(page.getByText(awaiting,{exact:true})).toBeVisible();
      assert.equal(await page.evaluate(()=>window.__uc150.bootId),boot);assert.equal(callCount(await reads(page),'finalizeDocumentUpload'),2);
      return {fresh_query_client:true,old_lastModified:150,new_lastModified:151,original_binding_preserved:true,real_router_return_and_reopen:true,final_state:after,journal_metadata_only:await journals(page),reads:log};
    });
    await test('UC150 mismatched bytes refused before RPC; cancelling resume selection retains journal',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await loseFinalization(page);await page.reload();await ready(page);await page.getByRole('button',{name:'繼續此上載',exact:true}).click();
      const changed=Buffer.from(small);changed[changed.length-3]^=1;const before=await reads(page);
      await selectFile(page,{bytes:changed,lastModified:152,requirement:false});await page.getByRole('button',{name:'安全上載',exact:true}).click();
      await expect(page.getByText('失敗：檔案與先前的上載不符，請重新選取原檔。',{exact:true})).toBeVisible();
      const after=await reads(page);assert.equal(callCount(after,'createDocumentUploadIntent'),callCount(before,'createDocumentUploadIntent'));assert.equal(callCount(after,'finalizeDocumentUpload'),callCount(before,'finalizeDocumentUpload'));oneCommit(await saved(page));
      await page.getByRole('button',{name:'取消恢復選擇',exact:true}).click();await expect(page.getByRole('button',{name:'安全上載',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'繼續此上載',exact:true})).toBeVisible();const pending=Object.values(await journals(page)).flat();assert.equal(pending.length,1);assert.equal(pending[0].phase,'uncertain');
      return {same_name_same_size_different_hash:true,no_additional_upload_rpc:true,cancel_keeps_uncertain_identity:true,journal:pending,reads:after};
    });
    await test('UC150 same-tick duplicate submission holds one intent and one active transfer',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await page.evaluate(()=>window.__uc150.holdIntent=true);await selectFile(page);
      await page.getByRole('button',{name:'安全上載',exact:true}).evaluate(button=>{button.click();button.click()});
      await page.waitForFunction(()=>window.__uc150.pendingIntents.length===1);await expect(page.getByRole('button',{name:'上載中…',exact:true})).toBeDisabled();
      await expect(page.getByText('核對先前上載結果…',{exact:true})).toBeVisible();await expect(page.getByRole('progressbar')).toHaveCount(0);
      const held=await saved(page),heldReads=await reads(page);assert.equal(held.intents.length,1);assert.equal(held.documents.length,0);assert.equal(callCount(heldReads,'createDocumentUploadIntent'),1);assert.equal(callCount(heldReads,'finalizeDocumentUpload'),0);
      await page.evaluate(()=>window.__uc150.releaseIntents());await receipt(page);await expect(page.getByText(awaiting,{exact:true})).toBeVisible();
      const after=await saved(page),log=await reads(page);oneCommit(after);assert.equal(callCount(log,'createDocumentUploadIntent'),1);assert.equal(callCount(log,'finalizeDocumentUpload'),1);
      await expect(page.getByText('中斷後可重新選取原檔並核對先前結果。檔案會由頭重傳；返回不會撤回已送出的檔案。',{exact:true})).toBeVisible();
      return {one_held_request:true,truthful_stage_labels_only:true,full_file_resend_disclosed:true,final_state:after,reads:log};
    });
    await test('UC150 departure while intent held prevents late finalize; return resumes same identity',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await page.evaluate(()=>window.__uc150.holdIntent=true);await selectFile(page);await page.getByRole('button',{name:'安全上載',exact:true}).click();
      await page.waitForFunction(()=>window.__uc150.pendingIntents.length===1);const first=(await saved(page)).intents[0];
      await page.getByRole('link',{name:'返回您的周年申報',exact:true}).click();await expect(page.getByRole('heading',{name:'您的周年申報',exact:true})).toBeVisible();
      await page.evaluate(()=>window.__uc150.releaseIntents());
      // Two render turns let the held async continuation finish without a fixed sleep.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const left=await saved(page),leftReads=await reads(page);assert.equal(left.documents.length,0);assert.equal(callCount(leftReads,'finalizeDocumentUpload'),0);
      await page.getByRole('link',{name:'開啟',exact:true}).click();await ready(page);await page.getByRole('button',{name:'繼續此上載',exact:true}).click();
      await selectFile(page,{lastModified:153,requirement:false});await page.getByRole('button',{name:'安全上載',exact:true}).click();await receipt(page);
      const after=await saved(page),log=await reads(page);oneCommit(after);assert.equal(after.intents[0].uploadRequestId,first.uploadRequestId);assert.equal(callCount(log,'createDocumentUploadIntent'),2);assert.equal(callCount(log,'finalizeDocumentUpload'),1);
      return {late_response_no_finalize:true,journal_survives_route_departure:true,final_state:after,reads:log};
    });
    await test('UC150 actor B cannot see actor A unfinished journal; A can reopen it',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await page.evaluate(()=>window.__uc150.loseCreate());await selectFile(page);await page.getByRole('button',{name:'安全上載',exact:true}).click();
      await expect(page.getByText('失敗：Response lost after intent commit',{exact:true})).toBeVisible();const journalA=await journals(page),before=await reads(page);
      await page.goto(origin+`/portal?caseId=${id}&qaRole=ClientB`);await ready(page);
      await expect(page.getByRole('button',{name:'繼續此上載',exact:true})).toHaveCount(0);await expect(page.getByLabel('未完成上載',{exact:true})).toHaveCount(0);
      assert.deepEqual(await journals(page),journalA);const log=await reads(page);assert(!log.slice(before.length).some(row=>['createDocumentUploadIntent','finalizeDocumentUpload'].includes(row.name)));
      await page.goto(origin+`/portal?caseId=${id}`);await ready(page);await expect(page.getByRole('button',{name:'繼續此上載',exact:true})).toBeVisible();
      return {a_journal_preserved:true,b_pending_journal_hidden:true,reads:log,limitation:'Injected local actor and transport boundaries only; not native Auth/RLS or browser-storage isolation against hostile same-origin scripts'};
    });
    await test('UC150 local refusal and read errors are explicit; list retry refetches',`/portal?caseId=${id}&qaRole=Denied`,'找不到周年申報',async page=>{
      await expect(page.getByLabel('要上載的文件',{exact:true})).toHaveCount(0);assert.equal(callCount(await reads(page),'listDocumentPage'),0);
      await page.goto(origin+`/portal?caseId=${id}`);await ready(page);await page.evaluate(()=>window.__uc150.setMode('document-error'));await page.reload();await ready(page);
      await expect(page.getByText('無法載入文件。',{exact:true})).toBeVisible();
      await page.evaluate(()=>window.__uc150.setMode('list-error'));await page.goto(origin+'/portal');await expect(page.getByRole('alert')).toBeVisible();
      const count=callCount(await reads(page),'listClientPortalCases');await page.evaluate(()=>window.__uc150.setMode('normal'));await retryButton(page).click();
      await expect(page.getByRole('link',{name:'開啟',exact:true})).toBeVisible();assert.equal(callCount(await reads(page),'listClientPortalCases'),count+1);
      await page.getByRole('link',{name:'開啟',exact:true}).click();await ready(page);await expect(page.getByText('暫未有文件。',{exact:true})).toBeVisible();
      const log=await reads(page);assert.equal(callCount(log,'createDocumentUploadIntent'),0);assert.equal(callCount(log,'finalizeDocumentUpload'),0);
      return {refused_no_document_read:true,document_read_error_explicit:true,list_retry_reads:1,no_upload_writes:true,reads:log,limitation:'Local root actor/stub refusal; native permissions remain blocked'};
    });
    await test('UC150 empty states and cancelled file selection/return produce no upload requests',`/portal?caseId=${id}`,'QA UC150 Company',async page=>{
      await expect(page.getByText('暫未有文件。',{exact:true})).toBeVisible();await selectFile(page);await page.getByLabel('要上載的文件',{exact:true}).setInputFiles([]);
      await expect(page.getByRole('button',{name:'安全上載',exact:true})).toBeDisabled();
      await page.getByRole('link',{name:'返回您的周年申報',exact:true}).click();await expect(page.getByRole('heading',{name:'您的周年申報',exact:true})).toBeVisible();
      await page.goBack();await ready(page);await expect(page.getByRole('button',{name:'安全上載',exact:true})).toBeDisabled();
      await page.evaluate(()=>window.__uc150.setMode('empty'));await page.goto(origin+'/portal');
      await expect(page.getByText('貴公司暫未有周年申報記錄。申報到期前，您的公司秘書會與您聯絡。',{exact:true})).toBeVisible();
      const state=await saved(page),log=await reads(page);assert.equal(state.intents.length,0);assert.equal(state.documents.length,0);assert.deepEqual(await journals(page),{});
      assert.equal(callCount(log,'createDocumentUploadIntent'),0);assert.equal(callCount(log,'finalizeDocumentUpload'),0);
      return {empty_documents:true,empty_case_list:true,selection_cancelled:true,real_router_back:true,no_upload_requests:true,reads:log};
    });
  }
  assert.equal(new Set(resolutions.map(row=>row.boundary)).size,3);
  assert.deepEqual(Object.fromEntries(sourcePaths.map(path=>[path,digest(overlays[normalized(join(root,path))]??readFileSync(join(root,path)))])),sourceHashes,'Product source changed during browser execution');
  assert.deepEqual(Object.fromEntries(Object.keys(harnessHashes).map(path=>[path,digest(readFileSync(join(folder,path)))])),harnessHashes,'Harness changed during browser execution');
  assert.deepEqual(blocked,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(consoleErrors,[]);
}catch(error){outerError=error.message;outerFailure={name:error.name,message:error.message,stack:error.stack,cause:error.cause?{name:error.cause.name,message:error.cause.message,code:error.cause.code,address:error.cause.address,port:error.cause.port}:null};process.exitCode=1}
finally{
  const summary={run_id:run,attempt,origin,sourceHashes,harnessHashes,historical_overlay:historical,browser_version:browser?.version(),results,
    blocked_external_origins:blocked,page_errors:pageErrors,console_errors:consoleErrors,http_errors:httpErrors,resolutions,outer_error:outerError??null,outer_failure:outerFailure??null,
    native_auth_http_rpc_db_storage_scanner:false,scan_calls:0,byte_offset_or_chunk_resume:false,
    cleanup:'Own fresh browser contexts closed; own loopback server/browser closed; no DB/provider/shared resources',
    limitation:'SessionStorage transport deliberately models idempotent commit/replay. This verifies Portal request identity and UI readback; real repository/server behavior requires separate SQL/unit evidence.'};
  await browser?.close();await server.close();
  writeFileSync(join(folder,`browser-results-${attempt}.json`),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({attempt,passed:results.filter(row=>row.status==='passed').length,failed:results.filter(row=>row.status==='failed').length,setup_failed:results.filter(row=>row.status==='setup_failed').length,outerError}));
if(results.some(row=>row.status!=='passed')||outerError)process.exitCode=1;
