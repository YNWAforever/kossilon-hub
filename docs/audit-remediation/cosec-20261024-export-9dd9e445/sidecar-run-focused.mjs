import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
assert.equal(root, 'C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023');
const evidence = import.meta.dirname;
const scratch = join(root, '.worktrees/sidecar-uc157-9dd9e445-52a3e8');
const test = 'src/components/bulk-export.interaction.test.tsx';
const source = 'src/components/bulk-selection-toolbar.tsx';
const originalTest = 'src/components/bulk-selection-toolbar.test.tsx';
const hash = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));
env.CI = 'true';
env.NO_COLOR = '1';
env.TEMP = scratch;
env.TMP = scratch;
mkdirSync(scratch, { recursive: true });
const write = (name, data) => writeFileSync(join(evidence, 'sidecar-' + name), data, { flag: 'wx' });
const config = join(scratch, 'vitest.config.mjs');
writeFileSync(config, `import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: ${JSON.stringify(root)},
  envDir: false,
  cacheDir: ${JSON.stringify(join(scratch, 'vite-cache'))},
  resolve: { alias: { '@': ${JSON.stringify(join(root, 'src'))} } },
  test: { include: [${JSON.stringify(test)}], environment: 'jsdom', maxWorkers: 1, fileParallelism: false, retry: 0 }
});
`, { flag: 'wx' });
write('vitest-config.mjs.snapshot', readFileSync(config));
write('source-before.tsx.snapshot', readFileSync(join(root, source)));
write('test-before.tsx.snapshot', readFileSync(join(root, test)));
write('existing-harness.tsx.snapshot', readFileSync(join(root, originalTest)));
const args = [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, test, '--maxWorkers', '1', '--reporter=verbose', '--reporter=json', '--outputFile=' + join(evidence, 'sidecar-focused-report.json')];
const freeBytes = freemem();
const fs = statfsSync(root);
const preflight = {
  recorded_at: new Date().toISOString(),
  scope: 'mocked jsdom saved-result export only',
  required_head: '89676dca7be49f4bf65afb44b036fce087934fc4',
  free_ram_bytes: freeBytes,
  free_ram_gib: freeBytes / 2 ** 30,
  total_ram_bytes: totalmem(),
  minimum_free_ram_bytes: 1.5 * 2 ** 30,
  disk_available_bytes: fs.bavail * fs.bsize,
  root_env_files: readdirSync(root).filter((name) => name.startsWith('.env') && name !== '.env.example'),
  env_keys: Object.keys(env),
  source_sha256: hash(source),
  test_sha256: hash(test),
  existing_test_sha256: hash(originalTest),
  command: [process.execPath, ...args],
  temp: scratch,
  config_loads_repo_env: false,
  max_workers: 1,
};
write('preflight.json', JSON.stringify(preflight, null, 2));
if (freeBytes < preflight.minimum_free_ram_bytes || preflight.root_env_files.length) {
  write('focused-run.json', JSON.stringify({ status: 'BLOCKED', reason: freeBytes < preflight.minimum_free_ram_bytes ? 'FREE_RAM_BELOW_1_5_GIB' : 'ROOT_ENV_FILE_PRESENT', test_process_started: false }, null, 2));
  console.log(JSON.stringify({ status: 'BLOCKED', free_ram_gib: preflight.free_ram_gib }));
  process.exitCode = 2;
} else {
  const started = new Date().toISOString();
  console.log(JSON.stringify({ status: 'STARTED', free_ram_gib: preflight.free_ram_gib, command: preflight.command }));
  const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', launchError = null;
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('error', (error) => { launchError = error.message; });
  child.on('close', (code, signal) => {
    write('focused-stdout.txt', stdout);
    write('focused-stderr.txt', stderr);
    const reportPath = join(evidence, 'sidecar-focused-report.json');
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
    const summary = { started, finished: new Date().toISOString(), exit_code: code, signal, launch_error: launchError, test_process_started: true, report_present: !!report, total_tests: report?.numTotalTests ?? null, passed_tests: report?.numPassedTests ?? null, failed_tests: report?.numFailedTests ?? null, source_unchanged_during_run: hash(source) === preflight.source_sha256, test_unchanged_during_run: hash(test) === preflight.test_sha256 };
    write('focused-run.json', JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    process.exitCode = code ?? 1;
  });
}
