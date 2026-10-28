import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../../..');
assert.equal(process.cwd(), root);
assert.equal(root, 'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
assert.deepEqual(readdirSync(root).filter(f => f.startsWith('.env') && f !== '.env.example'), []);
const folder = resolve(import.meta.dirname);
const kind = process.argv[2], attempt = process.argv[3];
assert.match(attempt ?? '', /^[a-z0-9-]+$/);
const selected = ['src/features/auth/auth-router-recovery.test.tsx','src/routes/-case-subroutes.interaction.test.tsx','src/routes/-nested-route-outlet.convention.test.ts','src/features/incorporation/read.test.ts','src/features/incorporation/authorization.test.ts','src/features/corporate-changes/read.test.ts','src/features/incorporation/components/case-lists.test.tsx','src/features/incorporation/components/production-incorporation-detail.test.tsx','src/features/corporate-changes/components/production-corporate-change-detail.test.tsx'];
const commands = {
  auth: ['node_modules/vitest/vitest.mjs','run','--project','unit','src/features/auth/auth-router-recovery.test.tsx','--maxWorkers','1'],
  targeted: ['node_modules/vitest/vitest.mjs','run','--project','unit',...selected,'--maxWorkers','1'],
  unit: ['node_modules/vitest/vitest.mjs','run','--project','unit','--maxWorkers','1'],
  browser: ['docs/audit-remediation/cosec-20261024-routes-e4b761c9/browser-routes.mjs',attempt],
  worker: ['node_modules/vitest/vitest.mjs','run','--project','unit','src/routes/-work-queue.interaction.test.tsx','--maxWorkers','1'],
  typecheck: ['node_modules/typescript/bin/tsc','--noEmit'],
  lint: ['node_modules/eslint/bin/eslint.js','.','--ignore-pattern','.worktrees/**'],
  build: ['node_modules/vite/bin/vite.js','build'],
};
assert(kind in commands);
const stem = `${kind}-${attempt}`;
assert(!existsSync(join(folder,stem+'.txt')) && !existsSync(join(folder,stem+'.json')), 'Prior output exists');
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.test(name)));
env.CI = 'true'; env.NO_COLOR = '1';
env.TEMP = join(root,'.worktrees/routes-e4b761c9-unit'); env.TMP = env.TEMP;
mkdirSync(env.TEMP,{recursive:true});
if (kind === 'build') { env.NITRO_PRESET='cloudflare-module'; env.VITE_ENABLE_DEMO_AUTH='false'; }
const started = new Date().toISOString();
const result = spawnSync(process.execPath,commands[kind],{cwd:root,env,encoding:'utf8',timeout:kind==='unit'?600_000:240_000,maxBuffer:30*1024*1024,windowsHide:true});
writeFileSync(join(folder,stem+'.txt'),(result.stdout??'')+(result.stderr??''),{flag:'wx'});
writeFileSync(join(folder,stem+'.json'),JSON.stringify({kind,attempt,started,finished:new Date().toISOString(),command:[process.execPath,...commands[kind]],exit_code:result.status,signal:result.signal,error:result.error?.message??null,env_keys:Object.keys(env)},null,2),{flag:'wx'});
console.log(JSON.stringify({kind,attempt,exit_code:result.status}));
process.exitCode = result.status ?? 1;
