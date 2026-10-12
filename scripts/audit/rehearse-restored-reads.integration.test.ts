import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("current source restored-read rehearsal", () => {
  it("executes all current business readers in READ ONLY and binds the SQL actor to its current role/team", () => {
    const root = mkdtempSync(join(tmpdir(), "kossilon-readonly-rehearsal-"));
    const output = join(root, "receipt.json");
    const bun = process.env.BUN_EXECUTABLE ?? "bun";
    try {
      const run = spawnSync(bun, ["scripts/audit/rehearse-restored-reads.ts", output], {
        env: { ...process.env, R25_LOCAL_URL: process.env.TEST_DATABASE_URL },
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      expect(run.status, run.stderr).toBe(0);
      const result = JSON.parse(readFileSync(output, "utf8"));
      expect(result.transaction).toBe("READ ONLY");
      expect(result.sideEffects).toBe(0);
      expect(result.dailyWork).toBeDefined();
      expect(
        result.dailyWork.sources.map((s: { sourceType: string; status: string }) => [
          s.sourceType,
          s.status,
        ]),
      ).toEqual([
        ["annual_return", "available"],
        ["incorporation", "available"],
        ["corporate_change_request", "available"],
      ]);
      expect(result.incorporation.loaded).toBeLessThanOrEqual(50);
      expect(result.corporateChanges.loaded).toBeLessThanOrEqual(50);
      expect(result.companyWorkspace.observed).toBe(true);
      expect(result.companyWorkspace.tabs).toEqual([
        "overview",
        "cases",
        "documents",
        "payments",
        "activity",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
