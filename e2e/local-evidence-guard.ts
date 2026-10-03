import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HISTORICAL_LOCAL_EVIDENCE_PATHS = [
  "docs/audit-remediation/evidence/t20-desktop1280-navigation.png",
  "docs/audit-remediation/evidence/t20-desktop1280-settings.png",
  "docs/audit-remediation/evidence/t20-mobile390-navigation.png",
  "docs/audit-remediation/evidence/t20-mobile390-settings.png",
  "docs/audit-remediation/evidence/t21-desktop1280-browser-performance.json",
  "docs/audit-remediation/evidence/t21-mobile390-browser-performance.json",
  "docs/audit-remediation/uat-results.csv",
  "docs/audit-remediation/releases/2026-10-02-historical-release.sql",
  "docs/audit-remediation/releases/2026-10-02-historical-release-manifest.json",
] as const;

type HistoricalEvidence = { relativePath: string; absolutePath: string; sha256: string };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Main always allocates; workers may only reuse its exact owned direct child. */
export function localBrowserRunRoot(
  base: string,
  inheritedRoot: string | undefined,
  worker: boolean,
) {
  mkdirSync(base, { recursive: true });
  if (!worker) return mkdtempSync(join(base, "run-"));
  try {
    if (!inheritedRoot) throw new Error("missing root");
    const root = resolve(inheritedRoot);
    if (
      !/^run-[a-zA-Z0-9]+$/.test(relative(resolve(base), root)) ||
      lstatSync(root).isSymbolicLink() ||
      realpathSync(root) !== root
    )
      throw new Error("invalid root");
    return root;
  } catch {
    throw new Error("Local browser worker requires the main process's owned run root.");
  }
}

export async function captureHistoricalAuditEvidence(root: string): Promise<HistoricalEvidence[]> {
  return Promise.all(
    HISTORICAL_LOCAL_EVIDENCE_PATHS.map(async (relativePath) => {
      const absolutePath = resolve(root, relativePath);
      return { relativePath, absolutePath, sha256: hash(await readFile(absolutePath)) };
    }),
  );
}

export async function assertHistoricalAuditEvidenceUnchanged(snapshot: HistoricalEvidence[]) {
  const changed = await Promise.all(
    snapshot.map(async ({ relativePath, absolutePath, sha256 }) => {
      try {
        return hash(await readFile(absolutePath)) === sha256 ? null : relativePath;
      } catch {
        return relativePath;
      }
    }),
  );
  const changedPaths = changed.filter((path) => path !== null);
  if (changedPaths.length)
    throw new Error(`Historical audit evidence changed: ${changedPaths.join(", ")}`);
}

/** Local-only pre/post byte guard; this is not a genuine runtime acceptance proof. */
export default async function localEvidenceGuard() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const snapshot = await captureHistoricalAuditEvidence(root);
  return async () => {
    await assertHistoricalAuditEvidenceUnchanged(snapshot);
    console.log(`[local-browser-evidence] historical bytes unchanged: ${snapshot.length}`);
  };
}
