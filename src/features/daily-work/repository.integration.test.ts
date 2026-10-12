import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { businessCaseFixture } from "@/test/business-case-fixture";
import { createDailyWorkRepository } from "./repository";
describe.skipIf(!process.env.TEST_DATABASE_URL)("R15 mixed daily work", () => {
  it("lists six real mixed cases in bounded mine/team scope, preserves AR categories and keeps partial failures truthful", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const f = await businessCaseFixture(tx, 2);
          await tx`update users set role='Manager' where id=${f.owner}`;
          const cases =
            await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
 values (${f.companies.a},2026,'2026-01-01','2026-10-30','Documents pending',${f.owner}),
 (${f.companies.b},2026,'2026-01-01','2026-10-30','Documents pending',${f.colleague}),
 (${f.companies.foreign},2026,'2026-01-01','2026-10-30','Documents pending',${f.foreignOwner}) returning id,company_id`;
          await tx`insert into annual_return_checklist_items(case_id,item_label,required,status,due_date) select id,'待追文件',true,'Missing','2026-10-30'::date from annual_return_cases where id=any(${cases.map((c) => c.id)}::uuid[])`;
          const actor = {
              userId: f.owner,
              authUserId: "synthetic-r15",
              role: "Manager" as const,
              teamId: f.team,
              active: true,
            },
            repo = createDailyWorkRepository({ sql: tx });
          const mine = await repo.listPage(actor, {});
          expect(mine.total).toBe(3);
          expect(mine.items).toHaveLength(3);
          expect(new Set(mine.items.map((r) => r.sourceType))).toEqual(
            new Set(["annual_return", "incorporation", "corporate_change_request"]),
          );
          expect(mine.items.find((r) => r.sourceType === "incorporation")!.companyId).toBeNull();
          expect(
            mine.items.every(
              (r) => r.ownerName === "本隊陳同事" && r.blocker && r.nextAction.enabled,
            ),
          ).toBe(true);
          const team = await repo.listPage(actor, { scope: "team", limit: 1 });
          expect(team.total).toBe(6);
          expect(team.items).toHaveLength(1);
          const keys = new Set(team.items.map((r) => r.workKey));
          let cursor = team.nextCursor;
          while (cursor) {
            const page = await repo.listPage(actor, { scope: "team", limit: 1, cursor });
            expect(page.total).toBe(6);
            expect(page.items).toHaveLength(1);
            for (const r of page.items) {
              expect(keys.has(r.workKey)).toBe(false);
              keys.add(r.workKey);
            }
            cursor = page.nextCursor;
          }
          expect(keys.size).toBe(6);
          await tx`update incorporation_cases set proposed_company_name_en='😀公司' where id=${f.incorporation[0].id}`;
          await tx`update incorporation_cases set proposed_company_name_en='Z company 100%_' where id=${f.incorporation[1].id}`;
          const byCompany = await repo.listPage(actor, {
            scope: "team",
            sort: "company",
            limit: 1,
          });
          expect(byCompany.items[0].companyName).toBe("Z company 100%_");
          const companyKeys = new Set(byCompany.items.map((r) => r.workKey));
          let companyCursor = byCompany.nextCursor;
          while (companyCursor) {
            const p = await repo.listPage(actor, {
              scope: "team",
              sort: "company",
              limit: 1,
              cursor: companyCursor,
            });
            for (const r of p.items) {
              expect(companyKeys.has(r.workKey)).toBe(false);
              companyKeys.add(r.workKey);
            }
            companyCursor = p.nextCursor;
          }
          expect(companyKeys.size).toBe(6);
          const literal = await repo.listPage(actor, { scope: "team", q: "100%_" });
          expect(literal.total).toBe(2);
          expect(literal.partial).toBe(false);
          expect(new Set(literal.items.map((r) => r.sourceType))).toEqual(
            new Set(["incorporation", "corporate_change_request"]),
          );
          const before = createDailyWorkRepository({
              sql: tx,
              now: () => new Date("2026-10-11T15:59:00Z"),
            }),
            after = createDailyWorkRepository({
              sql: tx,
              now: () => new Date("2026-10-11T16:00:00Z"),
            });
          const oldDay = await before.listPage(actor, { scope: "team", limit: 1 });
          expect(oldDay.businessDate).toBe("2026-10-11");
          expect((await after.listPage(actor, { scope: "team" })).businessDate).toBe("2026-10-12");
          await expect(
            after.listPage(actor, { scope: "team", limit: 1, cursor: oldDay.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          await expect(repo.listPage({ ...actor, role: "Admin" }, {})).rejects.toThrow(/Forbidden/);
          await expect(repo.listPage({ ...actor, teamId: f.foreignTeam }, {})).rejects.toThrow(
            /Forbidden/,
          );
          await expect(
            repo.listPage(actor, { scope: "mine", limit: 1, cursor: team.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          await expect(
            repo.listPage({ ...actor, role: "Staff", userId: f.colleague }, { scope: "team" }),
          ).rejects.toThrow(/Forbidden/);
          await expect(repo.listPage({ ...actor, role: "Client" }, {})).rejects.toThrow(
            /Forbidden/,
          );
          await expect(repo.listPage({ ...actor, teamId: null }, {})).rejects.toThrow(/Forbidden/);
          await expect(repo.listPage(actor, { limit: 51 })).rejects.toThrow();
          expect(
            (
              await repo.listPage(actor, {
                sourceType: "annual_return",
                scope: "team",
                view: "chaseToday",
              })
            ).total,
          ).toBe(2);
          expect((await repo.metrics(actor, { scope: "team" })).chaseToday).toBe(2);
          expect(
            (await repo.metrics(actor, { scope: "team", companyId: f.companies.a })).chaseToday,
          ).toBe(1);
          await tx`update annual_return_checklist_items set status='Received' where case_id=any(${cases.map((c) => c.id)}::uuid[])`;
          expect(
            (
              await repo.listPage(actor, {
                sourceType: "annual_return",
                scope: "team",
                view: "newlyReceived",
              })
            ).total,
          ).toBe(2);
          expect(
            (await repo.listPage(actor, { sourceType: "annual_return", view: "awaitingMyReview" }))
              .total,
          ).toBe(1);
          expect(
            (
              await repo.listPage(actor, {
                sourceType: "annual_return",
                scope: "team",
                view: "readyToFile",
              })
            ).total,
          ).toBe(0);
          expect(
            (
              await repo.listPage(actor, {
                sourceType: "annual_return",
                scope: "team",
                view: "returnsAndExceptions",
              })
            ).total,
          ).toBe(0);
          await tx`alter table incorporation_cases rename to r15_unavailable_source`;
          const partial = await repo.listPage(actor, { scope: "team" });
          expect(partial.partial).toBe(true);
          expect(partial.total).toBe(4);
          expect(partial.sources.find((s) => s.sourceType === "incorporation")).toMatchObject({
            status: "unavailable",
            total: null,
          });
          expect(partial.items.some((r) => r.sourceType === "annual_return")).toBe(true);
          await expect(
            repo.listPage(actor, { scope: "team", limit: 1, cursor: team.nextCursor! }),
          ).rejects.toThrow(/coverage/i);
          await tx`update users set active=false where id=${f.owner}`;
          await expect(repo.listPage(actor, {})).rejects.toThrow(/Forbidden/);
          throw Error("rollback R15 fixture");
        }),
      ).rejects.toThrow("rollback R15 fixture");
    } finally {
      await sql.end();
    }
  }, 30000);
});
