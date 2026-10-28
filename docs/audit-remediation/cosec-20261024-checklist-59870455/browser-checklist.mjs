// Disposable loopback component harness. All RPC/router boundaries are local stubs.
// This is real headless Edge keyboard evidence, never native Auth/HTTP/RLS acceptance.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
const folder=import.meta.dirname,root=resolve(folder,'../../..'),attempt=process.argv[2];
assert(/^(red|green)[0-9]*$/.test(attempt)); assert.equal(realpathSync(process.cwd()),root);
assert.equal(root,'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
const component=join(root,'src/features/incorporation/components/production-incorporation-detail.tsx');
const source=readFileSync(attempt.startsWith('red')?join(folder,'production-detail-before.tsx.snapshot'):component,'utf8');
const digest=value=>createHash('sha256').update(value).digest('hex');
const fixture={id:randomUUID(),proposedCompanyNameEn:'UC159 local browser contract',proposedCompanyNameZh:null,proposedRegisteredOffice:'Local only',proposedCompanySecretary:'Local only',registeredCapital:10000,businessNature:'Local contract',status:'Intake',ownerId:randomUUID(),ownerName:'Local owner',teamId:randomUUID(),teamName:'Local team',targetCompletionDate:'2026-11-30',companyId:null,completedAt:null,createdAt:'2026-10-24T00:00:00Z',checklist:[]};
fixture.checklist=Array.from({length:5},(_,i)=>({id:randomUUID(),caseId:fixture.id,itemLabel:i<2?'NNC1 incorporation form':`Local document ${i+1}`,required:true,status:'Missing',note:`Preserve note ${i}`,receivedAt:null,verifiedAt:null}));
const planned={attempt,run_id:'cosec-20261024-checklist-59870455',fixture,source_sha256:digest(source),rpc:'in-memory local stub; no database/auth/provider client',native:false};
writeFileSync(join(folder,`browser-planned-${attempt}.json`),JSON.stringify(planned,null,2)+'\n',{flag:'wx'});
const cache=join(root,'.worktrees',`checklist-59870455-browser-${attempt}`);
assert.equal(realpathSync(join(root,'.worktrees')),join(root,'.worktrees'));
assert(!existsSync(cache));mkdirSync(cache,{recursive:false});
const rpc=`export async function getIncorporationCase(){const w=window.__uc159;w.reads++;return structuredClone(w.saved)}
export async function updateIncorporationChecklistItem({data}){const w=window.__uc159;w.calls.push(structuredClone(data));if(w.hold)await new Promise(yes=>w.pending.push(yes));if(w.failNext){w.failNext=false;throw Error('Local contract rejection')}w.saved.checklist=w.saved.checklist.map(i=>i.id===data.itemId?{...i,status:data.status,note:data.note}:i);return structuredClone(w.saved)}
export async function completeIncorporationCase(){throw Error('Outside UC159 scope')} export async function updateIncorporationCaseStatus(){throw Error('Outside UC159 scope')}`;
const main=`import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{ProductionIncorporationDetail}from'/src/features/incorporation/components/production-incorporation-detail.tsx';
const w=window.__uc159={saved:${JSON.stringify(fixture)},calls:[],reads:0,hold:false,failNext:false,pending:[],release(){w.hold=false;w.pending.splice(0).forEach(f=>f())}};
let root,client;w.reopen=()=>{if(root){root.unmount();client.clear()}client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});root=createRoot(document.getElementById('app'));root.render(React.createElement(QueryClientProvider,{client},React.createElement(ProductionIncorporationDetail,{caseId:w.saved.id})))};w.reopen();`;
let rpcResolutions=0;
const server=await createServer({configFile:false,envFile:false,envDir:false,root,cacheDir:join(cache,'vite'),plugins:[{
  name:'uc159-local-boundaries',enforce:'pre',
  resolveId(id,importer){if(id==='virtual:uc159')return '\0uc159-main';if(id==='@tanstack/react-router'&&importer?.replaceAll('\\','/').endsWith('/incorporation/components/production-incorporation-detail.tsx'))return '\0uc159-router';if(id==='../server-fns'&&importer?.replaceAll('\\','/').endsWith('/incorporation/components/production-incorporation-detail.tsx')){rpcResolutions++;return '\0uc159-rpc'}},
  load(id){if(id==='\0uc159-main')return main;if(id==='\0uc159-rpc')return rpc;if(id==='\0uc159-router')return "import React from'react';export const Link=({children})=>React.createElement('a',{href:'/incorporation'},children);export const useNavigate=()=>()=>{}";if(id.split('?')[0].replaceAll('\\','/')===component.replaceAll('\\','/'))return source;},
  configureServer(s){s.middlewares.use('/uc159-harness',(req,res)=>{res.setHeader('content-type','text/html');res.setHeader('x-uc159-run','cosec-20261024-checklist-59870455');res.end('<!doctype html><html lang="zh-Hant"><title>UC159 local contract</title><body><div id="app"></div><script type="module" src="/@id/__x00__uc159-main"></script></body></html>')})},
},react()],resolve:{alias:{'@':join(root,'src')}},server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{strict:true,allow:[root]}},optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','@tanstack/react-query','@tanstack/react-router','@radix-ui/react-slot','lucide-react','class-variance-authority','clsx','tailwind-merge','sonner','zod']},logLevel:'warn'});
let browser;const results=[],blocked=[],pageErrors=[],consoleErrors=[],httpErrors=[];
try{
  await server.listen();const address=server.httpServer.address();assert.equal(address.address,'127.0.0.1');
  const origin=`http://127.0.0.1:${address.port}`;
  const target=await fetch(origin+'/uc159-harness');assert.equal(target.headers.get('x-uc159-run'),'cosec-20261024-checklist-59870455');
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';assert(existsSync(edge));
  browser=await chromium.launch({executablePath:edge,headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();blocked.push(url.origin);return route.abort()});
  const page=await context.newPage();page.setDefaultTimeout(15_000);page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text())});page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});
  const go=async()=>{await page.goto(origin+'/uc159-harness');await expect(page.getByRole('combobox')).toHaveCount(5,{timeout:30000})};
  const test=async(name,body)=>{let ready=false;try{await go();ready=true;const evidence=await body();results.push({name,status:'passed',evidence})}catch(error){results.push({name,status:ready?'failed':'setup_failed',error:error.message,dom:await page.locator('body').innerText().catch(()=>''),active:await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')})).catch(()=>null)})}};
  await test('UC159 five unique accessible names',async()=>{const names=await page.getByRole('combobox').evaluateAll(rows=>rows.map(r=>r.getAttribute('aria-label')));assert.equal(new Set(names).size,5);return{names}});
  await test('UC159 keyboard pending focus, Tab, five saves and reopen',async()=>{
    const controls=page.getByRole('combobox'),first=controls.nth(0),second=controls.nth(1);
    await page.evaluate(()=>window.__uc159.hold=true);await first.focus();await first.press('End');
    await page.waitForFunction(()=>window.__uc159.calls.length===1);await page.waitForFunction(()=>{const s=document.querySelector('select');return s&&(s.disabled||s.getAttribute('aria-disabled')==='true')});
    const pending=await first.evaluate(e=>({disabled:e.disabled,focused:document.activeElement===e,value:e.value,ariaDisabled:e.getAttribute('aria-disabled')}));
    assert.equal(pending.focused,true,JSON.stringify(pending));assert.equal(pending.disabled,false);assert.equal(pending.ariaDisabled,'true');
    await first.press('ArrowUp');assert.equal(await page.evaluate(()=>window.__uc159.calls.length),1);
    await page.keyboard.press('Tab');await expect(second).toBeFocused();await page.evaluate(()=>window.__uc159.release());
    await expect(first).toHaveAttribute('aria-disabled','false');await expect(second).toBeFocused();
    for(let i=1;i<5;i++){const select=controls.nth(i);await select.focus();await select.press('End');await page.waitForFunction(i=>window.__uc159.saved.checklist[i].status==='Rejected',i);await expect(select).toBeFocused();}
    const before=await page.evaluate(()=>structuredClone(window.__uc159.saved));const reads=await page.evaluate(()=>window.__uc159.reads);
    await page.evaluate(()=>window.__uc159.reopen());await expect(controls).toHaveCount(5);await page.waitForFunction(n=>window.__uc159.reads>n,reads);
    const values=await controls.evaluateAll(rows=>rows.map(r=>r.value));assert.deepEqual(values,Array(5).fill('Rejected'));
    const calls=await page.evaluate(()=>window.__uc159.calls);assert.equal(calls.length,5);assert(calls.every((c,i)=>c.caseId===fixture.id&&c.itemId===fixture.checklist[i].id&&c.note===fixture.checklist[i].note));
    return{pending,before,reopened_values:values,calls,reads_before:reads,reads_after:await page.evaluate(()=>window.__uc159.reads)};
  });
  await test('UC159 linked error and explicit keyboard retry',async()=>{
    const select=page.getByRole('combobox').nth(2);await page.evaluate(()=>window.__uc159.failNext=true);await select.focus();await select.press('End');
    const alert=page.getByRole('alert');await expect(alert).toContainText('未能保存');const errorId=await alert.getAttribute('id');
    assert((await select.getAttribute('aria-describedby')).split(' ').includes(errorId));await expect(select).toHaveValue('Rejected');
    assert.equal(await page.evaluate(()=>window.__uc159.saved.checklist[2].status),'Missing');assert.equal(await page.evaluate(()=>window.__uc159.calls.length),1);
    await expect(select).toBeFocused();const retry=page.getByRole('button',{name:/重試.*Local document 3/});await retry.focus();await retry.press('Enter');
    await expect(page.getByRole('alert')).toHaveCount(0);await expect(select).toBeFocused();await page.waitForFunction(()=>window.__uc159.saved.checklist[2].status==='Rejected');
    assert.equal(await page.evaluate(()=>window.__uc159.calls.length),2);return{attempted:'Rejected',saved_after_rejection:'Missing',saved_after_retry:'Rejected',rpc_calls:2,focus_after_retry:'same select'};
  });
  assert(rpcResolutions>0);
  writeFileSync(join(folder,`browser-results-${attempt}.json`),JSON.stringify({attempt,run_id:planned.run_id,origin,host:address.address,server_port:address.port,browser_version:browser.version(),executable:edge,source_sha256:planned.source_sha256,rpc_stub_resolutions:rpcResolutions,blocked_external_origins:blocked,page_errors:pageErrors,console_errors:consoleErrors,http_errors:httpErrors,results,native_auth_http_rls:false},null,2)+'\n',{flag:'wx'});
  assert.deepEqual(blocked,[]);assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({attempt,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length}));
  process.exitCode=results.some(r=>r.status!=='passed')?1:0;
}finally{await browser?.close();await server.close();}
