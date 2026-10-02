import { spawn } from "node:child_process";
import { getCurrentTest } from "@vitest/runner";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { ownTestChild } from "@/test/child-test-lifetime";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 1 }) : undefined;
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!url)("actual failed NAR child fixture", () => {
  it("retains the child timeout failure while removing only that fixture's rows", async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
      throw new Error("The failed-child regression requires isolated localhost Postgres.");
    const context = getCurrentTest()!.context;
    context.signal.throwIfAborted();
    const child = spawn(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "src/features/nar-import/apply.integration.test.ts",
        "-t",
        "controlled fixture timeout B07",
        "--pool=threads",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, AUDIT_NAR_TIMEOUT_PROBE: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const owned = ownTestChild(child, context.signal);
    onTestFinished(owned.cleanup);
    try {
      const code = await owned.closed;
      context.signal.throwIfAborted();
      expect(code, output).toBe(1);
      expect(output).toContain("Test timed out in 1000ms");
      expect(output).not.toContain("Hook timed out");
      expect(output).not.toContain("Unhandled Rejection");
      const match = /B07_TIMEOUT_FIXTURE (\{[^\r\n]+\})/.exec(output);
      expect(match, output).not.toBeNull();
      const fixture = JSON.parse(match![1]) as {
        companyId: string;
        batchId: string;
        actorId: string;
        ownerId: string;
        templateId: string;
        lateWorkerCompanyId: string;
      };
      for (const id of Object.values(fixture))
        expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
      const observedSql = guardSqlTestLifetime(sql!, () => context.signal);
      const [remaining] = await observedSql`select
      (select count(*)::int from companies where id=${fixture.companyId}) companies,
      (select count(*)::int from nar_import_batches where id=${fixture.batchId}) batches,
      (select count(*)::int from users where id=any(${[fixture.actorId, fixture.ownerId]}::uuid[])) users,
      (select count(*)::int from checklist_templates where id=${fixture.templateId}) templates,
      (select count(*)::int from companies where id=${fixture.lateWorkerCompanyId}) "lateWorkerCompanies"`;
      expect(remaining, output).toEqual({
        companies: 0,
        batches: 0,
        users: 0,
        templates: 0,
        lateWorkerCompanies: 0,
      });
      expect(output.match(/(?:^|\n)\s*FAIL\b/g), output).toHaveLength(1);
      console.info(
        "B07_TIMEOUT_RECEIPT",
        JSON.stringify({ childExitCode: code, fixture, remaining }),
      );
    } finally {
      await owned.cleanup();
    }
  });
});
