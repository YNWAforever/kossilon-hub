import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
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
        create table handoff_returns (id integer primary key,handoff_id uuid,external_reference text,document_version_id uuid references document_versions(id) on delete restrict);
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
  it("retains multiple completed handoffs but rejects a second outstanding unknown attempt", async () => {
    await fixture(async (tx) => {
      await tx.unsafe(`create table users(id uuid primary key); create table documents(id uuid primary key);
        create table package_handoffs(id uuid primary key,case_id uuid not null,manifest_sha256 text not null,manifest_payload text not null,approved_by uuid,status text not null,destination_reference text);
        create unique index package_handoffs_live_uidx on package_handoffs(case_id) where status in ('prepared','transmitted','acknowledged');
        insert into package_handoffs values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000009',repeat('a',64),'{}',null,'returned',null),
        ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000009',repeat('a',64),'{}',null,'cancelled',null);`);
      const release = prepareHistoricalSchemaRelease();
      const blocks = release.sql.match(/\$release_step_\d+\$[\s\S]*?\$release_step_\d+\$/g)!;
      for (const file of [
        "0080_manual_handoff_provenance.sql",
        "0081_handoff_attempt_idempotency.sql",
      ]) {
        const block = blocks.find((body) => body.includes(`-- Source input: ${file}`))!;
        await tx.unsafe(block.replace(/^\$release_step_\d+\$|\$release_step_\d+\$$/g, ""));
      }
      expect((await tx`select count(*)::int n from package_handoffs`)[0].n).toBe(2);
      await tx`insert into package_handoffs(id,case_id,manifest_sha256,manifest_payload,status,delivery_fact) values(${randomUUID()},'00000000-0000-0000-0000-000000000009',${"a".repeat(64)},'{}','failed','unknown')`;
      await expect(
        tx.savepoint(
          (nested) =>
            nested`insert into package_handoffs(id,case_id,manifest_sha256,manifest_payload,status) values(${randomUUID()},'00000000-0000-0000-0000-000000000009',${"a".repeat(64)},'{}','prepared')`,
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });
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

describe.skipIf(!sql)("historical release enforcement and DDL serialization", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL(
        "../docs/audit-remediation/evidence/2026-10-02-historical-catalog-guard.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { sql: string; tables?: string[] };
  async function schemaFixture(run: (schema: string) => Promise<void>) {
    if (!sql) throw Error("Test database required");
    const schema = `historical_fence_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql.unsafe(`create schema ${schema};set search_path to ${schema},pg_catalog`);
      await run(schema);
    } finally {
      await sql.unsafe("rollback");
      await sql.unsafe(`drop schema ${schema} cascade;reset search_path`);
    }
  }
  const fingerprint = async (schema: string) =>
    (await sql!.unsafe(catalog.sql.replaceAll("'public'", `'${schema}'`)))[0].catalog_sha256;
  it("detects disabled immutability enforcement with the same trigger definition", async () => {
    await schemaFixture(async (schema) => {
      await sql!.unsafe(
        `create table checklist_template_versions(id integer);create function refuse_template_version_change() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;create trigger immutable before update on checklist_template_versions for each row execute function refuse_template_version_change();`,
      );
      const before = await fingerprint(schema);
      await sql!.unsafe("alter table checklist_template_versions disable trigger immutable");
      expect(await fingerprint(schema)).not.toBe(before);
    });
  });
  it("detects a genuinely failed concurrent unique index with the same definition", async () => {
    await schemaFixture(async (schema) => {
      await sql!.unsafe(
        "create table nar_import_batches(id integer);create unique index nar_import_batches_legacy_identity_idx on nar_import_batches(id)",
      );
      const before = await fingerprint(schema);
      await sql!.unsafe(
        "drop index nar_import_batches_legacy_identity_idx;insert into nar_import_batches values(1),(1)",
      );
      await expect(
        sql!.unsafe(
          "create unique index concurrently nar_import_batches_legacy_identity_idx on nar_import_batches(id)",
        ),
      ).rejects.toMatchObject({ code: "23505" });
      expect(
        (
          await sql!`select indisvalid from pg_index where indexrelid='nar_import_batches_legacy_identity_idx'::regclass`
        )[0].indisvalid,
      ).toBe(false);
      expect(await fingerprint(schema)).not.toBe(before);
    });
  });
  it("blocks incompatible parallel table DDL and cooperating function DDL before catalog validation", async () => {
    await schemaFixture(async (schema) => {
      const names =
        catalog.tables ??
        [...catalog.sql.matchAll(/'([a-z_]+)'/g)]
          .map((r) => r[1])
          .filter(
            (n) =>
              ![
                "public",
                "columns",
                "indexes",
                "constraints",
                "functions",
                "triggers",
                "table",
                "name",
                "type",
                "nullable",
                "default",
                "definition",
              ].includes(n),
          );
      for (const table of new Set([...names, "schema_migrations", "document_findings"]))
        await sql!.unsafe(`create table if not exists ${table}(id text)`);
      const prefix = prepareHistoricalSchemaRelease()
        .sql.split("DO $historical_release$")[0]
        .replaceAll("search_path=public", `search_path=${schema}`)
        .replaceAll("public.", `${schema}.`);
      await sql!.unsafe(prefix);
      const other = postgres(url!, {
        ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
        max: 1,
        onnotice: () => undefined,
      });
      try {
        await other.unsafe("set lock_timeout='100ms'");
        await expect(
          other.unsafe(`alter table ${schema}.document_findings add column evidence text`),
        ).rejects.toMatchObject({ code: "55P03" });
        await expect(
          other.unsafe("select pg_advisory_xact_lock(hashtext('kossilon:schema-migrations'))"),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await other.end();
        await sql!.unsafe("rollback");
      }
    });
  });
});
