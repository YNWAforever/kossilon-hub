import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { prepareHistoricalSchemaRelease } from "./prepare-historical-schema-release.ts";
import { readReleaseCatalog } from "../src/features/operations/release-catalog.ts";
import {
  captureRehearsalSourceIdentity,
  assertRehearsalSourceUnchanged,
} from "./rehearsal-source-identity.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const executionInputs = () => [
  "scripts/rehearse-historical-schema-release.mjs",
  "scripts/rehearsal-source-identity.ts",
  "scripts/prepare-historical-schema-release.ts",
  "src/features/operations/release-catalog.ts",
  "package.json",
  "package-lock.json",
  "bun.lock",
  "docs/audit-remediation/evidence/2026-10-02-historical-schema.json",
  "docs/audit-remediation/evidence/2026-10-02-historical-catalog-guard.json",
  "docs/audit-remediation/historical-contract-bridge.sql",
  "docs/audit-remediation/releases/2026-10-02-historical-release.sql",
  "docs/audit-remediation/releases/2026-10-02-historical-release-manifest.json",
  ...readdirSync(resolve(root, "db/migrations"))
    .filter((file) => /^00(?:6[7-9]|[78]\d)_.*\.sql$/.test(file))
    .map((file) => `db/migrations/${file}`),
];
const executionSource = captureRehearsalSourceIdentity(root, executionInputs());
const reportPath =
  process.env.HISTORICAL_RELEASE_REHEARSAL_REPORT ??
  `docs/audit-remediation/evidence/2026-10-03-historical-release-rehearsal-${randomUUID()}.json`;
