import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export const digest=b=>createHash('sha256').update(b).digest('hex');
// One read-only batch preserves binary bytes and avoids hundreds of Git processes.
export function verifyBlobs(root,sha,rows){
  for(const row of rows)assert(!/[\r\n]/.test(row.path));
  const result=spawnSync('git',['cat-file','--batch'],{cwd:root,windowsHide:true,input:rows.map(r=>`${sha}:${r.path}\n`).join(''),maxBuffer:100*1024*1024});
  assert.equal(result.status,0,result.stderr?.toString());
  let offset=0;
  for(const row of rows){
    const end=result.stdout.indexOf(10,offset);assert(end>=offset);
    const header=result.stdout.subarray(offset,end).toString().split(' ');assert.equal(header[1],'blob');
    const size=Number(header[2]),bytes=result.stdout.subarray(end+1,end+1+size);assert.equal(bytes.length,size);
    const local=readFileSync(join(root,row.path));assert(bytes.equals(local),`Git/local bytes differ: ${row.path}`);
    if(row.sha256)assert.equal(digest(bytes),row.sha256,row.path);
    if(row.bytes!==undefined)assert.equal(size,row.bytes,row.path);
    offset=end+size+2;assert.equal(result.stdout[offset-1],10);
  }
  assert.equal(offset,result.stdout.length);
  return rows.length;
}
