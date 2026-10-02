import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  prepareHistoricalSchemaRelease,
  readHistoricalContractBridge,
} from "./prepare-historical-schema-release";

const url = process.env.TEST_DATABASE_URL;
const sql = url
  ? postgres(url, {
      ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
      max: 1,
      onnotice: () => undefined,
    })
  : null;
afterAll(async () => {
  await sql?.end();
});
const legacyKinds = [
  "evaluateEscalations",
  "settleNotificationAttempts",
  "redactNotifications",
  "escalateStalledQuarantine",
  "runBulkOperations",
  "drainInboundMediaDownloads",
  "runNarImportStageJobs",
];
const rollback = new Error("owned bridge rollback");

async function fixture(run: (tx: postgres.TransactionSql) => Promise<void>) {
  if (!sql) throw new Error("Test database required");
  const schema = `historical_bridge_${randomUUID().replaceAll("-", "")}`;
  let verified = false;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`create schema ${schema}; set local search_path to ${schema}, pg_catalog;
        create table maintenance_job_runs (id integer primary key, job_kind text not null check(job_kind in (${legacyKinds.map((k) => `'${k}'`).join(",")})),state text not null);
        create table nar_import_batches (id integer primary key, return_year integer check(return_year between 1900 and 2100));
        create table checklist_templates (id integer primary key,revision integer not null default 1 check(revision>0));
        create table document_versions (id uuid primary key);
        create table handoff_returns (id integer primary key,external_reference text,document_version_id uuid references document_versions(id) on delete restrict);
        create table schema_migrations (id text primary key);
        insert into schema_migrations values ('0034_notification_delivery_attempts.sql');
        insert into maintenance_job_runs values (1,'runBulkOperations','unknown'),(2,'drainInboundMediaDownloads','started'),(3,'runNarImportStageJobs','claimed');
        insert into nar_import_batches values (1,2026),(2,null);
        insert into checklist_templates values (1,7);`);
      await run(tx);
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  expect(verified).toBe(true);
  expect((await sql`select to_regnamespace(${schema}) present`)[0].present).toBeNull();
}

it("builds an offline transaction with one honest package receipt and preserved input provenance", () => {
  const release = prepareHistoricalSchemaRelease();
  expect(release.manifest.inputs).toHaveLength(16);
  expect(release.manifest.adaptedInputs).toEqual([
    "0073_bulk_maintenance_job_kind.sql",
    "0074_reviewed_nar_apply.sql",
    "0080_manual_handoff_provenance.sql",
    "0082_case_template_snapshots.sql",
  ]);
  expect(release.sql).toContain("schema_release_receipts");
  expect(release.sql).not.toMatch(/insert into schema_migrations/i);
  expect(release.sql).toContain("Historical release already recorded; do not replay");
  expect(release.sql).toContain(release.manifest.payloadSha256);
  expect(release.sql).toMatch(/^--[\s\S]*\nBEGIN;[\s\S]*\nCOMMIT;\n$/);
});

describe.skipIf(!sql)("guarded historical contracts on real Postgres", () => {
  it("preserves legacy unknown work, chosen/null years and revision7 across repeat", async () => {
    await fixture(async (tx) => {
      const before = await tx`select * from maintenance_job_runs order by id`;
      const bridge = readHistoricalContractBridge();
      await tx.unsafe(bridge);
      await tx.unsafe(bridge);
      expect(await tx`select * from maintenance_job_runs order by id`).toEqual(before);
      expect(
        (await tx`select return_year from nar_import_batches order by id`).map(
          (r) => r.return_year,
        ),
      ).toEqual([2026, null]);
      expect((await tx`select revision from checklist_templates`)[0].revision).toBe(7);
      expect((await tx`select id from schema_migrations`).map((r) => r.id)).toEqual([
        "0034_notification_delivery_attempts.sql",
      ]);
      await tx`insert into maintenance_job_runs values (4,'runBulkAssignments','claimed')`;
      await expect(
        tx.savepoint(
          (nested) => nested`insert into maintenance_job_runs values (5,'inventedJob','claimed')`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
  for (const [name, mutation] of [
    [
      "unrecognised legacy job kind",
      "alter table maintenance_job_runs drop constraint maintenance_job_runs_job_kind_check; alter table maintenance_job_runs add check(job_kind<>'inventedJob')",
    ],
    [
      "unvalidated job check",
      "alter table maintenance_job_runs drop constraint maintenance_job_runs_job_kind_check; alter table maintenance_job_runs add check(job_kind in ('evaluateEscalations','settleNotificationAttempts','redactNotifications','escalateStalledQuarantine','runBulkOperations','drainInboundMediaDownloads','runNarImportStageJobs')) not valid",
    ],
    [
      "year type",
      "alter table nar_import_batches drop constraint nar_import_batches_return_year_check; alter table nar_import_batches alter return_year type text using return_year::text",
    ],
    ["year default", "alter table nar_import_batches alter return_year set default 2026"],
    [
      "year CHECK with OR",
      "alter table nar_import_batches drop constraint nar_import_batches_return_year_check; alter table nar_import_batches add check(return_year between 1900 and 2100 or return_year=9999)",
    ],
    [
      "unvalidated year check",
      "alter table nar_import_batches drop constraint nar_import_batches_return_year_check; alter table nar_import_batches add check(return_year between 1900 and 2100) not valid",
    ],
    ["revision default", "alter table checklist_templates alter revision set default 7"],
    [
      "revision CHECK",
      "alter table checklist_templates drop constraint checklist_templates_revision_check; alter table checklist_templates add check(revision>=0)",
    ],
    ["revision nullable", "alter table checklist_templates alter revision drop not null"],
    [
      "handoff reference type",
      "alter table handoff_returns alter external_reference type integer using null::integer",
    ],
    [
      "handoff version FK",
      "alter table handoff_returns drop constraint handoff_returns_document_version_id_fkey; alter table handoff_returns add foreign key(document_version_id) references document_versions(id) on delete cascade",
    ],
  ]) {
    it(`refuses ${name} before changing the job contract or ledger`, async () => {
      await fixture(async (tx) => {
        await tx.unsafe(mutation);
        const before =
          await tx`select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='maintenance_job_runs'::regclass and contype='c'`;
        await expect(
          tx.savepoint((nested) => nested.unsafe(readHistoricalContractBridge())),
        ).rejects.toMatchObject({ code: "P0001" });
        expect(
          await tx`select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='maintenance_job_runs'::regclass and contype='c'`,
        ).toEqual(before);
        expect((await tx`select count(*)::int n from schema_migrations`)[0].n).toBe(1);
      });
    });
  }
});
