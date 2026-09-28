import { describe, expect, it } from "vitest";
import { inspectSchemaCompatibility } from "../src/features/operations/schema-compatibility";
import { EXPECTED_MIGRATIONS } from "../src/features/operations/schema-health";

const emptyCatalog = { tables: [], columns: {}, indexes: {}, constraints: {} };

describe("T01 schema compatibility release gate", () => {
  it("t01_scenario_1 keeps an unknown historical migration visible and refuses a missing ledger", () => {
    const historical = inspectSchemaCompatibility({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: true, applied: [...EXPECTED_MIGRATIONS, "0006_client_register.sql"] },
      catalog: emptyCatalog,
    });
    expect(historical.unknown).toEqual(["0006_client_register.sql"]);
    expect(historical.canRelease).toBe(false);
    expect(historical.canMigrateAutomatically).toBe(false);

    const noLedger = inspectSchemaCompatibility({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: false, applied: [] },
      catalog: emptyCatalog,
    });
    expect(noLedger.ledgerState).toBe("no-ledger");
    expect(noLedger.missing).toEqual([]);
    expect(noLedger.canRelease).toBe(false);
  });

  it("t01_scenario_3 reports missing Documents, Payments, parties, analysis, maintenance and package capabilities", () => {
    const report = inspectSchemaCompatibility({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: true, applied: [...EXPECTED_MIGRATIONS] },
      catalog: emptyCatalog,
    });
    expect(Object.keys(report.requiredCapabilities).sort()).toEqual([
      "analysis",
      "documents",
      "maintenance",
      "media",
      "packages",
      "parties",
      "payments",
      "returns",
      "staff",
      "submissions",
      "templates",
    ]);
    for (const capability of Object.values(report.requiredCapabilities)) {
      expect(capability.ready).toBe(false);
      expect(capability.issues.length).toBeGreaterThan(0);
    }
    expect(report.definitionMismatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact: "table:document_versions" }),
        expect.objectContaining({ artifact: "table:payments" }),
        expect.objectContaining({ artifact: "table:case_parties" }),
        expect.objectContaining({ artifact: "table:document_analysis_jobs" }),
        expect.objectContaining({ artifact: "table:maintenance_runs" }),
        expect.objectContaining({ artifact: "column:package_handoffs.proof_version_id" }),
        expect.objectContaining({ artifact: "table:filing_return_source_objects" }),
      ]),
    );
    expect(report.canRelease).toBe(false);
  });

  it("t01_scenario_3 detects a wrong column type or missing index despite a current ledger", () => {
    const report = inspectSchemaCompatibility({
      expected: EXPECTED_MIGRATIONS,
      ledger: { present: true, applied: [...EXPECTED_MIGRATIONS] },
      catalog: {
        tables: ["payments", "maintenance_runs"],
        columns: { "payments.payment_proof_document_id": "text" },
        indexes: {},
        constraints: {},
      },
    });
    expect(report.definitionMismatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact: "column:payments.payment_proof_document_id" }),
        expect.objectContaining({ artifact: "index:maintenance_runs_recent_idx" }),
      ]),
    );
    expect(report.requiredCapabilities.payments.ready).toBe(false);
    expect(report.canRelease).toBe(false);
  });
});

// This test writes only inside a rolled-back transaction on a loopback TEST_DATABASE_URL.
// CI supplies localhost Postgres; a remote URL deliberately cannot run this rehearsal.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const testUrl = process.env.TEST_DATABASE_URL;
const isLoopback = testUrl && ["localhost", "127.0.0.1", "::1"].includes(new URL(testUrl).hostname);
const rollbackMarker = new Error("t01-rehearsal-rollback");
const migrationDir = join(process.cwd(), "db", "migrations");

