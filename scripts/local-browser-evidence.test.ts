import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertHistoricalAuditEvidenceUnchanged,
  captureHistoricalAuditEvidence,
  HISTORICAL_LOCAL_EVIDENCE_PATHS,
  localBrowserRunRoot,
} from "../e2e/local-evidence-guard";

const ownedRoots: string[] = [];
async function historicalFixture() {
  const root = await mkdtemp(join(tmpdir(), "kossilon-browser-evidence-"));
  ownedRoots.push(root);
  for (const path of HISTORICAL_LOCAL_EVIDENCE_PATHS) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `retained historical bytes for ${path}`);
  }
  return root;
}

afterEach(async () => {
  for (const root of ownedRoots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), "kossilon-browser-evidence-")))
      throw new Error("Refusing cleanup outside the owned fixture prefix.");
    await rm(root, { recursive: true });
  }
});

describe("local browser historical evidence guard", () => {
  it("accepts unchanged historical bytes while new evidence is written elsewhere", async () => {
    const root = await historicalFixture();
    const snapshot = await captureHistoricalAuditEvidence(root);
    const newRun = join(root, ".worktrees", "new-browser-run");
    await mkdir(newRun, { recursive: true });
    await writeFile(join(newRun, "browser-performance.json"), "new local-only observation");
    expect(snapshot).toHaveLength(9);
    await expect(assertHistoricalAuditEvidenceUnchanged(snapshot)).resolves.toBeUndefined();
  });

  it("rejects a browser run that overwrites an existing historical artifact", async () => {
    const root = await historicalFixture();
    const snapshot = await captureHistoricalAuditEvidence(root);
    await writeFile(join(root, HISTORICAL_LOCAL_EVIDENCE_PATHS[0]), "new run overwrote old bytes");
    await expect(assertHistoricalAuditEvidenceUnchanged(snapshot)).rejects.toThrow(
      /Historical audit evidence changed.*t20-desktop1280-navigation\.png/,
    );
  });

  it("rejects a browser run that removes part of the original acceptance package", async () => {
    const root = await historicalFixture();
    const snapshot = await captureHistoricalAuditEvidence(root);
    await unlink(join(root, "docs/audit-remediation/uat-results.csv"));
    await expect(assertHistoricalAuditEvidenceUnchanged(snapshot)).rejects.toThrow(
      /Historical audit evidence changed.*uat-results\.csv/,
    );
  });
});

describe("local browser run ownership", () => {
  it("allocates a new main run even when an older run root is inherited", async () => {
    const root = await historicalFixture();
    const base = join(root, "runs");
    const first = localBrowserRunRoot(base, undefined, false);
    await writeFile(join(first, "capture.json"), "retained prior run");
    const second = localBrowserRunRoot(base, first, false);
    expect(second).not.toBe(first);
    expect(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(first, "capture.json"), "utf8"),
      ),
    ).toBe("retained prior run");
  });

  it("keeps reloaded worker outputs in the main run", async () => {
    const root = await historicalFixture();
    const base = join(root, "runs");
    const main = localBrowserRunRoot(base, undefined, false);
    expect(localBrowserRunRoot(base, main, true)).toBe(main);
    await writeFile(join(localBrowserRunRoot(base, main, true), "capture.json"), "worker capture");
    expect(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(main, "capture.json"), "utf8"),
      ),
    ).toBe("worker capture");
  });

  it("refuses a worker with missing or foreign output ownership", async () => {
    const root = await historicalFixture();
    const base = join(root, "runs");
    expect(() => localBrowserRunRoot(base, undefined, true)).toThrow(/owned run root/);
    expect(() => localBrowserRunRoot(base, root, true)).toThrow(/owned run root/);
    expect(() => localBrowserRunRoot(base, join(base, "run-nonexistent"), true)).toThrow(
      /owned run root/,
    );
  });
});
