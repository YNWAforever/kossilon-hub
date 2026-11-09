// Scheduled freshness gate: production must be running the latest `main` SHA.
//
// A missing Vercel Git deployment is silent otherwise: every page still works,
// just from an older commit. The schedule runs this before smoke, and a stale
// result fails the workflow so the existing ops-alert issue opens.
//
// Run: node --experimental-strip-types scripts/verify-production-freshness.ts
const PRODUCTION_ORIGIN = "https://kossilon-hub.vercel.app";
const REPO = process.env.GITHUB_REPOSITORY ?? "YNWAforever/kossilon-hub";

export type FreshnessVerdict = "current" | "stale" | "unknown";

export function freshnessVerdict(input: {
  mainSha: string | null;
  liveSha: string | null;
}): FreshnessVerdict {
  const { mainSha, liveSha } = input;
  if (!mainSha || !liveSha) return "unknown";
  return mainSha === liveSha ? "current" : "stale";
}

async function latestMainSha(token: string | undefined): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { sha?: unknown };
    return typeof body.sha === "string" ? body.sha : null;
  } catch {
    return null;
  }
}

async function productionSha(): Promise<string | null> {
  try {
    const response = await fetch(`${PRODUCTION_ORIGIN}/api/version`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { sha?: unknown };
    return typeof body.sha === "string" ? body.sha : null;
  } catch {
    return null;
  }
}

async function main() {
  const attempts = Number(process.env.FRESHNESS_ATTEMPTS ?? "8");
  const delayMs = Number(process.env.FRESHNESS_DELAY_MS ?? "30000");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [mainSha, liveSha] = await Promise.all([latestMainSha(token), productionSha()]);
    const verdict = freshnessVerdict({ mainSha, liveSha });
    console.log(
      `attempt ${attempt + 1}/${attempts}: main=${mainSha?.slice(0, 12) ?? "unreadable"} live=${liveSha?.slice(0, 12) ?? "unreadable"} verdict=${verdict}`,
    );
    if (verdict === "current") return;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const [mainSha, liveSha] = await Promise.all([latestMainSha(token), productionSha()]);
  const reason =
    mainSha === null
      ? "could not read the latest main SHA from GitHub"
      : liveSha === null
        ? "could not read the production SHA"
        : `production is running ${liveSha.slice(0, 12)} but main is ${mainSha.slice(0, 12)}`;
  console.error(`::error::production is not fresh: ${reason}`);
  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/verify-production-freshness.ts") ??
  false;
if (isDirectRun) void main();
