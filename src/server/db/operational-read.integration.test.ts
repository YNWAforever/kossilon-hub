import { afterAll, expect, it } from "vitest";
import { createSqlClient } from "./client";
import { operationalRead } from "./operational-read";
const sql = process.env.TEST_DATABASE_URL ? createSqlClient(process.env.TEST_DATABASE_URL) : null;
afterAll(async () => {
  await sql?.end();
});
it.skipIf(!sql)(
  "disables JIT only inside its read transaction and restores the caller setting",
  async () => {
    const [before] = await sql!`show jit`;
    const inside = await operationalRead(sql!, async (tx) => (await tx`show jit`)[0].jit);
    expect(inside).toBe("off");
    expect((await sql!`show jit`)[0].jit).toBe(before.jit);
    await sql!.begin(async (tx) => {
      const [prior] = await tx`show jit`;
      expect(await operationalRead(tx, async (nested) => (await nested`show jit`)[0].jit)).toBe(
        "off",
      );
      expect((await tx`show jit`)[0].jit).toBe(prior.jit);
    });
  },
);
