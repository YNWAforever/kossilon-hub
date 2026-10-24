import ts from 'typescript';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');assert.equal(process.cwd(),root);
const files=execFileSync('git',['ls-files','src'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(f=>/\.tsx?$/.test(f)&&!f.includes('.test.'));
const functions=[],modules=[];
for(const file of files){
 const text=readFileSync(file,'utf8');if(!text.includes('createServerFn('))continue;
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const rows=[];
 function walk(n){
  if(ts.isVariableDeclaration(n)&&n.initializer&&n.initializer.getText(sf).includes('createServerFn(')){
   const source=n.initializer.getText(sf),method=source.match(/createServerFn\(\{\s*method:\s*["'](.*?)["']/)?.[1]??'UNKNOWN';
   rows.push({file,name:n.name.getText(sf),method,line:sf.getLineAndCharacterOfPosition(n.pos).line+1});
  }ts.forEachChild(n,walk);
 }walk(sf);functions.push(...rows);
 if(rows.some(r=>r.method==='POST')){
  assert(/requireActor|requireStaffActor|requireClientCompanyAccess|getCurrentAnnualReturnActor/.test(text),file+' lacks known authentication root');
  modules.push({file,post_functions:rows.filter(r=>r.method==='POST').map(r=>r.name),sha256:createHash('sha256').update(text).digest('hex'),authority_root:'requireActor via module/context helpers; static review only'});
 }
}
assert.equal(functions.filter(r=>r.method==='POST').length,74);assert.equal(modules.length,17);
writeFileSync(join(import.meta.dirname,'entrypoint-inventory.json'),JSON.stringify({base:'495fc88061a874b285e0fd7131b042243ab74b92',source_only:true,post_functions:74,post_modules:17,get_functions:functions.filter(r=>r.method==='GET').length,modules,functions,custom_entries:[{path:'/api/handoffs/export',authority:'createDocumentContextForRequest -> requireActor POST'},{path:'/api/webhooks/whatsapp',authority:'verified HMAC -> assertApplicationWriteSchema before writer'},{path:'runFirmMaintenance',authority:'input parse -> assertApplicationWriteSchema before production factories'}],outside_business_db_scope:['Neon Auth proxy/session/login/recovery infrastructure','offline scripts with their own migration/isolation gates'],limitations:'Inventory is not 74 executed mutation journeys, native HTTP/Auth/RLS, full-schema/checksum/privilege or concurrent-DDL proof'},null,2)+'\n',{flag:'wx'});
console.log('Inventoried 74 POST / 17 modules and 3 custom write entrypoints (source only).');
