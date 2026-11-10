// Read-only pilot sign-off: verifies the live runtime facts the pilot checklist
// depends on. No provider calls other than the production/demo public surfaces.
//
// Run: node --experimental-strip-types scripts/pilot-signoff.ts [--write]
import { writeFileSync } from "node:fs";

const PRODUCTION_ORIGIN = "https://kossilon-hub.vercel.app";
const DEMO_ORIGIN = "https://kossilon-hub-demo.vercel.app";

export type SignoffFact = { name: string; ok: boolean; detail: string };

async function get(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, { headers: { "cache-control": "no-cache" } });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

function json(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function collectPilotFacts(fetcher: typeof fetch): Promise<SignoffFact[]> {
  const facts: SignoffFact[] = [];

  const version = await get(fetcher, `${PRODUCTION_ORIGIN}/api/version`);
  const versionBody = json(version.body) ?? {};
  const sha = typeof versionBody.sha === "string" ? versionBody.sha : "";
  facts.push({
    name: "production-identity",
    ok:
      version.status === 200 &&
      /^[0-9a-f]{40}$/.test(sha) &&
      versionBody.environment === "production" &&
      versionBody.dataMode === "production",
    detail: `status=${version.status} sha=${sha.slice(0, 12) || "missing"} env=${String(versionBody.environment)} mode=${String(versionBody.dataMode)}`,
  });

  const health = await get(fetcher, `${PRODUCTION_ORIGIN}/api/health`);
  const healthBody = json(health.body) ?? {};
  const scheduler = (healthBody.scheduler ?? {}) as Record<string, unknown>;
  const maintenance = (healthBody.maintenance ?? {}) as Record<string, unknown>;
  facts.push({
    name: "scheduler-and-maintenance",
    ok:
      health.status === 200 &&
      healthBody.ok === true &&
      scheduler.running === true &&
      scheduler.evidence === "platform-verified" &&
      maintenance.state === "healthy",
    detail: `status=${health.status} running=${String(scheduler.running)} evidence=${String(scheduler.evidence)} maintenance=${String(maintenance.state)}`,
  });

  const login = await get(fetcher, `${PRODUCTION_ORIGIN}/login`);
  const cspEnforced = login.headers.has("content-security-policy");
  const cspReportOnly = login.headers.has("content-security-policy-report-only");
  facts.push({
    name: "login-security-headers",
    ok:
      login.status === 200 &&
      login.headers.has("x-content-type-options") &&
      (cspEnforced || cspReportOnly),
    detail: `status=${login.status} nosniff=${login.headers.has("x-content-type-options")} csp=${cspEnforced ? "enforce" : cspReportOnly ? "report-only" : "missing"}`,
  });

  const requestAccess = await get(fetcher, `${PRODUCTION_ORIGIN}/request-access`);
  const hasFallback = requestAccess.body.includes("mailto:");
  const hasForm = requestAccess.body.includes("request-access-name");
  facts.push({
    name: "request-access-honest-state",
    ok: requestAccess.status === 200 && (hasFallback || hasForm),
    detail: `status=${requestAccess.status} fallback=${hasFallback} persisted-form=${hasForm}`,
  });

  const capabilities = await get(fetcher, `${PRODUCTION_ORIGIN}/api/capabilities`);
  const capabilityBody = json(capabilities.body) ?? {};
  const capabilityRows = Array.isArray(capabilityBody.capabilities)
    ? (capabilityBody.capabilities as { id?: string }[])
    : [];
  const ids = capabilityRows.flatMap((row) => (row.id ? [row.id] : []));
  const required = ["firm", "database", "auth", "documents", "scheduler"];
  facts.push({
    name: "capabilities-readable",
    ok: capabilities.status === 200 && required.every((id) => ids.includes(id)),
    detail: `status=${capabilities.status} ids=${ids.join(",") || "none"}`,
  });

  const demoVersion = await get(fetcher, `${DEMO_ORIGIN}/api/version`);
  const demoBody = json(demoVersion.body) ?? {};
  facts.push({
    name: "demo-fixture-identity",
    ok:
      demoVersion.status === 200 &&
      typeof demoBody.sha === "string" &&
      demoBody.dataMode === "demo",
    detail: `status=${demoVersion.status} sha=${typeof demoBody.sha === "string" ? demoBody.sha.slice(0, 12) : "missing"} mode=${String(demoBody.dataMode)}`,
  });

  return facts;
}

async function main() {
  const facts = await collectPilotFacts(fetch);
  const receipt = {
    checkedAt: new Date().toISOString(),
    mode: "read-only",
    production: PRODUCTION_ORIGIN,
    demo: DEMO_ORIGIN,
    facts,
    passed: facts.every((fact) => fact.ok),
    ownerGates: [
      "FIRM_ID production slug approval",
      "EMAIL_FROM / RESEND_FROM sender approval",
      "WhatsApp (WOZTELL) scope and templates",
      "Migration 0083 apply approval (request-access form + admin queue)",
      "Neon Auth invite wiring",
      "Backup/restore drill (Neon credentials + approved target)",
    ],
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (process.argv.includes("--write")) {
    writeFileSync(
      "docs/releases/pilot-signoff-latest.json",
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  }
  if (!receipt.passed) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/pilot-signoff.ts") ?? false;
if (isDirectRun) void main();
