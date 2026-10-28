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
const selected = ["src/server/maintenance-trigger-runtime.test.ts","src/server/maintenance-trigger.test.ts","src/server/maintenance-http.test.ts","src/server/cron-wiring.test.ts","src/features/operations/server-fns.test.ts","src/features/operations/schema-health.test.ts","src/features/operations/schema-readiness.test.ts","src/features/operations/release-compatibility.test.ts","src/routes/-operations.interaction.test.tsx","src/test/db-integration-files.convention.test.ts"];
const commands = {
  focus: ["node_modules/vitest/vitest.mjs","run","--project","unit","src/server/maintenance-trigger-runtime.test.ts","--maxWorkers","1"],
  targeted: ['node_modules/vitest/vitest.mjs','run','--project','unit',...selected,'--maxWorkers','1'],
  unit: ['node_modules/vitest/vitest.mjs','run','--project','unit','--maxWorkers','1'],
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
env.TEMP = join(root,'.worktrees/schema-d69e7b0e-unit'); env.TMP = env.TEMP;
mkdirSync(env.TEMP,{recursive:true});
if (kind === 'build') { env.NITRO_PRESET='cloudflare-module'; env.VITE_ENABLE_DEMO_AUTH='false'; }
const minGiB = ['targeted','focus'].includes(kind) ? 1.5 : ['unit','build'].includes(kind) ? 3 : 2;
const gate = spawnSync(process.execPath,[join(folder,'resource-gate.mjs'),kind+'-'+attempt,String(minGiB)],{cwd:root,env,encoding:'utf8',windowsHide:true});
process.stdout.write(gate.stdout ?? '');
assert.equal(gate.status,0,'Resource gate refused; no check launched');
const started = new Date().toISOString();
const result = spawnSync(process.execPath,commands[kind],{cwd:root,env,encoding:'utf8',timeout:kind==='unit'?600_000:240_000,maxBuffer:30*1024*1024,windowsHide:true});
writeFileSync(join(folder,stem+'.txt'),(result.stdout??'')+(result.stderr??''),{flag:'wx'});
writeFileSync(join(folder,stem+'.json'),JSON.stringify({kind,attempt,started,finished:new Date().toISOString(),command:[process.execPath,...commands[kind]],exit_code:result.status,signal:result.signal,error:result.error?.message??null,env_keys:Object.keys(env)},null,2),{flag:'wx'});
console.log(JSON.stringify({kind,attempt,exit_code:result.status}));
process.exitCode = result.status ?? 1;
