// One-run evidence harness. Run from the candidate root; never accepts a DB URL.
// Credentials stay in this run's ignored cache; reports contain no credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

const deliveryRun = "cosec-20261024-checklist-59870455"; const run = deliveryRun;
const root = realpathSync(process.cwd());
assert(root.toLowerCase() === "c:\\users\\laich\\documents\\kossilon-hub\\cosec-20261023");
const evidence = join(root, "docs/audit-remediation", deliveryRun, "db-final");
const cache = join(root, "node_modules/.cache", `${run}-db-final`);
const secretPath = join(cache, "owned-target.json"), envPath = join(cache, "container.env");
const image = "sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232";
const name = "kossilon-cosec-checklist-59870455-final", database = "cosec_checklist_59870455_final", username = "cosec_runner";
const report = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
function exec(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000, ...options });
  assert.equal(result.status, 0, `${program} failed (exit ${result.status}): ${result.stderr ?? result.error ?? ""}`);
  return result.stdout.trim();
}
const docker = (...args) => exec("docker", args);
function context() {
  for (const directory of [join(root, 'node_modules/.cache'), join(root, 'docs/audit-remediation', run)])
    assert.equal(realpathSync(directory), directory, 'Redirected run/cache parent');
  assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, "Docker endpoint overrides are forbidden.");
  assert.deepEqual(readdirSync(root).filter(f => f.startsWith(".env") && f !== ".env.example"), []);
  const endpoint = JSON.parse(docker("context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"));
  assert.equal(endpoint, "npipe:////./pipe/dockerDesktopLinuxEngine");
  assert.deepEqual(JSON.parse(docker("image", "inspect", image, "--format", "{{json .Id}}")), image);
  for (const file of [".env", ".env.local", ".env.test", ".env.test.local", ".dev.vars"])
    assert(!existsSync(join(root, file)), `Unexpected environment file ${file}`);
  return endpoint;
}
function gate(state) {
  const endpoint = context();
  assert.match(state.id, /^[a-f0-9]{64}$/);
  const [metadata] = JSON.parse(docker("inspect", state.id));
  assert.equal(metadata.Id, state.id);
  assert.equal(metadata.Name, "/" + name);
  assert.equal(metadata.Image, image);
  assert.equal(metadata.Config.Labels["codex.repo"], "kossilon-hub");
  assert.equal(metadata.Config.Labels["codex.run"], run);
  assert(metadata.State.Running);
  assert.deepEqual(metadata.Mounts, []);
  assert.equal(metadata.HostConfig.RestartPolicy.Name, "no");
  assert.equal(metadata.HostConfig.Memory, 536870912);
  assert.equal(metadata.HostConfig.NanoCpus, 1000000000);
  assert.equal(metadata.HostConfig.NetworkMode, "bridge");
  assert.equal(metadata.HostConfig.Tmpfs["/var/lib/postgresql/data"], "rw,noexec,nosuid,size=1g");
  const ports = metadata.NetworkSettings.Ports["5432/tcp"];
  assert.equal(ports.length, 1);
  assert.equal(ports[0].HostIp, "127.0.0.1");
  assert.match(ports[0].HostPort, /^\d{4,5}$/);
  const containerEnv = Object.fromEntries(metadata.Config.Env.map((entry) => { const i = entry.indexOf("="); return [entry.slice(0, i), entry.slice(i + 1)]; }));
  assert.equal(containerEnv.POSTGRES_DB, database);
  assert.equal(containerEnv.POSTGRES_USER, username);
  assert.equal(containerEnv.POSTGRES_PASSWORD, state.password);
  const receipt = { run_id: run, checked_utc: new Date().toISOString(), endpoint, container_id: state.id, image_id: image, database, port: Number(ports[0].HostPort), host: "127.0.0.1", mounts: [], tmpfs: metadata.HostConfig.Tmpfs, memory: metadata.HostConfig.Memory, labels: metadata.Config.Labels, restart: "no", target_verified_before_client: true };
  report("db-target-current.json", receipt);
  return { ...receipt, uri: `postgresql://${username}:${state.password}@127.0.0.1:${receipt.port}/${database}` };
}
async function probe(target, filename) {
  // Metadata gate above precedes even readiness checks and this dynamic import.
  for (let n = 0; n < 30; n++) {
    const ready = spawnSync("docker", ["exec", target.container_id, "pg_isready", "-U", username, "-d", database], { windowsHide: true, stdio: "ignore", timeout: 2000 });
    if (ready.status === 0) break;
    if (n === 29) throw new Error("Own verified container did not become ready.");
    await setTimeout(500);
  }
  const localSystemId = docker("exec", target.container_id, "psql", "-U", username, "-d", database, "-Atc", "select system_identifier from pg_control_system()");
  const { createSqlClient } = await import(pathToFileURL(join(root, "src/server/db/client.ts")).href);
  const sql = createSqlClient(target.uri, { ssl: false, max: 1 });
  try {
    const [identity] = await sql`select current_database() db,current_user username,inet_server_addr()::text server_address,inet_server_port() server_port,(select system_identifier::text from pg_control_system()) system_id`;
    assert.equal(identity.db, database); assert.equal(identity.username, username);
    assert.equal(identity.system_id, localSystemId);
    const counts = await sql`select table_name from information_schema.tables where table_schema='public' order by table_name`;
    report(filename, { run_id: run, checked_utc: new Date().toISOString(), identity, tcp_and_container_system_id_equal: true, public_tables: counts.map((r) => r.table_name) });
  } finally { await sql.end(); }
}
const action = process.argv[2];
if (action === "provision") {
  context(); mkdirSync(evidence, { recursive: false });
  assert(!existsSync(secretPath) && !existsSync(envPath), "Existing run must be inspected, never overwritten.");
  mkdirSync(cache, { recursive: false });
  const password = randomBytes(32).toString("hex");
  writeFileSync(envPath, `POSTGRES_USER=${username}\nPOSTGRES_DB=${database}\nPOSTGRES_PASSWORD=${password}\n`);
  const id = docker("run", "-d", "--pull=never", "--name", name, "--label", "codex.repo=kossilon-hub", "--label", `codex.run=${run}`, "--restart=no", "--memory=512m", "--cpus=1", "--network=bridge", "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=1g", "-p", "127.0.0.1::5432", "--env-file", envPath, image);
  writeFileSync(secretPath, JSON.stringify({ id, password }));
  const target = gate({ id, password });
  report("db-provision.json", { run_id: run, container_id: id, gate_passed: true, port: target.port, fixture_count: 0, migrations: 0 });
  console.log(`Provisioned and metadata-verified own container ${id}; no DB client started.`);
} else {
  const state = JSON.parse(readFileSync(secretPath, "utf8"));
  const target = gate(state);
  const keep = /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key))), DATABASE_URL: target.uri, TEST_DATABASE_URL: target.uri, DATABASE_SSL: "false", TEMP: cache, TMP: cache };
  if (action === "migrate") {
    await probe(target, "db-server-before-migrations.json");
    const output = exec(process.execPath, ["--experimental-strip-types", "scripts/db-migrate.ts"], { env, timeout: 120_000 });
    writeFileSync(join(evidence, "db-migrations.txt"), output + "\n");
    await probe(gate(state), "db-server-after-migrations.json");
    console.log("Own disposable schema migration committed; no application seed run.");
  } else if (action === "test") {
    const attempt = process.argv[3]; assert.match(attempt ?? "", /^[a-z0-9-]+$/);
    const { uri: secretUri, ...targetEvidence } = target;
    assert(secretUri);
    report(`db-target-${attempt}.json`, targetEvidence);
    await probe(target, `db-server-before-${attempt}.json`);
    env.COSEC_CHECKLIST_RUN_ID=run; env.COSEC_CHECKLIST_EVENTS_DIR=evidence; env.COSEC_CHECKLIST_ATTEMPT=attempt;
    env.COSEC_CHECKLIST_TARGET_ID=target.container_id; env.COSEC_CHECKLIST_DB_NAME=database;
    assert(!existsSync(join(evidence, 'db-checklist-'+attempt+'.txt')), 'Prior attempt must not be overwritten.');
    const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "db", "src/features/incorporation/checklist-recovery.integration.test.ts", "--maxWorkers", "1"], { env, cwd: root, encoding: "utf8", timeout: 240_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    writeFileSync(join(evidence, `db-checklist-${attempt}.txt`), (result.stdout ?? "") + (result.stderr ?? ""));
    report(`db-checklist-${attempt}.json`, { run_id: run, exit_code: result.status, signal: result.signal, error: result.error?.message ?? null });
    console.log(`Checklist DB test exit ${result.status}; exact row/cleanup IDs retained in log.`);
    process.exitCode = result.status ?? 1;
  } else if (action === "teardown") {
    await probe(target, "db-server-before-teardown.json");
    // Check run-owned rows were removed by the fixture before removing tmpfs.
    const result = docker("exec", state.id, "psql", "-U", username, "-d", database, "-Atc", "select json_build_object('companies',(select count(*) from companies),'cases',(select count(*) from annual_return_cases),'incorporation_cases',(select count(*) from incorporation_cases),'incorporation_items',(select count(*) from incorporation_checklist_items),'work_items',(select count(*) from work_items),'assignment_events',(select count(*) from assignment_events),'timeline',(select count(*) from timeline_events),'outbox',(select count(*) from notification_outbox),'users',(select count(*) from users),'teams',(select count(*) from teams),'payments',(select count(*) from payments),'entries',(select count(*) from payment_evidence_entries),'documents',(select count(*) from documents),'versions',(select count(*) from document_versions),'intents',(select count(*) from document_upload_intents),'scan_jobs',(select count(*) from document_scan_jobs),'audits',(select count(*) from annual_return_audit_events),'profiles',(select count(*) from staff_profiles),'officers',(select count(*) from officers),'contacts',(select count(*) from company_contacts),'controllers',(select count(*) from significant_controllers),'shareholdings',(select count(*) from shareholdings),'inspection_requests',(select count(*) from scr_inspection_requests),'bulk_jobs',(select count(*) from bulk_operation_jobs),'bulk_items',(select count(*) from bulk_operation_job_items),'bulk_previews',(select count(*) from bulk_operation_previews),'bulk_snapshots',(select count(*) from bulk_selection_snapshots))");
    const counts = JSON.parse(result);
    assert.equal(counts.users, state.foundation ? 1 : 0);
    assert(Object.entries(counts).filter(([key]) => key !== "users").every(([, n]) => n === 0), "Fixture residue: preserve container and investigate; no removal.");
    if (state.foundation) {
      const foundationRows = JSON.parse(docker("exec", state.id, "psql", "-U", username, "-d", database, "-Atc", "select json_build_object('users',(select json_agg(id order by id) from users),'calendars',(select json_agg(id order by id) from business_calendars),'policies',(select json_agg(id order by id) from sla_policies))"));
      assert.deepEqual(foundationRows, { users: [state.foundation.actorId], calendars: [state.foundation.calendarId], policies: [state.foundation.policyId] });
      report("db-foundation-final.json", { run_id: run, exact_retained_ids: foundationRows, removal: "whole owned tmpfs container only; no immutable trigger bypass" });
    }
    docker("rm", "-f", state.id);
    const remains = docker("ps", "-a", "--no-trunc", "--filter", `id=${state.id}`, "--format", "{{.ID}}");
    assert.equal(remains, "");
    report("db-cleanup.json", { run_id: run, container_id: state.id, own_row_counts_before_removal: counts, container_absent_after: true, credentials_removed: true, daemon_stopped: false });
    unlinkSync(secretPath); unlinkSync(envPath);
    console.log("Exact owned container removed after zero-row readback; credentials removed.");
  } else throw new Error("Expected provision, migrate, configure, test <attempt>, or teardown.");
}