const evidenceRoot = resolve("docs/audit-remediation/evidence") + sep;
assert.ok(
  resolve(reportPath).startsWith(evidenceRoot) && reportPath.endsWith(".json"),
  "New report must stay inside the evidence directory",
);
assert.ok(!existsSync(reportPath), "Never overwrite prior evidence");
const observed = JSON.parse(
  readFileSync("docs/audit-remediation/evidence/2026-10-02-historical-schema.json", "utf8"),
);
const connection = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(connection.hostname), "Owned loopback runtime only");
assert.equal(
  connection.port,
  "55448",
  "Use the inspected kossilon-release-pg18-20261002 container",
);
const database = "kossilon_rel_" + randomUUID().replaceAll("-", "");
const admin = postgres(connection.toString(), { ssl: false, max: 1, onnotice: () => {} });
assert.match(
  (await admin`show server_version`)[0].server_version,
  /^18\./,
  "Historical catalog guard requires Postgres18",
);
await admin.unsafe(`create database "${database}" template template0`);
await admin.end();
connection.pathname = "/" + database;
const sql = postgres(connection.toString(), { ssl: false, max: 1, onnotice: () => {} });
await sql.begin(async (tx) => {
  await tx`create table schema_migrations(id text primary key,applied_at timestamptz not null default now())`;
  for (const source of observed.historical_sources) {
    const bytes = execFileSync("git", [
      "show",
      `${observed.historical_source}:db/migrations/${source.file}`,
    ]);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.source_hash,
      "Exact historical git provenance required",
    );
    await tx.unsafe(bytes.toString("utf8"));
    await tx`insert into schema_migrations(id) values(${source.file})`;
  }
});
await sql`insert into nar_import_batches(source_file_name,source_sha256,source_size_bytes,sheet_name,parser_version,return_year) values('synthetic-release-contract.xlsx',${"a".repeat(64)},1,'NAR','synthetic-local-only',2026)`;
const digest = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
try {
  assert.equal(
    (await sql`select to_regclass('schema_release_receipts') present`)[0].present,
    null,
    "owned fixture has no prior release receipt",
  );
  if (
    (
      await sql`select count(*)::int n from maintenance_job_runs where run_id like 'synthetic-local-%'`
    )[0].n === 0
  )
    await sql`insert into maintenance_job_runs(scheduled_for,job_kind,trigger_source,run_id,state,claimed_at,lease_expires_at,started_at) values(now(),'runBulkOperations','manual',${`synthetic-local-${randomUUID()}`},'unknown',now(),now(),now())`;
  await sql`insert into checklist_templates(name,service_type,revision) values('Synthetic release preservation','Annual Return — Private Ltd',7) on conflict(name) do nothing`;
  const owner = randomUUID(),
    team = randomUUID(),
    company = randomUUID(),
    completedCase = randomUUID(),
    unknownCase = randomUUID();
  await sql`insert into users(id,name,email,role) values(${owner},'Synthetic release owner','release-owner@example.test','Admin')`;
  await sql`insert into teams(id,name) values(${team},'Synthetic release team')`;
  await sql`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin) values(${company},'Synthetic release preservation','SYNTHETIC-CR','SYNTHETIC-BR','2020-01-01','2020-01-01','Synthetic only','Synthetic only',${owner},${team},'fixture')`;
  for (const [id, year] of [
    [completedCase, 2026],
    [unknownCase, 2027],
  ])
    await sql`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,owner_id) values(${id},${company},${year},'2026-01-01','2026-02-12','Upcoming',${owner})`;
  for (const status of ["returned", "cancelled"])
    await sql`insert into package_handoffs(case_id,manifest_sha256,manifest_payload,approved_by,released_by,status,transmitted_at) values(${completedCase},${"a".repeat(64)},'{}',${owner},${owner},${status},${status === "returned" ? new Date() : null})`;
  await sql`insert into package_handoffs(case_id,manifest_sha256,manifest_payload,approved_by,released_by,status) values(${unknownCase},${"b".repeat(64)},'{}',${owner},${owner},'failed')`;
  const columns =
    await sql`select table_name,column_name from information_schema.columns where table_schema='public' order by table_name,ordinal_position`;
  const tables = [...new Set(columns.map((c) => c.table_name))];
  const snapshot = async (reader = sql) =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => {
          const selected = columns
            .filter((c) => c.table_name === table)
            .map((c) => `"${c.column_name}"`)
            .join(",");
          const rows = await reader.unsafe(
            `select ${selected} from "${table}" order by row(${selected})::text`,
          );
          return [table, { rows: rows.length, sha256: digest(rows) }];
        }),
      ),
    );
  const before = await snapshot();
  const beforeCatalog = await readReleaseCatalog(sql);
  const restoredDatabase = `${database}_restore`;
  const dumpPath = `/tmp/${database}.dump`;
  const container = "kossilon-release-pg18-20261002";
  execFileSync("docker", [
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-Fc",
    "-f",
    dumpPath,
    database,
  ]);
  const dumpSha256 = execFileSync("docker", ["exec", container, "sha256sum", dumpPath], {
    encoding: "utf8",
  }).split(" ")[0];
  execFileSync("docker", [
    "exec",
    container,
    "createdb",
    "-U",
    "postgres",
    "-T",
    "template0",
    restoredDatabase,
  ]);
  execFileSync("docker", [
    "exec",
    container,
    "pg_restore",
    "-U",
    "postgres",
    "--exit-on-error",
    "--no-owner",
    "-d",
    restoredDatabase,
    dumpPath,
  ]);
  const restoredUrl = new URL(connection);
  restoredUrl.pathname = `/${restoredDatabase}`;
  const restored = postgres(restoredUrl.toString(), { ssl: false, max: 1, onnotice: () => {} });
  try {
    assert.deepEqual(
      await snapshot(restored),
      before,
      "All original rows and ledger must restore exactly",
    );
    assert.deepEqual(
      await readReleaseCatalog(restored),
      beforeCatalog,
      "Full physical catalog, original ledger and effective role privileges must restore exactly",
    );
  } finally {
    await restored.end();
  }
  const guard = JSON.parse(
    readFileSync(
      "docs/audit-remediation/evidence/2026-10-02-historical-catalog-guard.json",
      "utf8",
    ),
  );
  assert.equal(
    (await sql.unsafe(guard.sql))[0].catalog_sha256,
    guard.catalog_sha256,
    "Full historical physical fingerprint must match provider snapshot",
  );
  const release = prepareHistoricalSchemaRelease();
  assert.equal(
    readFileSync("docs/audit-remediation/releases/2026-10-02-historical-release.sql", "utf8"),
    release.sql,
    "Frozen reviewed SQL must match; rehearsal cannot rewrite it",
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        "docs/audit-remediation/releases/2026-10-02-historical-release-manifest.json",
        "utf8",
      ),
    ),
    { ...release.manifest, packageSha256: digest(release.sql) },
    "Frozen manifest must match; stop on drift",
  );
  let catalogRefusal;
  await sql.unsafe(
    "begin; alter table nar_import_batches add column synthetic_unexpected_catalog text",
  );
  try {
    await sql.unsafe(release.sql);
  } catch (error) {
    catalogRefusal = { code: error.code, message: error.message };
    await sql.unsafe("rollback");
  }
  assert.equal(
    catalogRefusal?.message,
    "Historical physical catalog changed; stop and review before DDL",
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal((await sql`select to_regclass('schema_release_receipts') present`)[0].present, null);
  let failure;
  try {
    await sql.unsafe(
      release.sql.replace(
        "CREATE TABLE schema_release_receipts",
        "RAISE EXCEPTION 'synthetic failure before receipt';\n CREATE TABLE schema_release_receipts",
      ),
    );
  } catch (error) {
    failure = { code: error.code, message: error.message };
    await sql.unsafe("rollback");
  }
  assert.equal(failure?.message, "synthetic failure before receipt");
  assert.deepEqual(await snapshot(), before);
  assert.equal((await sql`select to_regclass('nar_apply_jobs') present`)[0].present, null);
  assert.equal((await sql`select to_regclass('schema_release_receipts') present`)[0].present, null);
  await sql.unsafe(release.sql);
  assert.deepEqual(await snapshot(), before);
  const handoffProofRollback = new Error("synthetic handoff proof rollback");
  try {
    await sql.begin(async (tx) => {
      await tx`insert into package_handoffs(case_id,manifest_sha256,manifest_payload,approved_by,released_by,status) values(${completedCase},${"a".repeat(64)},'{}',${owner},${owner},'prepared')`;
      let refused;
      try {
        await tx.savepoint(
          (nested) =>
            nested`insert into package_handoffs(case_id,manifest_sha256,manifest_payload,approved_by,released_by,status) values(${unknownCase},${"b".repeat(64)},'{}',${owner},${owner},'prepared')`,
        );
      } catch (error) {
        refused = error.code;
      }
      assert.equal(refused, "23505", "Legacy unknown attempt must remain outstanding");
      throw handoffProofRollback;
    });
  } catch (error) {
    if (error !== handoffProofRollback) throw error;
  }
  assert.deepEqual(await snapshot(), before);
  const [receipt] = await sql`select id,payload_sha256,manifest from schema_release_receipts`;
  assert.equal(receipt.payload_sha256, release.manifest.payloadSha256);
  assert.equal(receipt.id, release.manifest.id);
  let repeat;
  try {
    await sql.unsafe(release.sql);
  } catch (error) {
    repeat = { code: error.code, message: error.message };
    await sql.unsafe("rollback");
  }
  assert.equal(repeat?.code, "P0001");
  assert.match(repeat.message, /already recorded; do not replay/);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await sql`select count(*)::int n from schema_release_receipts`)[0].n, 1);
  const afterCatalog = await readReleaseCatalog(sql);
  assert.equal(
    afterCatalog.historicalLedgerSha256,
    beforeCatalog.historicalLedgerSha256,
    "Original ledger remains unchanged, including applied times",
  );
  assert.notEqual(
    afterCatalog.catalogSha256,
    beforeCatalog.catalogSha256,
    "Post-release fingerprint is a new actual observation, not the pre-release guard",
  );
  const afterCounts = {
    tables: (await sql`select count(*)::int n from pg_tables where schemaname='public'`)[0].n,
    ledger: (await sql`select count(*)::int n from schema_migrations`)[0].n,
  };
  const report = {
    scope: "owned local Postgres18.6 synthetic historical-schema rehearsal; NO_GO for production",
    observed_at: new Date().toISOString(),
    source_baseline: observed.source_baseline,
    historical_source: observed.historical_source,
    execution_source: executionSource,
    database: database,
    port: 55448,
    version: (await sql`show server_version`)[0].server_version,
    package_sha256: digest(release.sql),
    catalog_sha256: guard.catalog_sha256,
    complete_catalog_before: beforeCatalog,
    complete_catalog_after: afterCatalog,
    restore: {
      database: restoredDatabase,
      dumpPath,
      dumpSha256,
      original_rows_ledger_catalog_verified: true,
      hosted_restore: "not_run",
    },
    catalog_refusal: catalogRefusal,
    payload_sha256: receipt.payload_sha256,
    inputs: release.manifest.inputs,
    adapted_inputs: release.manifest.adaptedInputs,
    all_82_original_tables_rows_preserved: true,
    handoff_history: {
      completed_same_manifest_preserved: 2,
      legacy_unknown_attempt_preserved: 1,
      new_attempt_after_completed_allowed: true,
      new_attempt_while_unknown_refused: "23505",
    },
    before,
    after: afterCounts,
    forced_failure: {
      ...failure,
      rollback_original_rows_ledger: true,
      no_new_tables_or_receipt: true,
    },
    repeat: { ...repeat, no_replay_or_extra_receipt: true },
    historical_ledger_rows: 66,
    historical_hashes: "unknown; not populated",
    receipt_rows: 1,
    provider_writes: 0,
    command: "node --experimental-strip-types scripts/rehearse-historical-schema-release.mjs",
    limitations: [
      "Not a provider clone, production restore, true workload or runtime UAT.",
      "Historical migration ledger intentionally unchanged; strict source history diagnostics still report divergence.",
      "Seven unattributed production tables and non-FK dependencies require owner review.",
      "Scheduler/offline approval/deployed artifact identity/controlled runtime verification required before any hosted operation.",
      "Execution source hashes describe local files and lock inputs, not an installed dependency SBOM or hosted release approval.",
    ],
  };
  assertRehearsalSourceUnchanged(
    executionSource,
    captureRehearsalSourceIdentity(root, executionInputs()),
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        all_82_original_tables_rows_preserved: true,
        forced_failure: failure,
        repeat,
        after: afterCounts,
        receipt_rows: 1,
        provider_writes: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
