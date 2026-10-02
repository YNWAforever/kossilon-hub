import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";

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
    const child = spawn(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "src/features/nar-import/apply.integration.test.ts",
        "-t",
        "controlled fixture timeout B07",
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
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
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
    };
    for (const id of Object.values(fixture))
      expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    const [remaining] = await sql!`select
      (select count(*)::int from companies where id=${fixture.companyId}) companies,
      (select count(*)::int from nar_import_batches where id=${fixture.batchId}) batches,
      (select count(*)::int from users where id=any(${[fixture.actorId, fixture.ownerId]}::uuid[])) users,
      (select count(*)::int from checklist_templates where id=${fixture.templateId}) templates`;
    expect(remaining).toEqual({ companies: 0, batches: 0, users: 0, templates: 0 });
    console.info(
      "B07_TIMEOUT_RECEIPT",
      JSON.stringify({ childExitCode: code, fixture, remaining }),
    );
  });
});
