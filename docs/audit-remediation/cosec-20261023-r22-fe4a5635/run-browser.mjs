import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readdirSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const folder = resolve(import.meta.dirname);
const root = resolve(folder, '../../..');
if (process.cwd() !== root || root !== 'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023') throw Error('Unexpected checkout');
const attempt = process.argv[2];
if (!/^(first|second|final|verified|reflow|complete|reflow-complete|native-capture)$/.test(attempt)) throw Error('Explicit owned attempt required');
const config = attempt.startsWith('reflow') ? 'playwright.local.config.ts' : 'playwright.r22-local.config.ts';
const logPath = join(folder, `browser-${attempt}.txt`);
// Exclusive output creation protects all prior failure logs.
writeFileSync(logPath, '', { flag: 'wx' });
const envFiles = readdirSync(root).filter(name => name.startsWith('.env') && name !== '.env.example');
if (envFiles.length) throw Error('Unexpected local env files; target unverified');
const port = createServer();
await new Promise((ok, fail) => { port.once('error', fail); port.listen(5180, '127.0.0.1', ok); });
await new Promise(ok => port.close(ok));
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.test(name)));
env.CI = 'true'; env.PLAYWRIGHT_BROWSER_CHANNEL = 'msedge';
env.PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:5180';
env.VITE_ENABLE_DEMO_AUTH = 'true'; env.NO_COLOR = '1';
const temp = join(root, '.worktrees/r22-fe4a5635-temp');
mkdirSync(temp, { recursive: true }); env.TEMP = temp; env.TMP = temp;
const preflight = { run_id: 'cosec-20261023-r22-fe4a5635', attempt, root, config, port: 5180,
  bind_probe_free: true, reuse_existing_server: false, env_keys: Object.keys(env), env_files: envFiles,
  head: execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim(), utc: new Date().toISOString(),
  demo_only: true, database_variables_absent: true, native_auth_variables_absent: true };
writeFileSync(join(folder, `preflight-${attempt}.json`), JSON.stringify(preflight, null, 2), { flag: 'wx' });
const args = ['node_modules/@playwright/test/cli.js','test','--config',config];
if (attempt.startsWith('reflow')) args.push('e2e/continuation-reflow.spec.ts');
const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe','pipe'], windowsHide:true });
const { appendFileSync } = await import('node:fs');
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => appendFileSync(logPath, bytes));
const result = await new Promise((ok, fail) => { child.once('error', fail); child.once('exit', (code, signal) => ok({code, signal})); });
const output = readFileSync(logPath, 'utf8');
const match = output.match(/\[local-browser-evidence\] run root: (.+)/);
writeFileSync(join(folder, `receipt-${attempt}.json`), JSON.stringify({ ...result, runRoot:match?.[1]?.trim(),
  utc:new Date().toISOString(), command:[process.execPath,...args] }, null, 2), {flag:'wx'});
console.log(JSON.stringify({ ...result, logPath, runRoot:match?.[1]?.trim() }));
process.exitCode = result.code ?? 1;
