// Real browser/router/production screens; local stub transport only, no Auth/DB.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,expect} from '@playwright/test';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),attempt=process.argv[2];
assert.match(attempt??'',/^(historical|current|green)[0-9]*$/);
assert.equal(realpathSync(process.cwd()),root);
assert.equal(root,'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
const run='cosec-20261024-routes-e4b761c9',historical=attempt.startsWith('historical');
const digest=value=>createHash('sha256').update(value).digest('hex');
const normalized=path=>path.replaceAll('\\','/');
const sourcePaths=['src/routes/incorporation.tsx','src/routes/incorporation.$id.tsx','src/routes/corporate-changes.tsx','src/routes/corporate-changes.$id.tsx','src/features/incorporation/components/production-incorporation-list.tsx','src/features/incorporation/components/production-incorporation-detail.tsx','src/features/corporate-changes/components/production-corporate-change-list.tsx','src/features/corporate-changes/components/production-corporate-change-detail.tsx','src/test/case-route-fixtures.ts'];
const overlays=historical?Object.fromEntries(['incorporation','corporate-changes'].map(name=>[normalized(join(root,`src/routes/${name}.tsx`)),readFileSync(join(folder,`${name}-before-43e2b97.tsx.snapshot`),'utf8')])):{};
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,digest(overlays[normalized(join(root,path))]??readFileSync(join(root,path)))]));
const cache=join(root,'.worktrees',`routes-e4b761c9-browser-${attempt}`);
assert.equal(realpathSync(join(root,'.worktrees')),join(root,'.worktrees'));
assert(!existsSync(cache));mkdirSync(cache);
const rpc={inc:`export const listIncorporationCasePage=async()=>({items:Object.values(window.__uc160.saved.incorporation),nextCursor:null});export const getIncorporationCase=({data})=>window.__uc160.get('incorporation',data.id);export const completeIncorporationCase=()=>{throw Error('Out of UC160 scope')};export const updateIncorporationCaseStatus=completeIncorporationCase;export const updateIncorporationChecklistItem=completeIncorporationCase;`,
  changes:`export const listCorporateChangeRequestPage=async()=>({items:Object.values(window.__uc160.saved.changes).map(r=>({...r,companyName:'QA UC160 '+r.id.slice(-1)})),nextCursor:null});export const getCorporateChangeRequest=({data})=>window.__uc160.get('changes',data.requestId);export const completeCorporateChangeRequest=()=>{throw Error('Out of UC160 scope')};export const cancelCorporateChangeRequest=completeCorporateChangeRequest;export const updateCorporateChangeChecklistItemStatus=completeCorporateChangeRequest;`,
  clients:`export const listClientPage=async()=>({clients:[],nextCursor:null});export const listClientAssignmentOptions=async()=>({owners:[],teams:[]});`};
