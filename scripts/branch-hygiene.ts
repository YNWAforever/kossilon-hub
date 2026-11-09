// Branch hygiene: read-only audit by default; deletion requires both flags.
//
// Run:
//   node --experimental-strip-types scripts/branch-hygiene.ts
//   node --experimental-strip-types scripts/branch-hygiene.ts --write
//   node --experimental-strip-types scripts/branch-hygiene.ts --delete-safe --yes
import { writeFileSync } from "node:fs";

const OWNER = "YNWAforever";
const REPO = "kossilon-hub";
const PROTECTED = new Set(["main", "demo"]);

export type BranchInfo = { name: string; sha: string; protected: boolean };

export type BranchPlan = {
  safeToDelete: string[];
  openPullRequests: string[];
  unmerged: string[];
  retained: string[];
};

/**
 * Pure classification. A branch is deletable only when:
 *  - it is not protected (main/demo) or explicitly retained,
 *  - no open PR targets it,
 *  - GitHub's compare says `ahead_by === 0` (fully merged into main).
 * Missing compare data is treated as unmerged (fail closed).
 */
export function planBranchCleanup(input: {
  branches: BranchInfo[];
  aheadBy: Record<string, number>;
  openPrHeads: ReadonlySet<string>;
  retain?: readonly string[];
}): BranchPlan {
  const retain = new Set(input.retain ?? []);
  const safeToDelete: string[] = [];
  const openPullRequests: string[] = [];
  const unmerged: string[] = [];
  const retained: string[] = [];

  for (const branch of input.branches) {
    if (PROTECTED.has(branch.name) || branch.protected || retain.has(branch.name)) {
      retained.push(branch.name);
      continue;
    }
    if (input.openPrHeads.has(branch.name)) {
      openPullRequests.push(branch.name);
      continue;
    }
    const ahead = input.aheadBy[branch.name];
    if (typeof ahead !== "number") {
      unmerged.push(branch.name);
    } else if (ahead === 0) {
      safeToDelete.push(branch.name);
    } else {
      unmerged.push(branch.name);
    }
  }

  return {
    safeToDelete: safeToDelete.sort(),
    openPullRequests: openPullRequests.sort(),
    unmerged: unmerged.sort(),
    retained: retained.sort(),
  };
}

async function github<T>(path: string, token: string, method = "GET"): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "dsh-branch-hygiene",
    },
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN missing.");
  const write = process.argv.includes("--write");
  const deleteSafe = process.argv.includes("--delete-safe");
  const confirmed = process.argv.includes("--yes");

  const branches: BranchInfo[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await github<BranchInfo[]>(`/branches?per_page=100&page=${page}`, token);
    branches.push(
      ...batch.map(({ name, sha, protected: isProtected }) => ({
        name,
        sha,
        protected: isProtected,
      })),
    );
    if (batch.length < 100) break;
  }

  const openPullRequests = await github<{ head: { ref: string } }[]>(
    `/pulls?state=open&per_page=100`,
    token,
  );
  const openPrHeads = new Set(openPullRequests.map((pull) => pull.head.ref));

  const compares = await mapWithLimit(
    branches.filter((branch) => !PROTECTED.has(branch.name) && !branch.protected),
    6,
    async (branch) => {
      try {
        const compare = await github<{ ahead_by: number }>(
          `/compare/main...${encodeURIComponent(branch.name)}`,
          token,
        );
        return [branch.name, compare.ahead_by] as const;
      } catch {
        return null;
      }
    },
  );
  const aheadBy = Object.fromEntries(
    compares.filter((entry): entry is readonly [string, number] => entry !== null),
  );

  const plan = planBranchCleanup({ branches, aheadBy, openPrHeads });
  const receipt = {
    generatedAt: new Date().toISOString(),
    repository: `${OWNER}/${REPO}`,
    mode: deleteSafe ? "delete-safe" : "read-only",
    totalBranches: branches.length,
    counts: {
      safeToDelete: plan.safeToDelete.length,
      openPullRequests: plan.openPullRequests.length,
      unmerged: plan.unmerged.length,
      retained: plan.retained.length,
    },
    safeToDelete: plan.safeToDelete,
    openPullRequests: plan.openPullRequests,
    unmerged: plan.unmerged,
    retained: plan.retained,
  };

  console.log(JSON.stringify(receipt, null, 2));
  if (write)
    writeFileSync(
      "docs/releases/branch-hygiene-latest.json",
      `${JSON.stringify(receipt, null, 2)}\n`,
    );

  if (deleteSafe) {
    if (!confirmed) {
      console.error("Refusing to delete without --yes.");
      process.exitCode = 1;
      return;
    }
    // Recompute protected refs from the same plan; deletion is limited to the
    // fully-merged, no-open-PR list that the audit just produced.
    if (plan.safeToDelete.length > 0) {
      await mapWithLimit(plan.safeToDelete, 2, async (name) => {
        await github(`/git/refs/heads/${name}`, token, "DELETE");
        console.error(`deleted ${name}`);
        return name;
      });
    }
  }
}

const isDirectRun =
  process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/branch-hygiene.ts") ?? false;
if (isDirectRun) void main();
