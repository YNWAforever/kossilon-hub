import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');assert.equal(process.cwd(),root);
const git=(...a)=>execFileSync('git',a,{cwd:root,windowsHide:true}).toString().trim().split(/\r?\n/).filter(Boolean);
const files=[...new Set([...git('diff','--name-only','--','src'),...git('ls-files','--others','--exclude-standard','src')])].filter(p=>/\.tsx?$/.test(p));
const allowed=['features/admin/','features/auth/staff-lifecycle.ts','features/incorporation/repository.ts','features/corporate-changes/repository.ts','features/annual-return/repository.ts','features/annual-return/server-fns.ts','features/work-items/repository.ts','features/nar-import/apply.ts','features/bulk-operations/repository.ts','features/documents/maintenance.ts','test/db-integration-files.ts'];
for(const p of files)assert(allowed.some(a=>p.startsWith('src/'+a)),p);
const r=spawnSync(process.execPath,['node_modules/eslint/bin/eslint.js',...files,'--fix'],{cwd:root,stdio:'inherit',windowsHide:true,timeout:120000});process.exitCode=r.status??1;
