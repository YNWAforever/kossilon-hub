// PREPARED SIDECAR ONLY. Parent owns resource checks and schedules execution.
// From the exact root, after the parent's >=2 GiB browser gate:
//   node docs/audit-remediation/cosec-20261024-missing-d74e4679/run-checks.mjs browser green1
// Historical/red attempts overlay ONLY detail-before.tsx.snapshot in Vite memory.
// They run the same cases, retain the actual failure exit code, and expect the
// malformed/context case to fail once; other cases should remain independently green.
// No product files are overwritten; no native HTTP/Auth/DB/RLS acceptance is claimed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,expect} from '@playwright/test';

const folder=import.meta.dirname,root=resolve(folder,'../../..'),attempt=process.argv[2];
assert.match(attempt??'',/^(?:historical|red|current|green)[0-9]*$/,'Use a fresh historical/red/current/green attempt');
assert.equal(realpathSync(process.cwd()),root);
assert.equal(realpathSync(root),'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
assert.equal(realpathSync(folder),join(root,'docs/audit-remediation/cosec-20261024-missing-d74e4679'));
const run='cosec-20261024-missing-d74e4679',base='c9d783478572b1e11331018d46e09e20f427b832';
const historical=/^(historical|red)/.test(attempt),instance=randomUUID();
const normalized=path=>path.replaceAll('\\','/');
const digest=value=>createHash('sha256').update(value).digest('hex');
const git=(...args)=>execFileSync('git',['--no-optional-locks',...args],{cwd:root,windowsHide:true,encoding:'utf8'}).trim();
assert.equal(normalized(git('rev-parse','--show-toplevel')),normalized(root));
assert.equal(git('branch','--show-current'),'codex/cosec-20261023');
assert.equal(git('merge-base','HEAD',base),base);
const head=git('rev-parse','HEAD');
// envFile:false also prevents .env loading; reject inherited public Vite values.
assert.deepEqual(Object.keys(process.env).filter(key=>key.startsWith('VITE_')),[],
  'Use the parent sanitized run-checks environment');
const detailPath='src/features/corporate-changes/components/production-corporate-change-detail.tsx';
const overlayPath=join(folder,'detail-before.tsx.snapshot');
const baseline=readFileSync(overlayPath,'utf8');
assert.equal(baseline,execFileSync('git',['show',`${base}:${detailPath}`],{cwd:root,windowsHide:true,encoding:'utf8'}),
  'Baseline overlay must be the exact supplied base component');
const overlays=historical?{[normalized(join(root,detailPath))]:baseline}:{};
const sourcePaths=[
  'src/routes/corporate-changes.tsx','src/routes/corporate-changes.$id.tsx',detailPath,
  'src/features/corporate-changes/components/production-corporate-change-list.tsx',
  'src/features/incorporation/components/case-list-controls.tsx',
  'src/features/incorporation/case-list-query.ts','src/features/annual-return/daily-view-state.ts',
  'src/features/auth/route-guard.ts','src/lib/entity-id.ts','src/components/record-unavailable.tsx',
  'package.json',
];
const actualHashes=()=>Object.fromEntries(sourcePaths.map(path=>[path,digest(readFileSync(join(root,path)))]));
const sourceHashes=actualHashes();
const effectiveHashes={...sourceHashes,...(historical?{[detailPath]:digest(baseline)}:{})};
const harnessHashes=Object.fromEntries(['browser-missing.mjs','browser-entry.tsx.snapshot','detail-before.tsx.snapshot']
  .map(path=>[path,digest(readFileSync(join(folder,path)))]));
const paths=Object.fromEntries(['target','checkpoints','results'].map(kind=>[kind,
  join(folder,`browser-${kind}-${attempt}.${kind==='checkpoints'?'jsonl':'json'}`)]));
for(const path of Object.values(paths))assert(!existsSync(path),`Immutable prior output exists: ${path}`);
const cache=join(root,'.worktrees',`missing-d74e4679-browser-${attempt}`);
assert.equal(realpathSync(join(root,'.worktrees')),join(root,'.worktrees'));
assert(!existsSync(cache),'Use a new attempt; prior cache is retained');
mkdirSync(cache);
writeFileSync(paths.checkpoints,'',{flag:'wx'});

const boundaryViolations=[],resolutions=[],servedProductionModules=new Set();
const rpc={
  changes:`export const listCorporateChangeRequestPage=({data}={})=>window.__uc164.list(data);
    export const getCorporateChangeRequest=({data})=>window.__uc164.get(data.requestId);
    export const completeCorporateChangeRequest=()=>window.__uc164.forbid('completeCorporateChangeRequest');
    export const cancelCorporateChangeRequest=()=>window.__uc164.forbid('cancelCorporateChangeRequest');
    export const updateCorporateChangeChecklistItemStatus=()=>window.__uc164.forbid('updateCorporateChangeChecklistItemStatus');`,
  clients:`export const listClientAssignmentOptions=async()=>({owners:[],teams:[]});
    export const listClientPage=()=>window.__uc164.forbid('client picker is outside UC164');`,
  dialog:'export const CreateCorporateChangeRequestDialog=()=>null;',
};
const stubs=new Map([
  [normalized(join(root,'src/features/corporate-changes/server-fns')),'changes'],
  [normalized(join(root,'src/features/clients/server-fns')),'clients'],
  [normalized(join(root,'src/components/corporate-changes/create-corporate-change-request-dialog')),'dialog'],
]);
let origin,identity,server,browser,outerError;
const results=[],blocked=[],pageErrors=[],consoleErrors=[],httpErrors=[];
const started=new Date().toISOString();
const denyBoundary=message=>{boundaryViolations.push(message);throw Error(message)};
try{
  server=await createServer({configFile:false,envFile:false,envDir:false,root,
    cacheDir:join(cache,'vite'),publicDir:false,plugins:[{
      name:'uc164-local-only-boundaries',enforce:'pre',
      resolveId(id,importer){
        if(id==='virtual:uc164')return '\0uc164-entry.tsx';
        const from=normalized((importer??'').split('?')[0]);
        const raw=id.split('?')[0];
        let absolute=raw.startsWith('@/')?join(root,'src',raw.slice(2)):
          raw.startsWith('.')&&from&&!from.startsWith('\0')?resolve(dirname(from),raw):
          raw.startsWith('/src/')?join(root,raw.slice(1)):raw;
        absolute=normalized(absolute).replace(/\.tsx?$/,'');
        if(stubs.has(absolute)){
          const stub=stubs.get(absolute);resolutions.push({id,from,stub});return `\0uc164-${stub}`;
        }
        if(/^(https?:|wss?:|\/\/)/.test(id)||
          /(?:^|\/)(?:server-fns(?:\.|\/|$)|server(?:\/|$)|neon-auth-server(?:\.|$))/.test(absolute)||
          /\.server(?:\.|\/|$)/.test(absolute)||absolute.endsWith('/routes/__root')||
          /^(?:@tanstack\/react-start|@neondatabase\/|better-auth|postgres(?:\/|$)|pg(?:\/|$)|dotenv(?:\/|$))/.test(id)){
          return denyBoundary(`Unstubbed UC164 server/external import: ${id}`);
        }
      },
      load(id){
        const path=normalized(id.split('?')[0]);
        if(path in overlays)return overlays[path];
        if(id==='\0uc164-entry.tsx')return readFileSync(join(folder,'browser-entry.tsx.snapshot'),'utf8');
        for(const [name,code]of Object.entries(rpc))if(id===`\0uc164-${name}`)return code;
      },
      configureServer(s){s.middlewares.use((req,res,next)=>{
        if(req.method!=='GET'&&req.method!=='HEAD'){
          boundaryViolations.push(`Denied local HTTP method ${req.method}`);res.statusCode=405;res.end();return;
        }
        const pathname=new URL(req.url,'http://127.0.0.1').pathname;
        if(pathname==='/__uc164_identity'){
          if(!identity){res.statusCode=503;res.end();return}
          res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
          res.end(JSON.stringify(identity));return;
        }
        if(/^\/corporate-changes(?:\/|$)/.test(pathname)){
          res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');res.setHeader('x-uc164-run',run);
          res.end('<!doctype html><html lang="zh-Hant"><title>UC164 local stub transport</title><body><div id="app"></div><script type="module" src="/@id/__x00__uc164-entry.tsx"></script></body></html>');return;
        }
        if(pathname==='/favicon.ico'){res.statusCode=204;res.end();return}
        if(['/src/','/node_modules/','/@id/','/@fs/',
          `/.worktrees/missing-d74e4679-browser-${attempt}/vite/`].some(prefix=>pathname.startsWith(prefix))||
          ['/@vite/client','/@react-refresh'].includes(pathname)){next();return}
        boundaryViolations.push(`Denied unstubbed local HTTP path ${pathname}`);
        res.statusCode=451;res.end('UC164 local boundary denied');
      })},
    },react()],resolve:{alias:{'@':join(root,'src')}},
    server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{strict:true,allow:[root]}},
    optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','@tanstack/react-query',
      '@tanstack/react-router','@radix-ui/react-slot','lucide-react','class-variance-authority',
      'clsx','tailwind-merge','sonner','zod']},logLevel:'warn'});
  await server.listen();
  const address=server.httpServer.address();
  assert(address&&typeof address!=='string');assert.equal(address.address,'127.0.0.1');
  assert(Number.isInteger(address.port)&&address.port>0);
  origin=`http://127.0.0.1:${address.port}`;
  identity={run_id:run,attempt,instance,root:normalized(root),origin,host:address.address,port:address.port,
    branch:'codex/cosec-20261023',base,head,transport:'local-memory-sessionStorage-stub'};
  const preflight=await fetch(origin+'/__uc164_identity',{redirect:'error'});
  assert.equal(preflight.status,200);assert.deepEqual(await preflight.json(),identity);
  const html=await fetch(origin+'/corporate-changes',{redirect:'error'});
  assert.equal(html.headers.get('x-uc164-run'),run);
  assert((await html.text()).includes('/@id/__x00__uc164-entry.tsx'));
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';assert(existsSync(edge));
  writeFileSync(paths.target,JSON.stringify({...identity,started,configFile:false,envFile:false,envDir:false,
    sourceHashes,effectiveHashes,harnessHashes,fixture_ids:[
      'd74e4679-0164-4164-8164-000000000001','d74e4679-0164-4164-8164-000000000002',
      'd74e4679-0164-4164-8164-000000000099'],
    historical_overlay:historical?{path:detailPath,source:'detail-before.tsx.snapshot',base}:null,
    expected_baseline_failure:historical?'malformed zero-RPC retains caller context':null,
    real_layers:['Edge','Vite loopback asset HTTP','TanStack Router','QueryClient','production route/detail/list components'],
    stubbed_layers:['root Staff auth context','RPC responses','company picker dialog','sessionStorage fixture persistence'],
    native_application_http:'BLOCKED',native_auth:'BLOCKED',native_db:'BLOCKED',native_rls:'BLOCKED',
    resource_gate:'Parent must check before invocation; this harness does not grant resource approval'},null,2)+'\n',{flag:'wx'});
  browser=await chromium.launch({executablePath:edge,headless:true,
    args:['--disable-background-networking','--disable-component-update']});

  const settleUi=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const state=page=>page.evaluate(()=>({reads:window.__uc164.reads,listReads:window.__uc164.listReads,
    pending:window.__uc164.pending.map(({id,sequence})=>({id,sequence})),settled:window.__uc164.settled,
    documentId:window.__uc164.documentId,queryClientId:window.__uc164.queryClientId,boot:window.__uc164.boot}));
  const list=async page=>{await expect(page.getByRole('form',{name:'案件篩選'})).toBeVisible();
    await expect(page.getByRole('link',{name:'QA UC164 1',exact:true})).toBeVisible()};
  const noPrivate=async page=>{
    const body=await page.locator('body').innerText();
    for(const value of ['UC164_RAW_ERROR_d74e4679','UC164_PRIVATE_CHECKLIST_d74e4679',
      'synthetic_internal_table','synthetic_staff_email@example.invalid','HKD 1,641'])assert(!body.includes(value),`Leaked ${value}`);
    await expect(page.getByRole('form',{name:'案件篩選'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'取消申請',exact:true})).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveCount(0);
  };
  const noLoading=page=>expect(page.getByRole('status').filter({hasText:'正在載入公司變更申請'})).toHaveCount(0);
  const missing=async page=>{
    await expect(page.getByRole('heading',{name:'找不到公司變更申請',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'重試',exact:true})).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);await noLoading(page);await noPrivate(page);
  };
  const error=async page=>{
    await expect(page.getByRole('heading',{name:'公司變更申請無法載入',exact:true})).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('未能載入此申請。請稍後再試。');
    await expect(page.getByRole('button',{name:'重試',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'找不到公司變更申請',exact:true})).toHaveCount(0);
    await noLoading(page);await noPrivate(page);
  };
  const success=async(page,fee='HKD 1,641')=>{
    await expect(page.getByText(fee,{exact:true})).toBeVisible();
    await expect(page.getByText('UC164_PRIVATE_CHECKLIST_d74e4679',{exact:true})).toBeVisible();
    await expect(page.getByRole('form',{name:'案件篩選'})).toHaveCount(0);await noLoading(page);
  };
  const navigate=(page,href)=>page.evaluate(async href=>{await window.__uc164.router.navigate({href})},href);
  const filtered='/corporate-changes?q=QA&sort=company&cursor=UC164-d74e4679-page3';
  const id='d74e4679-0164-4164-8164-000000000001';
  const absent='d74e4679-0164-4164-8164-000000000099';
  const detail=(recordId,returnTo=filtered)=>`/corporate-changes/${recordId}?${new URLSearchParams({returnTo})}`;
  const returnLink=page=>page.getByRole('link',{name:'返回工作列表',exact:true});

  const test=async(name,path,body)=>{
    const context=await browser.newContext({serviceWorkers:'block'});
    let page,ready=false,result;
    try{
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===origin&&['http:'].includes(url.protocol))return route.continue();
        blocked.push({name,origin:url.origin,protocol:url.protocol});return route.abort();
      });
      await context.routeWebSocket('**/*',socket=>{blocked.push({name,websocket:true});socket.close()});
      page=await context.newPage();page.setDefaultTimeout(7000);
      page.on('pageerror',e=>pageErrors.push({name,error:e.message}));
      page.on('console',e=>{if(e.type()==='error')consoleErrors.push({name,error:e.text()})});
      page.on('response',response=>{
        if(response.status()>=400)httpErrors.push({name,url:response.url(),status:response.status()});
        const pathname=new URL(response.url()).pathname;
        if(pathname.startsWith('/src/')&&response.ok())servedProductionModules.add(pathname);
      });
      await page.goto(origin+path);
      await page.waitForFunction(()=>window.__uc164?.ready===true,{},{timeout:30000});
      const actual=await page.evaluate(()=>window.__uc164.identity);assert.deepEqual(actual,identity);ready=true;
      const evidence=await body(page);
      assert.deepEqual(await page.evaluate(()=>window.__uc164.violations),[]);
      result={name,status:'passed',evidence,state:await state(page)};
    }catch(e){result={name,status:ready?'failed':'setup_failed',error:e.message,url:page?.url(),
      dom:await page?.locator('body').innerText().catch(()=>null),state:page?await state(page).catch(()=>null):null}}
    finally{await context.close()}
    results.push(result);appendFileSync(paths.checkpoints,JSON.stringify(result)+'\n');
    if(result.status==='setup_failed')throw Error(`Harness setup failed in ${name}; remaining cases not run`);
  };

  await test('UC164 malformed zero-RPC retains caller context',filtered,async page=>{
    await list(page);const evidence=[];
    // Keep malformed safe/unsafe coverage in ONE case: baseline has one context failure.
    for(const malformed of ['not-a-uuid','d74e4679','undefined']){
      await navigate(page,detail(malformed));await missing(page);
      assert.equal((await state(page)).reads.length,0,'Malformed ID must not call RPC or mount its query');
      await expect(returnLink(page)).toHaveAttribute('href',filtered);
      await returnLink(page).click();await list(page);assert.equal(page.url(),origin+filtered);
      await expect(page.getByLabel('搜尋既有案件')).toHaveValue('QA');evidence.push({malformed,rpc:0,returnTo:filtered});
    }
    await navigate(page,detail('not-a-uuid','https://outside.invalid/UC164-d74e4679'));
    await missing(page);await expect(returnLink(page)).toHaveAttribute('href','/annual-returns');
    assert.equal((await state(page)).reads.length,0);
    return{evidence,unsafe_return_sanitized:'/annual-returns'};
  });
  await test('UC164 valid absent UUID returns null without retry',detail(absent),async page=>{
    await missing(page);await settleUi(page);
    const s=await state(page);assert.equal(s.reads.length,1);assert.equal(s.reads[0].id,absent);
    assert.equal(s.reads[0].outcome,'null');await expect(returnLink(page)).toHaveAttribute('href',filtered);
    return{rpc_reads:1,null_is_not_error:true,no_retry:true};
  });
  await test('UC164 explicit null keeps filtered return and browser Back',filtered,async page=>{
    await list(page);await page.evaluate(()=>window.__uc164.mode='missing');
    await page.getByRole('link',{name:'QA UC164 1',exact:true}).click();await missing(page);
    assert.equal(new URL(page.url()).searchParams.get('returnTo'),filtered);
    await expect(returnLink(page)).toHaveAttribute('href',filtered);
    await page.goBack();await list(page);assert.equal(page.url(),origin+filtered);
    await page.goForward();await missing(page);
    await returnLink(page).click();await list(page);assert.equal(page.url(),origin+filtered);
    await expect(page.getByLabel('搜尋既有案件')).toHaveValue('QA');
    return{null_is_not_error:true,back_forward:true,exact_return:filtered};
  });
  await test('UC164 503 redacted explicit retry and pending deduplication',filtered,async page=>{
    await list(page);await page.evaluate(()=>window.__uc164.mode='error');
    await page.getByRole('link',{name:'QA UC164 1',exact:true}).click();await error(page);await settleUi(page);
    const failed=await state(page);assert.equal(failed.reads.length,1);assert.equal(failed.reads[0].outcome,'synthetic-503');
    await expect(returnLink(page)).toHaveAttribute('href',filtered);
    // Two synchronous user events while the same query has no data must share one read.
    await page.getByRole('button',{name:'重試',exact:true}).evaluate(button=>{
      window.__uc164.mode='normal';window.__uc164.hold=true;button.click();button.click();
    });
    await page.waitForFunction(()=>window.__uc164.pending.length===1);
    await expect(page.getByRole('status').filter({hasText:'正在載入公司變更申請'})).toBeVisible();
    const href=new URL(page.url());await navigate(page,href.pathname+href.search);
    assert.equal((await state(page)).reads.length,2,'Explicit retry and duplicate pending navigation must share one additional read');
    assert.equal((await state(page)).pending.length,1);
    await page.evaluate(()=>window.__uc164.release());await success(page);
    assert.equal((await state(page)).reads.length,2);
    return{initial_failure_reads:1,automatic_retries:0,explicit_retry_reads:1,pending_duplicate_reads:0,recovered:true};
  });
  await test('UC164 403 generic error hides sensitive content and permits existing retry',filtered,async page=>{
    await list(page);await page.evaluate(()=>window.__uc164.mode='denied');
    await page.getByRole('link',{name:'QA UC164 1',exact:true}).click();await error(page);await settleUi(page);
    assert.equal((await state(page)).reads.length,1);assert.equal((await state(page)).reads[0].outcome,'synthetic-403');
    await expect(returnLink(page)).toHaveAttribute('href',filtered);
    await page.evaluate(()=>window.__uc164.mode='normal');await page.getByRole('button',{name:'重試',exact:true}).click();
    await success(page);assert.equal((await state(page)).reads.length,2);
    return{generic_redacted_message:true,sensitive_dom_absent:true,explicit_retry_reads:1,
      policy_limit:'Synthetic denial response only; no actual Auth/authorization/RLS verification'};
  });
  await test('UC164 outage return restores exact filtered list',filtered,async page=>{
    await list(page);await page.evaluate(()=>window.__uc164.mode='error');
    await page.getByRole('link',{name:'QA UC164 1',exact:true}).click();await error(page);
    await expect(returnLink(page)).toHaveAttribute('href',filtered);await returnLink(page).click();await list(page);
    assert.equal(page.url(),origin+filtered);await expect(page.getByLabel('搜尋既有案件')).toHaveValue('QA');
    return{error_return:filtered};
  });
  await test('UC164 valid missing rejects unsafe caller return',filtered,async page=>{
    await list(page);
    for(const unsafe of ['https://outside.invalid/UC164-d74e4679','//outside.invalid/UC164-d74e4679','/\\outside.invalid']){
      await navigate(page,detail(absent,unsafe));await missing(page);
      await expect(returnLink(page)).toHaveAttribute('href','/annual-returns');
    }
    return{rejected_return_inputs:3,safe_fallback:'/annual-returns',external_navigation:false};
  });
  await test('UC164 departure ignores a late successful detail response',filtered,async page=>{
    await list(page);await page.evaluate(()=>window.__uc164.hold=true);
    await page.getByRole('link',{name:'QA UC164 1',exact:true}).click();
    await page.waitForFunction(()=>window.__uc164.pending.length===1);
    await expect(page.getByRole('status').filter({hasText:'正在載入公司變更申請'})).toBeVisible();
    await page.goBack();await list(page);assert.equal(page.url(),origin+filtered);
    await page.evaluate(()=>window.__uc164.release());
    await page.waitForFunction(()=>window.__uc164.settled===1&&window.__uc164.pending.length===0);
    await settleUi(page);await list(page);assert.equal(page.url(),origin+filtered);
    await expect(returnLink(page)).toHaveCount(0);
    await expect(page.getByText('UC164_PRIVATE_CHECKLIST_d74e4679',{exact:true})).toHaveCount(0);
    const s=await state(page);assert.equal(s.reads.length,1);assert.equal(s.reads[0].outcome,'record');
    return{response_resolved_after_departure:true,late_detail_did_not_replace_list:true};
  });
  await test('UC164 real reload creates fresh QueryClient and reads updated local transport',detail(id),async page=>{
    await success(page);const before=await state(page);assert.equal(before.reads.length,1);
    const copied=page.url();await page.evaluate(id=>window.__uc164.bump(id),id);
    assert.equal((await state(page)).reads.length,1,'Changing own storage fixture must not masquerade as a new read');
    await page.reload();await success(page,'HKD 9,164');const after=await state(page);
    assert.notEqual(after.documentId,before.documentId);assert.notEqual(after.queryClientId,before.queryClientId);
    assert.equal(after.boot,before.boot+1);assert.equal(after.reads.length,2);
    assert.equal(after.reads.at(-1).queryClientId,after.queryClientId);assert.equal(after.reads.at(-1).id,id);
    assert.equal(after.reads.at(-1).outcome,'record');assert.equal(page.url(),copied);
    await page.goto(copied);await success(page,'HKD 9,164');const reopened=await state(page);
    assert.notEqual(reopened.queryClientId,after.queryClientId);assert.equal(reopened.reads.length,3);
    return{actual_browser_reload:true,new_query_client:true,reads_before:1,reads_after_reload:2,
      copied_url_reads:3,fresh_transport_value:'HKD 9,164',persistence:'own sessionStorage stub only'};
  });

  assert(resolutions.some(item=>item.stub==='changes'));assert(resolutions.some(item=>item.stub==='clients'));
  for(const path of ['/src/routes/corporate-changes.tsx','/src/routes/corporate-changes.$id.tsx',`/${detailPath}`]){
    assert(servedProductionModules.has(path),`Actual production route/component was not served: ${path}`);
  }
  assert.deepEqual(blocked,[]);assert.deepEqual(boundaryViolations,[]);assert.deepEqual(pageErrors,[]);
  assert.deepEqual(httpErrors,[]);assert.deepEqual(consoleErrors,[]);
  assert.deepEqual(actualHashes(),sourceHashes,'Source changed during browser run; do not claim a stable candidate');
  assert.equal(git('rev-parse','HEAD'),head,'HEAD changed during browser run');
}catch(e){outerError=e.stack??e.message;process.exitCode=1}
finally{
  await browser?.close().catch(e=>{outerError??=`Browser cleanup: ${e.message}`});
  await server?.close().catch(e=>{outerError??=`Vite cleanup: ${e.message}`});
  writeFileSync(paths.results,JSON.stringify({run_id:run,attempt,instance,started,finished:new Date().toISOString(),
    root,origin,head,base,sourceHashes,effectiveHashes,harnessHashes,historical_overlay:historical,
    browser_version:browser?.version(),results,blocked_external_requests:blocked,
    unstubbed_boundary_violations:boundaryViolations,page_errors:pageErrors,console_errors:consoleErrors,
    http_errors:httpErrors,resolutions,served_production_modules:[...servedProductionModules].sort(),
    outer_error:outerError??null,native_application_http:false,native_auth:false,native_db:false,native_rls:false,
    limitations:['Synthetic Staff root context bypasses real authentication and role resolution',
      '503/403 are thrown RPC stub errors, not native HTTP statuses',
      'Local list adapter does not prove server filtering, pagination or authorization',
      'Reload reads own sessionStorage only; no backend persistence or RLS proof',
      'Create dialog is stubbed; no mutations or other domains exercised',
      'Headless local Edge only; no physical device or Safari/WebKit acceptance'],
    cleanup:'Own contexts/browser/loopback server closed; immutable receipts/cache retained; no DB or shared-resource cleanup'},null,2)+'\n',{flag:'wx'});
}
const summary={attempt,passed:results.filter(r=>r.status==='passed').length,
  failed:results.filter(r=>r.status==='failed').length,setup_failed:results.filter(r=>r.status==='setup_failed').length,
  historical_overlay:historical,outer_error:outerError??null};
console.log(JSON.stringify(summary));
if(results.some(r=>r.status!=='passed')||outerError)process.exitCode=1;
