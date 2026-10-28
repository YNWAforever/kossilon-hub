import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const folder = import.meta.dirname;
const read = path => JSON.parse(readFileSync(join(folder, path), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function parseCsv(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (!quoted && c === '\r') { /* CRLF delimiter only */ }
    else cell += c;
  }
  assert.equal(quoted, false);
  assert.equal(cell, ''); assert.equal(row.length, 0);
  assert.deepEqual(rows.shift(), ['item', 'state', 'reason', 'attempts', 'output_json']);
  return rows.map(row => { assert.equal(row.length, 5); return { item: row[0], state: row[1], reason: row[2], attempts: Number(row[3]), output: row[4] ? JSON.parse(row[4]) : null }; });
}
const cases = [];
for (const attempt of ['initial', 'final']) {
  assert.equal(read(`db/db-export-${attempt}.json`).exit_code, 0);
  const eventsPath = `db/UC157-${attempt}.jsonl`;
  const events = readFileSync(join(folder, eventsPath), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const one = phase => { const found = events.filter(e => e.phase === phase); assert.equal(found.length, 1, phase); return found[0]; };
  const ids = one('planned-ids').ids;
  const sessions = one('physical-sessions'); assert.notEqual(sessions.writerPid, sessions.readerPid);
  const money = phase => { const { phase: _, ...value } = one(phase); return value; };
  const before = money('money-before-export');
  assert.deepEqual(money('money-after-export'), before);
  assert.deepEqual(money('money-final'), before);
  assert.equal(before.outbox, 0); assert.equal(before.payments.length, 104);
  assert.equal(before.entries.length, 2); assert.equal(before.audits.length, 6);
  const artifacts = {};
  for (const name of ['complete', 'redacted', 'cancelled']) {
    const artifact = events.find(e => e.phase === 'csv-artifact' && e.name === name);
    assert(artifact); const bytes = readFileSync(join(folder, artifact.path));
    assert.equal(hash(bytes), artifact.sha256); assert.equal(bytes.length, artifact.bytes);
    const rows = parseCsv(bytes.toString('utf8')); assert.equal(rows.length, 103);
    artifacts[name] = { path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, rows };
  }
  const complete = artifacts.complete.rows;
  assert.deepEqual(complete.map(row => row.item).sort(), ids.cases.slice(0, 103).sort());
  assert(complete.every(row => row.state === 'succeeded' && row.output.currency === 'HKD' && row.output.approvalPerformed === false));
  assert(!readFileSync(join(folder, artifacts.complete.path), 'utf8').includes('PRIVATE_FIXTURE'));
  const totals = complete.reduce((t, row) => ({ invoice: t.invoice + row.output.amount, received: t.received + row.output.receivedAmount, balance: t.balance + row.output.balance }), { invoice: 0, received: 0, balance: 0 });
  assert.deepEqual(totals, { invoice: 185400, received: 2150.25, balance: 183249.75 });
  assert.deepEqual(one('complete-export').totals, totals); assert.equal(one('complete-export').pages, 2);
  assert.equal(one('selection-snapshot').count, 103); assert.equal(one('preview').eligibleCount, 103);
  assert.equal(one('same-key-replay').jobId, one('job-created').jobId);
  const redacted = artifacts.redacted.rows;
  const hidden = redacted.filter(row => row.state === 'forbidden');
  assert.equal(hidden.length, 1); assert.equal(hidden[0].item, ''); assert.equal(hidden[0].reason, 'access_denied'); assert.equal(hidden[0].output, null);
  assert.equal(redacted.filter(row => row.output).length, 102);
  assert(!readFileSync(join(folder, artifacts.redacted.path), 'utf8').includes(ids.cases[0]));
  assert.equal(events.filter(e => e.phase === 'role-denied').length, 3); one('persisted-identity-denied');
  assert.equal(one('progress-between-pages').processed, 1);
  assert.equal(one('changing-export-refused').error.statusCode, 409);
  assert.equal(one('changing-export-refused').advanced, true);
  const cancelled = artifacts.cancelled.rows;
  assert.equal(cancelled.filter(row => row.state === 'succeeded').length, 1);
  assert.equal(cancelled.filter(row => row.state === 'cancelled' && row.output === null).length, 102);
  assert.equal(one('cancelled').cancelledCount, 102);
  assert.deepEqual(one('cancelled-retry').resumed, { processed: 0, claimed: false });
  assert.equal(one('cancelled-retry').unchanged, true);
  assert(Object.values(one('cleanup').remaining).every(count => count === 0));
  cases.push({ attempt, events: eventsPath, sql_tests_passed: 1, pages: 2, scope: 103, excluded_fixture: 1, totals_hkd: totals,
    money_rows: 104, receipt_entries: 2, audit_events: 6, payment_entries_audits_unchanged: true, outbox: 0,
    redacted_rows: 1, disclosed_outputs: 102, supplied_role_denials: 3, persisted_profile_denial: true,
    separate_sql_sessions: sessions, between_page_progress: 1, conflict_status: 409, partial_csv_returned: false,
    cancelled: 102, committed_before_cancel: 1, resumed_processed: 0, cancelled_retry_byte_equal: true,
    fixture_cleanup: one('cleanup').remaining,
    csv: Object.fromEntries(Object.entries(artifacts).map(([name, { rows, ...artifact }]) => [name, { ...artifact, row_count: rows.length }])) });
}
const cleanup = read('cleanup-final.json');
assert(cleanup.container_absent && cleanup.credentials_absent && cleanup.preexisting_count === 313 && cleanup.preexisting_missing.length === 0);
const dbCleanup = read('db/db-cleanup.json');
for (const [table, count] of Object.entries(dbCleanup.own_row_counts_before_removal)) assert.equal(count, table === 'users' ? 1 : 0);
const identity = read('db/db-server-before-teardown.json');
assert.equal(identity.identity.system_id, '7699935043524436008'); assert(identity.tcp_and_container_system_id_equal);
const summary = { run_id: 'cosec-20261024-export-9dd9e445', cases,
  container_removed: true, credentials_removed: true, preexisting_containers_preserved: 313,
  native_auth_http_rls_browser: 'BLOCKED_NOT_RUN', scanner_storage: 'LOCAL_CONTRACT_STUB_ONLY', release_gate: 'NO_GO' };
if (process.argv.includes('--verify')) assert.deepEqual(read('readback-summary.json'), summary);
else writeFileSync(join(folder, 'readback-summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log('Verified both SQL attempts, six CSV files, money/audit equality, denials/conflict/cancel/replay, exact fixture cleanup and target removal.');
