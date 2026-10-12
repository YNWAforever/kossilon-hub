import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { businessCaseFixture } from "@/test/business-case-fixture";
import { createIncorporationRepository } from "./repository";
describe.skipIf(!process.env.TEST_DATABASE_URL)("R20 incorporation real scoped pages", () => {
  it("searches the300th case, excludes history by default and traverses stable50-row pages without leakage", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const f = await businessCaseFixture(tx),
            scope = { kind: "team" as const, teamId: f.team };
          const repo = createIncorporationRepository({ sql: tx });
          const first = await repo.listCasePage(scope, {});
          expect(first.items).toHaveLength(50);
          expect(first.total).toBe(240);
          expect(first.nextCursor).toBeTruthy();
          expect(first.items.every((r) => r.status !== "Completed")).toBe(true);
          const all = await repo.listCasePage(scope, { history: true });
          expect(all.total).toBe(300);
          const ids = new Set(all.items.map((r) => r.id));
          let cursor = all.nextCursor;
          while (cursor) {
            const page = await repo.listCasePage(scope, { history: true, cursor });
            expect(page.items.length).toBeLessThanOrEqual(50);
            expect(page.total).toBe(300);
            for (const row of page.items) {
              expect(ids.has(row.id)).toBe(false);
              ids.add(row.id);
            }
            cursor = page.nextCursor;
          }
          expect(ids.size).toBe(300);
          const tail = await repo.listCasePage(scope, { history: true, q: "尾頁中文100%_" });
          expect(tail.total).toBe(1);
          expect(tail.items).toHaveLength(1);
          expect((await repo.listCasePage(scope, { owner: f.owner })).total).toBe(120);
          expect(
            (await repo.listCasePage(scope, { view: "mine", owner: f.colleague }, f.owner)).total,
          ).toBe(120);
          await expect(repo.listCasePage(scope, { view: "mine" })).rejects.toThrow(/viewer/i);
          expect((await repo.listCasePage({ kind: "team", teamId: f.foreignTeam }, {})).total).toBe(
            1,
          );
          await expect(
            repo.listCasePage(
              { kind: "team", teamId: f.foreignTeam },
              { cursor: first.nextCursor! },
            ),
          ).rejects.toThrow(/cursor/i);
          await expect(
            repo.listCasePage(scope, { q: "changed", cursor: first.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          await expect(repo.listCasePage(scope, { limit: 51 })).rejects.toThrow(/50/);
          await expect(
            repo.listCasePage({ kind: "team", teamId: null } as never, {}),
          ).rejects.toThrow(/scope/i);
          throw Error("rollback R20 fixture");
        }),
      ).rejects.toThrow("rollback R20 fixture");
    } finally {
      await sql.end();
    }
  }, 30000);
});
