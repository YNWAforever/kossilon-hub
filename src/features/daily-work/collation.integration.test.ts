import "dotenv/config";
import { it, expect } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { businessCaseFixture } from "@/test/business-case-fixture";
import { createDailyWorkRepository } from "./repository";
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "review: mixed company cursors use one order even when underlying columns use ICU",
  async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(
          'alter table incorporation_cases alter column proposed_company_name_en type text collate "en-x-icu"',
        );
        await tx.unsafe(
          'alter table companies alter column company_name type text collate "en-x-icu"',
        );
        const f = await businessCaseFixture(tx, 1);
        await tx`update users set role='Manager' where id=${f.owner}`;
        await tx`update companies set company_name=case when id=${f.companies.a} then 'Z' else 'a' end where id=any(${[f.companies.a, f.companies.b]}::uuid[])`;
        await tx`update incorporation_cases set proposed_company_name_en='a' where id=${f.incorporation[0].id}`;
        await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,owner_id) values(${f.companies.a},2026,'2026-01-01','2026-10-30','Upcoming',${f.owner})`;
        const repo = createDailyWorkRepository({ sql: tx }),
          actor = {
            userId: f.owner,
            role: "Manager" as const,
            authUserId: "synthetic-icu",
            teamId: f.team,
            active: true,
          };
        let cursor: string | undefined;
        const keys: string[] = [],
          names: string[] = [];
        do {
          const page = await repo.listPage(actor, {
            scope: "team",
            sort: "company",
            limit: 1,
            cursor,
          });
          expect(page.total).toBe(3);
          keys.push(...page.items.map((r) => r.workKey));
          names.push(...page.items.map((r) => r.companyName));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(keys).toHaveLength(3);
        expect(new Set(keys).size).toBe(3);
        expect(names).toEqual(["Z", "a", "a"]);
        throw Error("ICU fixture rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ICU fixture rollback") throw error;
    } finally {
      await sql.end();
    }
  },
  30000,
);
