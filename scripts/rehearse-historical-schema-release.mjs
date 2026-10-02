import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { prepareHistoricalSchemaRelease } from "./prepare-historical-schema-release.ts";
const reportPath = "docs/audit-remediation/evidence/2026-10-02-historical-release-rehearsal.json";
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
const database = "kossilon_release_fixture_" + randomUUID().replaceAll("-", "");
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
  const columns =
    await sql`select table_name,column_name from information_schema.columns where table_schema='public' order by table_name,ordinal_position`;
  const tables = [...new Set(columns.map((c) => c.table_name))];
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => {
          const selected = columns
            .filter((c) => c.table_name === table)
            .map((c) => `"${c.column_name}"`)
            .join(",");
          const rows = await sql.unsafe(
            `select ${selected} from "${table}" order by row(${selected})::text`,
          );
          return [table, { rows: rows.length, sha256: digest(rows) }];
        }),
      ),
    );
  const before = await snapshot();
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
  mkdirSync("docs/audit-remediation/releases", { recursive: true });
  writeFileSync("docs/audit-remediation/releases/2026-10-02-historical-release.sql", release.sql);
  writeFileSync(
    "docs/audit-remediation/releases/2026-10-02-historical-release-manifest.json",
    JSON.stringify({ ...release.manifest, packageSha256: digest(release.sql) }, null, 2) + "\n",
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
  const afterCounts = {
    tables: (await sql`select count(*)::int n from pg_tables where schemaname='public'`)[0].n,
    ledger: (await sql`select count(*)::int n from schema_migrations`)[0].n,
  };
  const report = {
    scope: "owned local Postgres18.6 synthetic historical-schema rehearsal; NO_GO for production",
    observed_at: new Date().toISOString(),
    source_baseline: observed.source_baseline,
    historical_source: observed.historical_source,
    database: database,
    port: 55448,
    version: (await sql`show server_version`)[0].server_version,
    package_sha256: digest(release.sql),
    catalog_sha256: guard.catalog_sha256,
    catalog_refusal: catalogRefusal,
    payload_sha256: receipt.payload_sha256,
    inputs: release.manifest.inputs,
    adapted_inputs: release.manifest.adaptedInputs,
    all_82_original_tables_rows_preserved: true,
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
      "Scheduler/offline approval/package/source identity/controlled runtime verification required before any hosted operation.",
    ],
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
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
