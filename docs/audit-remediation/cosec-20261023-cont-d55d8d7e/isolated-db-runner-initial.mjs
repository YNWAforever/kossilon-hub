// One-run evidence harness. Run from the candidate root; never accepts a DB URL.
// Credentials stay in this run's ignored cache; reports contain no credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

const run = "cosec-20261023-cont-d55d8d7e";
const root = realpathSync(process.cwd());
assert(root.toLowerCase() === "c:\\users\\laich\\documents\\kossilon-hub\\cosec-20261023");
const evidence = join(root, "docs/audit-remediation", run);
const cache = join(root, "node_modules/.cache", `${run}-db`);
const secretPath = join(cache, "owned-target.json"), envPath = join(cache, "container.env");
const image = "sha256:f4c66b820c6f974249089d3d16d86a3698eae11e8746eb6644b2271031e91232";
const name = "kossilon-cosec-cont-d55d8d7e", database = "cosec_cont_d55d8d7e", username = "cosec_runner";
const report = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
function exec(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000, ...options });
  assert.equal(result.status, 0, `${program} failed (exit ${result.status}): ${result.stderr ?? result.error ?? ""}`);
  return result.stdout.trim();
}
const docker = (...args) => exec("docker", args);
function context() {
  assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, "Docker endpoint overrides are forbidden.");
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
  context();
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
  const env = { ...process.env, DATABASE_URL: target.uri, TEST_DATABASE_URL: target.uri, DATABASE_SSL: "false", KOSSILON_NAR_500_RUN_ID: run, TEMP: cache, TMP: cache };
  if (action === "migrate") {
    await probe(target, "db-server-before-migrations.json");
    const output = exec(process.execPath, ["--experimental-strip-types", "scripts/db-migrate.ts"], { env, timeout: 120_000 });
    writeFileSync(join(evidence, "db-migrations.txt"), output + "\n");
    await probe(gate(state), "db-server-after-migrations.json");
    console.log("Own disposable schema migration committed; no application seed run.");
  } else if (action === "configure") {
    await probe(target, "db-server-before-foundation.json");
    assert(!state.foundation, "Foundation already allocated; inspect its IDs instead of retrying.");
    const foundation = { actorId: randomUUID(), calendarId: randomUUID(), policyId: randomUUID() };
    state.foundation = foundation;
    writeFileSync(secretPath, JSON.stringify(state));
    report("db-foundation-planned.json", { run_id: run, ...foundation, reason: "annual_return_case requires an immutable active SLA calendar/policy; retained until exact tmpfs container removal" });
    const { createSqlClient } = await import(pathToFileURL(join(root, "src/server/db/client.ts")).href);
    const sql = createSqlClient(target.uri, { ssl: false, max: 1 });
    try {
      await sql.begin(async (tx) => {
        await tx`insert into users(id,name,email,role,active) values(${foundation.actorId},'Synthetic isolated SLA author',${foundation.actorId + '@example.test'},'Admin',true)`;
        const schedule = Object.fromEntries(["monday","tuesday","wednesday","thursday","friday"].map((day) => [day, [{ start: "09:00", end: "18:00" }]]));
        await tx`insert into business_calendars(id,name,weekly_schedule,effective_from,created_by) values(${foundation.calendarId},${run},${tx.json(schedule)},'2020-01-01',${foundation.actorId})`;
        await tx`insert into sla_policies(id,policy_key,version,name,work_type,business_calendar_id,warning_minutes,due_minutes,effective_from,created_by) values(${foundation.policyId},${run},1,'Synthetic isolated annual return SLA','annual_return_case',${foundation.calendarId},60,120,'2020-01-01',${foundation.actorId})`;
      });
    } finally { await sql.end(); }
    report("db-foundation-created.json", { run_id: run, ...foundation, synthetic: true, production_seed: false, cleanup: "immutable versions retained unchanged until exact owned container removal" });
    console.log("Exact run-owned SLA prerequisites created; no production or shared fixture touched.");
  } else if (action === "test") {
    await probe(target, "db-server-before-test.json");
    const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "db", "src/features/nar-import/scale.integration.test.ts", "--maxWorkers", "1"], { env, cwd: root, encoding: "utf8", timeout: 240_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    const attempt = process.argv[3]; assert.match(attempt ?? "", /^[a-z0-9-]+$/);
    writeFileSync(join(evidence, `db-500-${attempt}.txt`), (result.stdout ?? "") + (result.stderr ?? ""));
    report(`db-500-${attempt}.json`, { run_id: run, exit_code: result.status, signal: result.signal, error: result.error?.message ?? null });
    console.log(`500-row DB test exit ${result.status}; exact row/cleanup IDs retained in log.`);
    process.exitCode = result.status ?? 1;
  } else if (action === "teardown") {
    await probe(target, "db-server-before-teardown.json");
    // Check run-owned rows were removed by the fixture before removing tmpfs.
    const result = docker("exec", state.id, "psql", "-U", username, "-d", database, "-Atc", "select json_build_object('companies',(select count(*) from companies),'cases',(select count(*) from annual_return_cases),'jobs',(select count(*) from nar_apply_jobs),'batches',(select count(*) from nar_import_batches),'users',(select count(*) from users),'teams',(select count(*) from teams))");
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