async function rehearse(upgrade: boolean): Promise<void> {
  const sql = postgres(testUrl!, { ssl: false, max: 1 });
  const schema = `t01_rehearsal_${process.pid}_${Math.random().toString(16).slice(2, 10)}`;
  try {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`create schema ${schema}`);
        await tx.unsafe(`set local search_path to ${schema}, public`);
        const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
        const apply = async (file: string) =>
          tx.unsafe(await readFile(join(migrationDir, file), "utf8"));
        for (const file of files.filter((name) => name < "0021")) await apply(file);

        if (upgrade) {
          await tx.unsafe(`
          insert into teams (id, name) values ('11111111-1111-4111-8111-111111111101', 'T01 Team');
          insert into users (id, name, email, role, team_id)
          values ('11111111-1111-4111-8111-111111111102', 'T01 User', 't01@example.test', 'Staff', '11111111-1111-4111-8111-111111111101');
          insert into companies (id, company_name, cr_number, br_number, incorporation_date,
            annual_return_basis_date, registered_office, company_secretary, assigned_owner_id, assigned_team_id)
          values ('11111111-1111-4111-8111-111111111103', 'T01 Co', 'T01-CR', 'T01-BR', '2020-01-01',
            '2020-01-01', 'T01 office', 'T01 secretary', '11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111101');
          insert into annual_return_cases (id, company_id, return_year, made_up_date, filing_due_date,
            current_status, owner_id)
          values ('11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111103', 2026,
            '2026-01-01', '2026-02-01', 'Documents pending', '11111111-1111-4111-8111-111111111102');
          insert into documents (id, company_id, case_id, file_type, file_name, storage_url, upload_source)
          values ('11111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111103',
            '11111111-1111-4111-8111-111111111104', 'identity', 'legacy.pdf', 'r2://t01/legacy.pdf', 'staff');
          insert into annual_return_checklist_items (id, case_id, item_label, due_date, document_id)
          values ('11111111-1111-4111-8111-111111111106', '11111111-1111-4111-8111-111111111104',
            'Identity', '2026-02-01', '11111111-1111-4111-8111-111111111105');
          insert into annual_return_audit_events (case_id, company_id, actor_id, actor_role, action, summary)
          values ('11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111103',
            '11111111-1111-4111-8111-111111111102', 'Staff', 't01.rehearsal', 'before upgrade');
        `);
        }

        for (const file of files.filter((name) => name >= "0021")) await apply(file);
        expect((await tx`select count(*)::int as n from maintenance_runs`)[0].n).toBe(0);
        if (upgrade) {
          const counts = async () => ({
            cases: (await tx`select count(*)::int as n from annual_return_cases`)[0].n,
            documents: (await tx`select count(*)::int as n from documents`)[0].n,
            audit: (await tx`select count(*)::int as n from annual_return_audit_events`)[0].n,
            versions: (await tx`select count(*)::int as n from document_versions`)[0].n,
            requirements: (await tx`select count(*)::int as n from case_requirement_instances`)[0]
              .n,
            links: (await tx`select count(*)::int as n from requirement_evidence_links`)[0].n,
          });
          expect(await counts()).toEqual({
            cases: 1,
            documents: 1,
            audit: 1,
            versions: 1,
            requirements: 1,
            links: 1,
          });
          expect(
            (await tx`select verified_checksum_sha256 from document_versions`)[0]
              .verified_checksum_sha256,
          ).toBeNull();
          await apply("0026_case_parties_and_requirement_instances.sql");
          await apply("0027_document_versions.sql");
          expect(await counts()).toEqual({
            cases: 1,
            documents: 1,
            audit: 1,
            versions: 1,
            requirements: 1,
            links: 1,
          });
        }
        throw rollbackMarker;
      }),
    ).rejects.toBe(rollbackMarker);
  } finally {
    await sql.end();
  }
}

describe.skipIf(!isLoopback)("T01 local database migration rehearsal", () => {
  it("t01_scenario_2 migrates an empty schema", () => rehearse(false), 120_000);
  it(
    "t01_scenario_2 preserves cases, document links and audit on upgrade and replays backfills",
    () => rehearse(true),
    120_000,
  );
});
