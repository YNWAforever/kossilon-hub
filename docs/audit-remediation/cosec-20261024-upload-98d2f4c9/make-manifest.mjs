import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
const folder=import.meta.dirname;
const walk=dir=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p]});
const files=walk(folder).map(p=>({absolute:p,path:relative(folder,p).replaceAll('\\','/')})).filter(r=>!['evidence-manifest.json','verification-report.txt'].includes(r.path)).sort((a,b)=>a.path.localeCompare(b.path)).map(({path,absolute})=>{const b=readFileSync(absolute);return{path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}});
writeFileSync(join(folder,'evidence-manifest.json'),JSON.stringify({run_id:'cosec-20261024-upload-98d2f4c9',algorithm:'SHA256',files},null,2)+'\n',{flag:'wx'});
console.log(`Manifested ${files.length} files; manifest/report excluded from self reference.`);
