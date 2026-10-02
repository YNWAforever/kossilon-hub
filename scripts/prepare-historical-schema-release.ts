// Offline preparation only: no database client, credentials or provider calls.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const quote = (value: string, tag: string) => {
  const delimiter = `$${tag}$`;
  if (value.includes(delimiter)) throw new Error("SQL delimiter collision; review source");
  return `${delimiter}${value}${delimiter}`;
};
export const readHistoricalContractBridge = () =>
  read("docs/audit-remediation/historical-contract-bridge.sql");

export function prepareHistoricalSchemaRelease() {
  const historical = JSON.parse(
    read("docs/audit-remediation/evidence/2026-10-02-historical-schema.json"),
  ) as {
    historical_source: string;
    historical_sources: Array<{ file: string; source_hash: string }>;
  };
  const catalog = JSON.parse(
    read("docs/audit-remediation/evidence/2026-10-02-historical-catalog-guard.json"),
  ) as { sql: string; catalog_sha256: string };
  const files = readdirSync(resolve(root, "db/migrations"))
    .filter((file) => /^00(?:6[7-9]|[78]\d)_.*\.sql$/.test(file))
    .sort();
  if (files.length !== 16 || historical.historical_sources.length !== 66)
    throw new Error("Release inventory changed; review plan");
  const adaptedInputs = [
    "0073_bulk_maintenance_job_kind.sql",
    "0074_reviewed_nar_apply.sql",
    "0080_manual_handoff_provenance.sql",
    "0082_case_template_snapshots.sql",
  ];
  const omissions: Record<string, string> = {
    "0074_reviewed_nar_apply.sql":
      "alter table nar_import_batches add column return_year integer check(return_year between 1900 and 2100);",
    "0082_case_template_snapshots.sql":
      "alter table checklist_templates add column revision integer not null default 1 check(revision>0);",
  };
  const inputs = files.map((file) => ({
    file,
    sha256: hash(read(`db/migrations/${file}`)),
    executedVerbatim: !adaptedInputs.includes(file),
  }));
  const steps = [
    readHistoricalContractBridge(),
    ...files.flatMap((file) => {
      if (file === adaptedInputs[0]) return [];
      let body = read(`db/migrations/${file}`);
      const omitted = omissions[file];
      if (omitted) {
        if (body.split(omitted).length !== 2)
          throw new Error(`Adapted input changed: ${file}; review required`);
        body = body.replace(
          omitted,
          "-- Existing column validated and preserved by historical-contract-bridge.sql.",
        );
      }
      if (file === "0080_manual_handoff_provenance.sql") {
        for (const existing of [
          "  add column external_reference text,",
          "  add column document_version_id uuid references document_versions(id),",
        ]) {
          if (body.split(existing).length !== 2)
            throw new Error("Handoff adapted input changed; review required");
          body = body.replace(existing, "-- Existing handoff column/FK validated and preserved.");
        }
      }
      return [`-- Source input: ${file}\n${body}`];
    }),
  ];
  const payload = steps
    .map((step, index) => `execute ${quote(step, `release_step_${index}`)};`)
    .join("\n");
  const manifest = {
    id: "kossilon-historical-release-20261002",
    historicalSource: historical.historical_source,
    historicalAppliedHashes: "unknown",
    inputs,
    adaptedInputs,
    bridgeSha256: hash(readHistoricalContractBridge()),
    payloadSha256: hash(payload),
    catalogSha256: catalog.catalog_sha256,
    compilerSha256: hash(read("scripts/prepare-historical-schema-release.ts")),
    normalization: "UTF-8 with LF; input hashes are provenance, never historical applied receipts",
    releaseDecision:
      "NO_GO: provider clone/restore, lineage policy, owners and runtime acceptance pending",
  };
  const expectedIds = historical.historical_sources.map((input) => input.file);
  const sql = `-- OFFLINE REVIEW PACKAGE. No authority to execute against a hosted database.\n-- Never feed this divergent history into db:migrate. Existing66 receipts remain unchanged.\nBEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='2min';\nSET LOCAL search_path=public;\nSELECT pg_advisory_xact_lock(hashtext('kossilon:schema-migrations'));\nLOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE;\nDO $historical_release$\nDECLARE before_ledger jsonb;\nBEGIN\n IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace=pg_my_temp_schema()) THEN\n  RAISE EXCEPTION 'Existing temporary objects; use a fresh isolated execution session';\n END IF;\n IF to_regclass('schema_release_receipts') IS NOT NULL THEN\n  RAISE EXCEPTION 'Historical release already recorded; do not replay or override an existing receipt table';\n END IF;\n SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_ledger FROM schema_migrations m;\n IF (SELECT jsonb_agg(id ORDER BY id) FROM schema_migrations) IS DISTINCT FROM ${literal(JSON.stringify(expectedIds))}::jsonb THEN\n  RAISE EXCEPTION 'Historical ledger changed; stop and review before DDL';\n END IF;\n IF (${catalog.sql}) IS DISTINCT FROM ${literal(catalog.catalog_sha256)} THEN\n  RAISE EXCEPTION 'Historical physical catalog changed; stop and review before DDL';\n END IF;\n ${payload}\n IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM schema_migrations m) IS DISTINCT FROM before_ledger THEN\n  RAISE EXCEPTION 'Historical ledger changed during release; roll back';\n END IF;\n CREATE TABLE schema_release_receipts (id text PRIMARY KEY,payload_sha256 text NOT NULL CHECK(length(payload_sha256)=64),manifest jsonb NOT NULL,executed_at timestamptz NOT NULL DEFAULT now());\n INSERT INTO schema_release_receipts(id,payload_sha256,manifest) VALUES(${literal(manifest.id)},${literal(manifest.payloadSha256)},${literal(JSON.stringify(manifest))}::jsonb);\nEND $historical_release$;\nCOMMIT;\n`;
  return { sql, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(prepareHistoricalSchemaRelease().sql);
}
