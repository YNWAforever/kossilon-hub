import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
const folder=import.meta.dirname,root=resolve(folder,'../../..');assert.equal(process.cwd(),root);
const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
const head=git('rev-parse','HEAD').toString().trim(),source=JSON.parse(readFileSync(join(folder,'source-candidate.json'),'utf8'));
assert.equal(git('rev-parse','HEAD^').toString().trim(),source.source_sha);
const walk=dir=>readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p]});
const files=walk(folder);
for(const absolute of files){const path=relative(root,absolute).replaceAll('\\','/');assert(readFileSync(absolute).equals(git('show',`${head}:${path}`)),path)}
for(const row of source.files){const bytes=readFileSync(join(root,row.path));assert(bytes.equals(git('show',`${source.source_sha}:${row.path}`)));assert(bytes.equals(git('show',`${head}:${row.path}`)))}
assert.equal(git('status','--porcelain=v1').toString(),'');
console.log(JSON.stringify({delivery_sha:head,source_sha:source.source_sha,evidence_git_blobs_verified:files.length,source_files_verified:source.files.length,status:'clean',push_merge_deploy:false}));
