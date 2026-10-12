import "dotenv/config";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBunProcess } from "../../src/test/bun-process";
import { createSqlClient } from "../../src/server/db/client";

describe.skipIf(!process.env.TEST_DATABASE_URL)("current source restored-read rehearsal", () => {
  it("refuses a blocked source read without leaving an unbounded child or acceptance receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "kossilon blocked rehearsal "));
    const output = join(root, "receipt.json");
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (url.hostname === "localhost") url.hostname = "127.0.0.1";
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("lock table incorporation_cases in access exclusive mode");
        const run = await runBunProcess("scripts/audit/rehearse-restored-reads.ts", [output], {
          env: { ...process.env, R25_LOCAL_URL: url.toString() },
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("daily-work source is unavailable");
        expect(existsSync(output)).toBe(false);
      });
    } finally {
      await sql.end();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
  it.each(["127.0.0.1", "localhost"])(
    "executes the current READ ONLY readers for isolated fixture host %s",
    async (host) => {
      const root = mkdtempSync(join(tmpdir(), "kossilon readonly rehearsal "));
      const output = join(root, "receipt.json");
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.hostname = host;
      if (url.hostname === "localhost") url.hostname = "127.0.0.1";
      try {
        const run = await runBunProcess("scripts/audit/rehearse-restored-reads.ts", [output], {
          env: { ...process.env, R25_LOCAL_URL: url.toString() },
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
    },
    30_000,
  );
});
