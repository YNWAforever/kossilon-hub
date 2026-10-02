import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { createSqlClient } from "./client";
const sql = process.env.TEST_DATABASE_URL ? createSqlClient(process.env.TEST_DATABASE_URL) : null;
const preflight = readFileSync("docs/audit-remediation/release-preflight.sql", "utf8");
afterAll(async () => {
  await sql?.end();
});

it.skipIf(!sql)(
  "reports actual scheduler/bulk/handoff resources and their physical catalog",
  async () => {
    const rows = (await sql!.unsafe(preflight).simple()).flat();
    for (const table of [
      "maintenance_runs",
      "maintenance_job_runs",
      "bulk_operation_jobs",
      "bulk_operation_job_items",
      "package_handoffs",
      "handoff_returns",
    ]) {
      expect(rows.some((row) => row.table_name === table && row.presence === "present")).toBe(true);
      const key = table === "bulk_operation_job_items" ? "job_id" : "id";
      expect(rows.some((row) => row.table_name === table && row.column_name === key)).toBe(true);
      expect(rows.some((row) => row.tablename === table && row.indexdef)).toBe(true);
    }
  },
);
it.skipIf(!sql)(
  "keeps a missing expected release table visible without writing catalog or ledger",
  async () => {
    const probe = preflight.replace(
      "('maintenance_runs'),",
      "('audit_missing_release_probe'),\n('maintenance_runs'),",
    );
    const rows = (await sql!.unsafe(probe).simple()).flat();
    expect(rows.find((row) => row.table_name === "audit_missing_release_probe")?.presence).toBe(
      "missing",
    );
  },
);
