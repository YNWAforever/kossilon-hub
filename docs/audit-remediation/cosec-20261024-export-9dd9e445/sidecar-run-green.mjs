import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join, resolve } from 'node:path';

const evidence = import.meta.dirname;
const root = resolve(evidence, '../../..');
assert.equal(root, 'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
const frozen = JSON.parse(readFileSync(join(evidence, 'sidecar-frozen.json'), 'utf8'));
const digest = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
for (const file of frozen.files) assert.equal(digest(file.path), file.sha256, 'Frozen content changed: ' + file.path);
const scratch = join(root, '.worktrees/sidecar-uc157-9dd9e445-green-52a3e8');
mkdirSync(scratch, { recursive: true });
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));
Object.assign(env, { CI: 'true', NO_COLOR: '1', TEMP: scratch, TMP: scratch });
const test = 'src/components/bulk-export.interaction.test.tsx';
const config = join(scratch, 'vitest.config.mjs');
writeFileSync(config, `import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: ${JSON.stringify(root)}, envDir: false,
  cacheDir: ${JSON.stringify(join(scratch, 'vite-cache'))},
  resolve: { alias: { '@': ${JSON.stringify(join(root, 'src'))} } },
  test: { include: [${JSON.stringify(test)}], environment: 'jsdom', maxWorkers: 1, fileParallelism: false, retry: 0 }
});
`, { flag: 'wx' });
const write = (suffix, data) => writeFileSync(join(evidence, 'sidecar-green-' + suffix), data, { flag: 'wx' });
write('vitest-config.mjs.snapshot', readFileSync(config));
const args = [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, test, '--maxWorkers', '1', '--reporter=verbose', '--reporter=json', '--outputFile=' + join(evidence, 'sidecar-green-report.json')];
const bytes = freemem();
const preflight = { recorded_at: new Date().toISOString(), free_ram_bytes: bytes, free_ram_gib: bytes / 2 ** 30, total_ram_bytes: totalmem(), minimum_free_ram_bytes: 1.5 * 2 ** 30, root_env_files: readdirSync(root).filter((name) => name.startsWith('.env') && name !== '.env.example'), env_keys: Object.keys(env), max_workers: 1, config_loads_repo_env: false, command: [process.execPath, ...args], frozen_files: frozen.files };
write('preflight.json', JSON.stringify(preflight, null, 2));
if (bytes < preflight.minimum_free_ram_bytes || preflight.root_env_files.length) {
  const result = { status: 'BLOCKED', reason: bytes < preflight.minimum_free_ram_bytes ? 'FREE_RAM_BELOW_1_5_GIB' : 'ROOT_ENV_FILE_PRESENT', test_process_started: false };
  write('run.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, free_ram_gib: preflight.free_ram_gib }));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ status: 'STARTED', free_ram_gib: preflight.free_ram_gib, max_workers: 1 }));
  const started = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', launchError = null;
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('error', (error) => { launchError = error.message; });
  child.on('close', (code, signal) => {
    write('stdout.txt', stdout);
    write('stderr.txt', stderr);
    const path = join(evidence, 'sidecar-green-report.json');
    const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    const result = { started, finished: new Date().toISOString(), exit_code: code, signal, launch_error: launchError, test_process_started: true, report_present: !!report, total_tests: report?.numTotalTests ?? null, passed_tests: report?.numPassedTests ?? null, failed_tests: report?.numFailedTests ?? null, frozen_files_unchanged: frozen.files.every((file) => digest(file.path) === file.sha256) };
    write('run.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    process.exitCode = code ?? 1;
  });
}
