import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { guardSqlTestLifetime } from "./sql-test-lifetime";

const url = process.env.TEST_DATABASE_URL;
const raw = url ? createSqlClient(url, { max: 1 }) : undefined;

describe.skipIf(!url)("actual PostgreSQL test SQL lifetime", () => {
  beforeAll(async () => {
    await raw!`create temporary table test_lifetime_facts (id integer primary key, payload jsonb)`;
  });
  afterEach(async () => {
    await raw!`truncate test_lifetime_facts`;
  });
  afterAll(async () => {
    await raw?.end();
  });
  async function count() {
    return Number((await raw!`select count(*)::int n from test_lifetime_facts`)[0].n);
  }
  it("refuses a tagged write after abort without changing rows", async () => {
    const controller = new AbortController();
    const client = guardSqlTestLifetime(raw!, () => controller.signal);
    const reason = new Error("Controlled cancelled fixture");
    controller.abort(reason);
    await expect(
      (async () => client`insert into test_lifetime_facts values (1, null)`)(),
    ).rejects.toBe(reason);
    expect(await count()).toBe(0);
  });
  it("refuses an unsafe write after abort without changing rows", async () => {
    const controller = new AbortController();
    const client = guardSqlTestLifetime(raw!, () => controller.signal);
    const reason = new Error("Controlled cancelled fixture");
    controller.abort(reason);
    await expect(
      (async () => client.unsafe("insert into test_lifetime_facts values (2, null)"))(),
    ).rejects.toBe(reason);
    expect(await count()).toBe(0);
  });
  it("rolls back when abort follows the callback's final write before commit", async () => {
    const controller = new AbortController();
    const client = guardSqlTestLifetime(raw!, () => controller.signal);
    const reason = new Error("Controlled pre-commit abort");
    await expect(
      client.begin(async (tx) => {
        await tx`insert into test_lifetime_facts values (3, null)`;
        controller.abort(reason);
        return "must not commit";
      }),
    ).rejects.toBe(reason);
    expect(await count()).toBe(0);
  });
  it("guards nested savepoints and rolls back their parent transaction", async () => {
    const controller = new AbortController();
    const client = guardSqlTestLifetime(raw!, () => controller.signal);
    const reason = new Error("Controlled nested abort");
    await expect(
      client.begin(async (tx) =>
        tx.savepoint(async (nested) => {
          await nested`insert into test_lifetime_facts values (4, null)`;
          controller.abort(reason);
          return "must not release";
        }),
      ),
    ).rejects.toBe(reason);
    expect(await count()).toBe(0);
  });
  it("preserves normal JSON helpers, transaction results and committed values", async () => {
    const controller = new AbortController();
    const client = guardSqlTestLifetime(raw!, () => controller.signal);
    await expect(
      client.begin(async (tx) => {
        await tx`insert into test_lifetime_facts values (5, ${tx.json({ value: "actual" })})`;
        return "committed";
      }),
    ).resolves.toBe("committed");
    expect(await raw!`select id,payload from test_lifetime_facts`).toEqual([
      { id: 5, payload: { value: "actual" } },
    ]);
  });
  it("refuses a query created before abort but first awaited afterwards", async () => {
    const controller = new AbortController();
    const client = guardSqlTestLifetime(raw!, () => controller.signal);
    const pending = client`insert into test_lifetime_facts values (6, null)`;
    const reason = new Error("Controlled deferred query abort");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(await count()).toBe(0);
  });
  it("preserves postgres.js transaction callbacks returning query arrays", async () => {
    const client = guardSqlTestLifetime(raw!, () => undefined);
    const result = await client.begin((tx) => [
      tx`insert into test_lifetime_facts values (7, null) returning id`,
      tx`insert into test_lifetime_facts values (8, null) returning id`,
    ]);
    expect(result.map((rows) => rows[0]?.id)).toEqual([7, 8]);
    expect(await count()).toBe(2);
  });
});
