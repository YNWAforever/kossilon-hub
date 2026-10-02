import { spawn } from "node:child_process";
import { once } from "node:events";
import { getCurrentTest } from "@vitest/runner";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { ownTestChild } from "./child-test-lifetime";

const url = process.env.TEST_DATABASE_URL;
const raw = url ? createSqlClient(url, { max: 1 }) : undefined;
afterAll(async () => {
  await raw?.end();
});

describe.skipIf(!url)("actual parent-cancelled native test child", () => {
  it("terminates and awaits its owned child before it can perform a later PostgreSQL write", async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url!).hostname))
      throw new Error("Child cancellation regression requires isolated localhost Postgres.");
    const table = "test_child_lifetime_" + crypto.randomUUID().replaceAll("-", "");
    await raw!`create table ${raw!(table)} (id integer primary key)`;
    const controller = new AbortController();
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import postgres from 'postgres';
      const sql=postgres(process.env.TEST_DATABASE_URL,{ssl:false,max:1});
      console.log('B07_CHILD_READY');
      await new Promise(resolve=>setTimeout(resolve,5000));
      await sql.unsafe('insert into '+process.env.B07_CHILD_TABLE+' values (1)');
      await sql.end();
    `,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, B07_CHILD_TABLE: table },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const owned = ownTestChild(
      child,
      AbortSignal.any([controller.signal, getCurrentTest()!.context.signal]),
    );
    let tableCleanup: Promise<unknown> | undefined;
    const cleanup = async () => {
      await owned.cleanup();
      tableCleanup ??= (async () => raw!`drop table ${raw!(table)}`)();
      await tableCleanup;
    };
    onTestFinished(cleanup);
    try {
      const [ready] = await Promise.race([
        once(child.stdout, "data"),
        owned.closed.then(() => {
          throw new Error("Child exited before its ready marker.");
        }),
      ]);
      expect(ready.toString()).toContain("B07_CHILD_READY");
      controller.abort(new Error("Controlled parent cancellation"));
      await owned.cleanup();
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(Number((await raw!`select count(*)::int n from ${raw!(table)}`)[0].n)).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
