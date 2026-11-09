// Backup/restore drill: create a Neon branch from production, verify it reads as
// a real backup (ledger + latest tables + data), then delete it. Never writes to
// the production branch.
//
// Requires NEON_API_KEY. Optional: NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID,
// NEON_DATABASE_NAME, NEON_ROLE_NAME. Dry planning functions are unit-tested.
//
// Run: node --experimental-strip-types scripts/backup-restore-drill.ts [--write]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

const API = "https://console.neon.tech/api/v2";
const PROJECT_ID = process.env.NEON_PROJECT_ID ?? "red-morning-00331124";
const PARENT_BRANCH_ID = process.env.NEON_PARENT_BRANCH_ID ?? "br-muddy-mountain-aov8bbku";
const DATABASE = process.env.NEON_DATABASE_NAME ?? "neondb";
const ROLE = process.env.NEON_ROLE_NAME ?? "neondb_owner";
const KEY_FILE =
  process.env.NEON_API_KEY_FILE ??
  join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".kossilon-neon-api-key");
const API_KEY =
  process.env.NEON_API_KEY?.trim() ||
  (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : "");

export function drillBranchName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `backup-drill-${stamp}`;
}

export type RestoreFacts = {
  ledgerPresent: boolean;
  ledgerCount: number;
  requestAccessTablePresent: boolean;
  maintenanceRuns: number;
  companies: number;
};

export function restoreProblems(facts: RestoreFacts): string[] {
  const problems: string[] = [];
  if (!facts.ledgerPresent) problems.push("schema_migrations missing");
  if (facts.ledgerCount < 67) problems.push(`ledger only has ${facts.ledgerCount} ids`);
  if (!facts.requestAccessTablePresent) problems.push("request_access_requests missing");
  if (facts.maintenanceRuns < 1) problems.push("no maintenance_runs data");
  if (facts.companies < 1) problems.push("no companies data");
  return problems;
}

async function neon<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `Neon API ${init.method ?? "GET"} ${path} -> ${response.status}: ${text.slice(0, 300)}`,
    );
  return (text ? JSON.parse(text) : undefined) as T;
}

async function main() {
  const write = process.argv.includes("--write");
  const name = drillBranchName();
  const receipt: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    parentBranchId: PARENT_BRANCH_ID,
    drillBranchName: name,
    steps: [] as { step: string; ok: boolean; detail: string }[],
    passed: false,
  };
  const steps = receipt.steps as { step: string; ok: boolean; detail: string }[];
  let branchId: string | null = null;

  const finish = () => {
    receipt.finishedAt = new Date().toISOString();
    receipt.passed = steps.every((step) => step.ok);
    console.log(JSON.stringify(receipt, null, 2));
    if (write)
      writeFileSync(
        "docs/releases/backup-drill-latest.json",
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
    if (!receipt.passed) process.exitCode = 1;
  };

  try {
    if (!API_KEY) throw new Error("NEON_API_KEY is required.");
    const project = await neon<{ project: { id: string; name: string } }>(
      `/projects/${PROJECT_ID}`,
    );
    steps.push({
      step: "project-readable",
      ok: true,
      detail: `${project.project.name} (${project.project.id})`,
    });

    const created = await neon<{ branch: { id: string; name: string; current_state?: string } }>(
      `/projects/${PROJECT_ID}/branches`,
      {
        method: "POST",
        body: JSON.stringify({ branch: { name, parent_id: PARENT_BRANCH_ID } }),
      },
    );
    branchId = created.branch.id;
    steps.push({
      step: "branch-created",
      ok: true,
      detail: `${created.branch.id} (${created.branch.name})`,
    });

    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const branch = await neon<{ branch: { current_state?: string } }>(
        `/projects/${PROJECT_ID}/branches/${branchId}`,
      );
      if (branch.branch.current_state === "ready") {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    steps.push({
      step: "branch-ready",
      ok: ready,
      detail: ready ? "ready" : "not ready after 60s",
    });
    if (!ready) throw new Error("restored branch did not become ready");

    const connection = await neon<{ uri: string }>(
      `/projects/${PROJECT_ID}/connection_uri?branch_id=${branchId}&database_name=${DATABASE}&role_name=${ROLE}`,
    );
    const sql = postgres(connection.uri, { ssl: "require", max: 1, connect_timeout: 20 });
    try {
      const [ledger] = await sql`
        select
          to_regclass('schema_migrations') is not null as ledger_present,
          to_regclass('request_access_requests') is not null as request_access_present,
          (select count(*)::int from schema_migrations) as ledger_count,
          (select count(*)::int from maintenance_runs) as maintenance_runs,
          (select count(*)::int from companies) as companies
      `;
      const facts: RestoreFacts = {
        ledgerPresent: ledger.ledger_present,
        ledgerCount: ledger.ledger_count,
        requestAccessTablePresent: ledger.request_access_present,
        maintenanceRuns: ledger.maintenance_runs,
        companies: ledger.companies,
      };
      const problems = restoreProblems(facts);
      steps.push({
        step: "restored-data-verified",
        ok: problems.length === 0,
        detail: problems.length === 0 ? JSON.stringify(facts) : problems.join("; "),
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (error) {
    steps.push({ step: "drill-failed", ok: false, detail: (error as Error).message });
  } finally {
    if (branchId) {
      try {
        await neon(`/projects/${PROJECT_ID}/branches/${branchId}`, { method: "DELETE" });
        let gone = false;
        try {
          await neon(`/projects/${PROJECT_ID}/branches/${branchId}`);
        } catch (error) {
          gone = /-> 404/.test((error as Error).message);
        }
        steps.push({
          step: "drill-branch-deleted",
          ok: gone,
          detail: gone ? `${branchId} deleted` : `${branchId} still readable`,
        });
      } catch (error) {
        steps.push({ step: "drill-branch-deleted", ok: false, detail: (error as Error).message });
      }
    }
    finish();
  }
}

const isDirectRun =
  process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/backup-restore-drill.ts") ?? false;
if (isDirectRun) void main();
