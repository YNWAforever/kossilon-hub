import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const evidence = import.meta.dirname;
const root = resolve(evidence, '../../..');
const source = 'src/components/bulk-selection-toolbar.tsx';
const test = 'src/components/bulk-export.interaction.test.tsx';
const originalTest = 'src/components/bulk-selection-toolbar.test.tsx';
const digest = (data) => createHash('sha256').update(data).digest('hex');
const write = (name, data) => writeFileSync(join(evidence, 'sidecar-' + name), data, { flag: 'wx' });
const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const head = git('rev-parse', 'HEAD').trim();
assert.equal(head, '89676dca7be49f4bf65afb44b036fce087934fc4');
assert.equal(digest(readFileSync(join(root, originalTest))), digest(readFileSync(join(evidence, 'sidecar-existing-harness.tsx.snapshot'))));
git('diff', '--check', '--', source);
write('source-after.tsx.snapshot', readFileSync(join(root, source)));
write('test-after.tsx.snapshot', readFileSync(join(root, test)));
write('source.patch', git('diff', '--', source));
const preflight = JSON.parse(readFileSync(join(evidence, 'sidecar-preflight.json'), 'utf8'));
const focused = JSON.parse(readFileSync(join(evidence, 'sidecar-focused-run.json'), 'utf8'));
const classification = {
  focused_invocations: 1,
  actual_result: { passed: 1, failed: 4, total: 5 },
  passed: ['blocks repeated clicks while the export RPC is pending and downloads only once'],
  product_red: [
    { case: 'saved job changes during pending export', observed: 'Blob constructor called with prior job CSV after changing to job B', cause: 'export success callback has no current job/session guard' },
    { case: 'actor changes during pending export', observed: 'Blob constructor called with prior actor CSV after the previous session unmounts', cause: 'hook-level mutation success callback still performs download side effects after unmount' },
  ],
  harness_failures: [
    { case: 'successful export CSV bytes', observed: 'expected Mock to be an instance of Blob', cause: 'vi.fn(class extends nativeBlob {}) did not return a native Blob instance', final_change: 'constructor function explicitly returns new nativeBlob(parts, options)' },
    { case: 'rejection and explicit retry', observed: 'rejection/no-Blob assertions passed; retried byte inspection failed at native Blob instance assertion', cause: 'same constructor double', final_change: 'same corrected constructor double' },
  ],
  final_source_change: 'Capture jobId and a scope identity at export click. Invalidate scope on job/actor changes and unmount. Discard a success callback whose captured scope is no longer current.',
  final_verification: 'NOT_RUN: user limited this sidecar to one focused invocation; parent owns final full unit/type/lint/build verification',
  green_log: null,
  discovery_failures: [
    'CIM Win32_OperatingSystem resource read was denied; no escalation attempted; actual free RAM gate used node:os.freemem',
    'No standalone vitest.config.ts/vitest.unit.config.ts exists; used standalone config with envDir:false instead of loading repository Vite plugins/env',
  ],
  no_db_auth_client_network_provider_container: true,
  no_commits_push_merge_deploy_index_upload: true,
};
write('classification.json', JSON.stringify(classification, null, 2));
write('green-status.json', JSON.stringify({ status: 'NOT_RUN_BY_SIDECAR', reason: 'ONE_FOCUSED_RUN_LIMIT', owner: 'parent final unit/type/lint/build', actual_green_log: null }, null, 2));
const files = [source, test, originalTest].map((path) => {
  const bytes = readFileSync(join(root, path));
  const text = bytes.toString('utf8');
  return { path, sha256: digest(bytes), bytes: bytes.length, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) };
});
const frozen = {
  status: 'FROZEN_FOR_PARENT_VERIFICATION',
  no_more_edits: true,
  frozen_at: new Date().toISOString(),
  head,
  test_cases: 5,
  source_numstat: git('diff', '--numstat', '--', source).trim(),
  diff_check_exit_code: 0,
  existing_test_unchanged: true,
  free_ram_bytes_at_only_run: preflight.free_ram_bytes,
  free_ram_gib_at_only_run: preflight.free_ram_gib,
  focused,
  files,
};
write('frozen.json', JSON.stringify(frozen, null, 2));
write('handoff.md', `# UC157 UI export sidecar frozen handoff

Status: FROZEN_FOR_PARENT_VERIFICATION. No more edits by sidecar.

Base HEAD: ${head}. New test: ${test} (5 cases). Minimal source change: ${source} (+17/-4).

The only focused run used maxWorkers=1, an environment whitelist, envDir:false, no repository Vite plugins, and unique ignored scratch storage. Actual free RAM immediately before launch: ${preflight.free_ram_gib.toFixed(9)} GiB (${preflight.free_ram_bytes} bytes), above the 1.5 GiB gate. All server RPCs are mocked, so no Auth or DB client is created. Browser fetch is guarded. No DB/network/provider/container/release action was performed.

Actual run: 1 passed, 4 failed. Pending repeated-click guard passed. Two product failures reproduced stale Blob creation after changing the saved job or actor. Two harness failures stopped the successful-download and explicit-retry cases at the native Blob instance assertion. Original stdout, stderr, JSON test report, preflight, and source/test snapshots are preserved without rewriting.

Prepared repair: capture the selected job and a session/job scope identity at click; invalidate that identity on job/actor change or unmount; skip Blob/download creation for stale results. The constructor double now explicitly returns a native Blob. Filename, actual CSV bytes including BOM/Unicode, URL revocation, no Blob/download on rejection, explicit retry, and repeated pending clicks remain asserted by the five cases.

No green test run has been performed for the repaired files because the user limited this sidecar to one focused invocation. Parent must run the final unit/type/lint/build checks and inspect all five cases. This handoff does not claim the repair passes or any integration/DB/role/financial acceptance.

Static checks: scoped git diff --check passed; both edited files were formatted using installed Prettier. Existing bulk-selection-toolbar.test.tsx is byte-for-byte unchanged. Parent-owned server-fns, result-export tests/SQL, registry, and documentation were not edited.

Frozen SHA256 fingerprints:
${files.map((file) => '- ' + file.path + ': ' + file.sha256 + ' (' + file.lines + ' lines; ' + file.bytes + ' bytes)').join('\n')}

See sidecar-classification.json for failure separation and sidecar-frozen.json for exact run/file counts. sidecar-manifest.json fingerprints every other sidecar evidence file at freeze time.
`);
const manifest = readdirSync(evidence).filter((name) => name.startsWith('sidecar-')).sort().map((name) => {
  const bytes = readFileSync(join(evidence, name));
  return { name, bytes: bytes.length, sha256: digest(bytes) };
});
write('manifest.json', JSON.stringify({ files: manifest, entries: manifest.length, excludes: ['sidecar-manifest.json'] }, null, 2));
console.log(JSON.stringify({ ...frozen, evidence_file_count: manifest.length + 1, manifest_sha256: digest(readFileSync(join(evidence, 'sidecar-manifest.json'))) }, null, 2));
