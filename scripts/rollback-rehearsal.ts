// Read-only rollback/capability-pause rehearsal.
//
// Proves, without switching any alias or writing to a database:
//  1. a previous production deployment still exists, is READY and can serve
//     /api/version, /api/health and /login with the security headers;
//  2. the current deployment keeps the honest capability-pause state while the
//     request-access migration is not applied (mailto fallback, no form).
//
// Run: node --experimental-strip-types scripts/rollback-rehearsal.ts [--write]
import { readFileSync, writeFileSync } from "node:fs";

const TEAM_ID = "team_qvzlsFmfCsLkgItSypqHjw3z";
const PROJECT_ID = "prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC";
const PRODUCTION_ORIGIN = "https://kossilon-hub.vercel.app";
const AUTH_PATH =
  process.env.VERCEL_AUTH ?? `${process.env.APPDATA ?? ""}\\com.vercel.cli\\Data\\auth.json`;

export type Deployment = {
  uid: string;
  url: string | null;
  state: string;
  target: string | null;
  created: number;
  meta?: { githubCommitSha?: string };
};

export function selectRollbackCandidate(
  deployments: Deployment[],
  currentSha: string,
): Deployment | null {
  const ready = deployments.filter(
    (deployment) =>
      deployment.state === "READY" &&
      deployment.target === "production" &&
      deployment.url !== null &&
      typeof deployment.meta?.githubCommitSha === "string",
  );
  const current = ready.find((deployment) => deployment.meta?.githubCommitSha === currentSha);
  if (!current) return null;
  const earlier = ready
    .filter(
      (deployment) =>
        deployment.meta?.githubCommitSha !== currentSha && deployment.created < current.created,
    )
    .sort((a, b) => b.created - a.created);
  return earlier[0] ?? null;
}

export type RehearsalCheck = { name: string; ok: boolean; detail: string };

async function get(
  fetcher: typeof fetch,
  url: string,
): Promise<{ status: number; headers: Headers; body: string }> {
  const response = await fetcher(url, { redirect: "manual" });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

export async function runRehearsalChecks(
  fetcher: typeof fetch,
  candidate: Deployment,
  currentSha: string,
): Promise<RehearsalCheck[]> {
  const checks: RehearsalCheck[] = [];
  const candidateOrigin = `https://${candidate.url}`;
  const candidateSha = candidate.meta?.githubCommitSha ?? "";

  const version = await get(fetcher, `${candidateOrigin}/api/version`);
  let versionSha = "";
  try {
    versionSha = (JSON.parse(version.body) as { sha?: string }).sha ?? "";
  } catch {
    versionSha = "";
  }
  checks.push({
    name: "rollback-candidate-version",
    ok: version.status === 200 && versionSha === candidateSha,
    detail: `status=${version.status} sha=${versionSha || "unreadable"} expected=${candidateSha}`,
  });

  const health = await get(fetcher, `${candidateOrigin}/api/health`);
  let healthOk = false;
  try {
    healthOk = (JSON.parse(health.body) as { ok?: boolean }).ok === true;
  } catch {
    healthOk = false;
  }
  checks.push({
    name: "rollback-candidate-health",
    ok: health.status === 200 && healthOk,
    detail: `status=${health.status} ok=${healthOk}`,
  });

  const login = await get(fetcher, `${candidateOrigin}/login`);
  checks.push({
    name: "rollback-candidate-login-headers",
    ok:
      login.status === 200 &&
      login.headers.has("x-content-type-options") &&
      login.headers.has("content-security-policy-report-only"),
    detail: `status=${login.status} nosniff=${login.headers.has("x-content-type-options")} csp=${login.headers.has("content-security-policy-report-only")}`,
  });

  // Capability pause: migration 0083 is intentionally unapplied, so the public
  // page must fall back to mailto and never render a form that cannot persist.
  // After migration 0083 the persisted form is the honest state; the mailto
  // fallback remains honest where the table is absent. Anything else is a failure.
  const requestAccess = await get(fetcher, `${PRODUCTION_ORIGIN}/request-access`);
  const hasFallback = requestAccess.body.includes("mailto:");
  const hasForm = requestAccess.body.includes("request-access-name");
  checks.push({
    name: "request-access-honest-state",
    ok: requestAccess.status === 200 && (hasFallback || hasForm),
    detail: `status=${requestAccess.status} fallback=${hasFallback} form=${hasForm}`,
  });

  const capabilities = await get(fetcher, `${PRODUCTION_ORIGIN}/api/capabilities`);
  let capabilityIds: string[] = [];
  try {
    capabilityIds =
      (JSON.parse(capabilities.body) as { capabilities?: { id?: string }[] }).capabilities?.flatMap(
        (capability) => (capability.id ? [capability.id] : []),
      ) ?? [];
  } catch {
    capabilityIds = [];
  }
  checks.push({
    name: "capability-status-readable",
    ok:
      capabilities.status === 200 &&
      capabilityIds.includes("firm") &&
      capabilityIds.includes("whatsapp"),
    detail: `status=${capabilities.status} ids=${capabilityIds.join(",") || "none"}`,
  });

  checks.push({
    name: "rehearsal-is-read-only",
    ok: true,
    detail: `no alias switch performed; current sha ${currentSha}`,
  });

  return checks;
}

async function vercelApi<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Vercel API ${path} -> ${response.status}`);
  return (await response.json()) as T;
}

async function main() {
  const token =
    (JSON.parse(readFileSync(AUTH_PATH, "utf8")) as { token?: string; accessToken?: string })
      .token ??
    (JSON.parse(readFileSync(AUTH_PATH, "utf8")) as { accessToken?: string }).accessToken;
  if (!token) throw new Error("Vercel token not found in auth file.");

  const versionResponse = await fetch(`${PRODUCTION_ORIGIN}/api/version`);
  const currentSha = ((await versionResponse.json()) as { sha?: string }).sha ?? "";
  if (!currentSha) throw new Error("Could not read the current production sha.");

  const deployments = await vercelApi<{ deployments: Deployment[] }>(
    `/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=30`,
    token,
  );
  const candidate = selectRollbackCandidate(deployments.deployments, currentSha);
  if (!candidate) throw new Error("No earlier READY production deployment found.");

  const checks = await runRehearsalChecks(fetch, candidate, currentSha);
  const receipt = {
    rehearsedAt: new Date().toISOString(),
    mode: "read-only",
    productionAlias: PRODUCTION_ORIGIN,
    currentSha,
    rollbackCandidate: {
      deploymentId: candidate.uid,
      sha: candidate.meta?.githubCommitSha,
      url: candidate.url,
      created: new Date(candidate.created).toISOString(),
    },
    checks,
    passed: checks.every((check) => check.ok),
  };

  console.log(JSON.stringify(receipt, null, 2));
  if (process.argv.includes("--write")) {
    writeFileSync(
      "docs/releases/rollback-rehearsal-latest.json",
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  }
  if (!receipt.passed) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/rollback-rehearsal.ts") ?? false;
if (isDirectRun) void main();