const resolutions=[];
const server=await createServer({configFile:false,envFile:false,envDir:false,root,cacheDir:join(cache,'vite'),plugins:[{
  name:'uc160-local-boundaries',enforce:'pre',
  resolveId(id,importer){
    if(id==='virtual:uc160')return '\0uc160-main.tsx';
    const from=normalized(importer??'');
    const resolved=normalized(id.replace(/^@\//,normalized(join(root,'src'))+'/')).replace(/\.tsx?$/,'');
    if(resolved.endsWith('/features/incorporation/server-fns')){resolutions.push({id,from});return '\0uc160-rpc-inc'}
    if(resolved.endsWith('/features/corporate-changes/server-fns')){resolutions.push({id,from});return '\0uc160-rpc-changes'}
    if(resolved.endsWith('/features/clients/server-fns')){resolutions.push({id,from});return '\0uc160-rpc-clients'}
    if(resolved.endsWith('/components/incorporation/create-incorporation-case-dialog'))return '\0uc160-inc-dialog';
    if(resolved.endsWith('/components/corporate-changes/create-corporate-change-request-dialog'))return '\0uc160-change-dialog';
    if(id==='../server-fns'&&from.includes('/features/incorporation/components/')){resolutions.push({id,from});return '\0uc160-rpc-inc'}
    if(id==='../server-fns'&&from.includes('/features/corporate-changes/components/')){resolutions.push({id,from});return '\0uc160-rpc-changes'}
    if(id==='@/features/clients/server-fns'){resolutions.push({id,from});return '\0uc160-rpc-clients'}
    if(id==='@/components/incorporation/create-incorporation-case-dialog')return '\0uc160-inc-dialog';
    if(id==='@/components/corporate-changes/create-corporate-change-request-dialog')return '\0uc160-change-dialog';
    if(/(?:server-fns|server\/db|neon-auth-server)/.test(id))throw Error(`Unstubbed server boundary: ${id}`);
  },
  load(id){const path=normalized(id.split('?')[0]);if(path in overlays)return overlays[path];if(id==='\0uc160-main.tsx')return readFileSync(join(folder,'browser-entry.tsx.snapshot'),'utf8');for(const [name,code]of Object.entries(rpc))if(id===`\0uc160-rpc-${name}`)return code;if(id==='\0uc160-inc-dialog')return 'export const CreateIncorporationCaseDialog=()=>null';if(id==='\0uc160-change-dialog')return 'export const CreateCorporateChangeRequestDialog=()=>null';},
  configureServer(s){s.middlewares.use((req,res,next)=>{
    if(req.url==='/__uc160_identity'){res.setHeader('content-type','application/json');res.end(JSON.stringify({run_id:run,root:normalized(root)}));return}
    if(/^\/(incorporation|corporate-changes)(\/|\?|$)/.test(req.url)){res.setHeader('content-type','text/html');res.setHeader('x-uc160-run',run);res.end('<!doctype html><html lang="zh-Hant"><title>UC160 local router</title><body><div id="app"></div><script type="module" src="/@id/__x00__uc160-main.tsx"></script></body></html>');return}next();
  })},
},react()],resolve:{alias:{'@':join(root,'src')}},server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{strict:true,allow:[root]}},optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','@tanstack/react-query','@tanstack/react-router','@radix-ui/react-slot','lucide-react','class-variance-authority','clsx','tailwind-merge','sonner','zod']},logLevel:'warn'});
let browser,origin;const results=[],blocked=[],pageErrors=[],consoleErrors=[],httpErrors=[];
let outerError;
try{
  await server.listen();const address=server.httpServer.address();assert.equal(address.address,'127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const preflight=await fetch(origin+'/incorporation');assert.equal(preflight.headers.get('x-uc160-run'),run);
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';assert(existsSync(edge));
  writeFileSync(join(folder,`browser-target-${attempt}.json`),JSON.stringify({run_id:run,root,origin,host:address.address,port:address.port,configFile:false,envFile:false,envDir:false,sourceHashes,historical_overlay:historical?'43e2b97^ exact parent route bytes':null,fixture_ids:['e4b761c9-0160-4160-8160-000000000001','e4b761c9-0160-4160-8160-000000000002'],transport:'in-memory RPC stub; no native server/DB/auth/provider'},null,2)+'\n',{flag:'wx'});
  browser=await chromium.launch({executablePath:edge,headless:true});
  const test=async(name,path,body)=>{
    const context=await browser.newContext({serviceWorkers:'block'});let page,ready=false;
    try{
      await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue();blocked.push(u.origin);return route.abort()});
      page=await context.newPage();page.setDefaultTimeout(7000);
      page.on('pageerror',e=>pageErrors.push({name,error:e.message}));page.on('console',e=>{if(e.type()==='error')consoleErrors.push({name,error:e.text()})});page.on('response',r=>{if(r.status()>=400)httpErrors.push({name,url:r.url(),status:r.status()})});
      await page.goto(origin+path);await expect(page.getByRole('form',{name:'案件篩選'})).toBeVisible({timeout:30000});ready=true;
      const evidence=await body(page);results.push({name,status:'passed',evidence});
    }catch(e){results.push({name,status:ready?'failed':'setup_failed',error:e.message,url:page?.url(),dom:await page?.locator('body').innerText().catch(()=>null),reads:await page?.evaluate(()=>window.__uc160?.reads).catch(()=>null)})}
    finally{await context.close();appendFileSync(join(folder,`browser-checkpoints-${attempt}.jsonl`),JSON.stringify(results.at(-1))+'\n')}
    if(results.at(-1).status==='setup_failed')throw Error('Harness setup failed; stop before remaining cases');
  };
  const id='e4b761c9-0160-4160-8160-000000000001',other='e4b761c9-0160-4160-8160-000000000002';
  for(const [path,domain]of [['/incorporation','incorporation'],['/corporate-changes','changes']]){
    const listUrl=`${path}?q=QA&sort=company&cursor=QA-page3`,detail=`${path}/${id}`;
    const open=page=>path==='/incorporation'?page.getByRole('link',{name:'開啟'}).first():page.getByRole('link',{name:'QA UC160 1'});
    const marker=path==='/incorporation'?'QA Office 1':'HKD 1,601';
    const show=async(page,text=marker)=>{await expect(page.getByText(text,{exact:true})).toBeVisible();await expect(page.getByRole('form',{name:'案件篩選'})).toHaveCount(0)};
    await test(`UC160 ${path} link -> detail -> Back -> Forward -> real reload`,listUrl,async page=>{
      await open(page).focus();await page.keyboard.press('Enter');await show(page);assert.equal(new URL(page.url()).pathname,detail);
      assert.equal(new URL(page.url()).searchParams.get('returnTo'),listUrl);
      await page.goBack();await expect(page.getByRole('form',{name:'案件篩選'})).toBeVisible();assert.equal(page.url(),origin+listUrl);
      await expect(page.getByLabel('搜尋既有案件')).toHaveValue('QA');await page.goForward();await show(page);
      const reads=await page.evaluate(()=>window.__uc160.reads.length);
      await page.evaluate(([domain,id])=>window.__uc160.bump(domain,id),[domain,id]);
      await page.reload();const fresh=domain==='incorporation'?'QA reload readback':'HKD 9,160';await show(page,fresh);
      const after=await page.evaluate(()=>window.__uc160.reads);assert(after.length>reads);assert.equal(after.at(-1).id,id);
      const copied=page.url();await page.goto(copied);await show(page,fresh);
      return{detail,returnTo:listUrl,back_restored:true,forward_rendered:true,reads_before_reload:reads,reads_after_reload:after.length,fresh_transport_value:fresh,copied_url_reloaded:true,reads:after};
    });
    if(historical)continue;
    await test(`UC160 ${path} explicit return link and record switch`,listUrl,async page=>{
      await open(page).click();await show(page);assert.equal(await page.getByRole('link',{name:'返回工作列表'}).getAttribute('href'),listUrl);
      await page.getByRole('link',{name:'返回工作列表'}).click();await expect(page.getByRole('form',{name:'案件篩選'})).toBeVisible();assert.equal(page.url(),origin+listUrl);
      await page.goto(origin+`${path}/${other}`);await show(page,domain==='incorporation'?'QA Office 2':'HKD 1,602');
      const reads=await page.evaluate(()=>window.__uc160.reads);assert.equal(reads.at(-1).id,other);return{exact_return:listUrl,other_record:other,reads};
    });
    await test(`UC160 ${path} denied, temporary error, missing, malformed and retry`,path,async page=>{
      const evidence=[];
      for(const mode of ['denied','error']){
        await page.evaluate(mode=>window.__uc160.mode=mode,mode);await open(page).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText(marker,{exact:true})).toHaveCount(0);
        const before=await page.evaluate(()=>window.__uc160.reads.length);await page.evaluate(()=>window.__uc160.mode='normal');await page.getByRole('button',{name:'重試'}).click();await show(page);assert.equal(await page.evaluate(()=>window.__uc160.reads.length),before+1);
        evidence.push({mode,retry_reads:1});await page.goBack();await expect(page.getByRole('form',{name:'案件篩選'})).toBeVisible();
      }
      await page.evaluate(()=>window.__uc160.mode='missing');await open(page).click();await expect(page.getByRole('heading',{name:domain==='incorporation'?'找不到公司註冊案件':'找不到公司變更申請'})).toBeVisible();await expect(page.getByRole('button',{name:'重試'})).toHaveCount(0);
      const count=await page.evaluate(()=>window.__uc160.reads.length);await page.evaluate(async path=>{await window.__uc160.router.navigate({href:path+'/invalid-id'})},path);
      await expect(page.getByRole('heading',{name:domain==='incorporation'?'找不到公司註冊案件':'找不到公司變更申請'})).toBeVisible();assert.equal(await page.evaluate(()=>window.__uc160.reads.length),count);
      return{evidence,missing:true,malformed_transport_calls:0};
    });
    await test(`UC160 ${path} leave pending detail and ignore late result`,path,async page=>{
      await page.evaluate(()=>window.__uc160.hold=true);await open(page).click();await page.waitForFunction(()=>window.__uc160.pending.length===1);await page.goBack();await expect(page.getByRole('form',{name:'案件篩選'})).toBeVisible();await page.evaluate(()=>window.__uc160.release());await expect(page.getByRole('link',{name:'返回工作列表'})).toHaveCount(0);assert.equal(new URL(page.url()).pathname,path);return{late_result_cannot_replace_list:true,reads:await page.evaluate(()=>window.__uc160.reads)};
    });
    await test(`UC160 ${path} duplicate navigation and out-of-order detail reads`,path,async page=>{
      await page.evaluate(()=>window.__uc160.hold=true);await open(page).click();await page.waitForFunction(()=>window.__uc160.pending.length===1);
      const firstUrl=new URL(page.url());await page.evaluate(async href=>{await window.__uc160.router.navigate({href})},firstUrl.pathname+firstUrl.search);
      assert.equal(await page.evaluate(()=>window.__uc160.reads.length),1,'Same pending detail must share its read');
      await page.evaluate(async href=>{await window.__uc160.router.navigate({href})},`${path}/${other}`);await page.waitForFunction(()=>window.__uc160.pending.length===2);
      await page.evaluate(()=>window.__uc160.pending.pop()());const wanted=domain==='incorporation'?'QA Office 2':'HKD 1,602';await show(page,wanted);
      await page.evaluate(()=>window.__uc160.release());await show(page,wanted);assert.equal(new URL(page.url()).pathname,`${path}/${other}`);
      const reads=await page.evaluate(()=>window.__uc160.reads);assert.deepEqual(reads.map(r=>r.id),[id,other]);return{same_pending_id_transport_reads:1,latest_record:other,first_response_released_last:true,reads};
    });
    await test(`UC160 ${path} slash alias and empty list`,path+'/?q=QA',async page=>{
      await expect(page.getByLabel('搜尋既有案件')).toHaveValue('QA');await page.evaluate(()=>{window.__uc160.saved.incorporation={};window.__uc160.saved.changes={}});await page.getByRole('button',{name:'重新整理列表'}).click();await expect(page.getByText(domain==='incorporation'?'沒有符合篩選的公司註冊案件。':'沒有符合篩選的公司變更申請。')).toBeVisible();return{trailing_slash_list_rendered:true,empty_visible:true};
    });
  }
  assert(resolutions.length>=4);assert.deepEqual(blocked,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(consoleErrors,[]);
}catch(e){outerError=e.message;process.exitCode=1}
finally{
  writeFileSync(join(folder,`browser-results-${attempt}.json`),JSON.stringify({run_id:run,attempt,origin,sourceHashes,historical_overlay:historical,browser_version:browser?.version(),results,blocked_external_origins:blocked,page_errors:pageErrors,console_errors:consoleErrors,http_errors:httpErrors,resolutions,outer_error:outerError??null,native_auth_http_db:false,cleanup:'fresh contexts closed; own server/browser closed; no database or shared resources'},null,2)+'\n',{flag:'wx'});
  await browser?.close();await server.close();
}
console.log(JSON.stringify({attempt,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,setup_failed:results.filter(r=>r.status==='setup_failed').length,outerError}));
if(results.some(r=>r.status!=='passed')||outerError)process.exitCode=1;
