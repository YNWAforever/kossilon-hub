import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { businessCaseFixture } from "@/test/business-case-fixture";
import { createClientRepository } from "./repository";
import { createCompanyWorkspaceRepository } from "./company-workspace";
describe.skipIf(!process.env.TEST_DATABASE_URL)("R19 company context on actual SQL", () => {
  it("keeps scoped cases/documents/debt/activity bounded and never guesses an unlinked incorporation by company name", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await sql.begin(async (tx) => {
        const f = await businessCaseFixture(tx, 2);
        await tx`update users set role='Manager' where id=${f.owner}`;
        await tx`update incorporation_cases set status='Completed',company_id=${f.companies.a},completed_at=now() where id=${f.incorporation[0].id}`;
        await tx`update incorporation_cases set proposed_company_name_en='同名公司' where id=${f.incorporation[1].id}`;
        const [ar] =
          await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,owner_id) values (${f.companies.a},2026,'2026-01-01','2026-10-30','Payment pending',${f.owner}) returning id`;
        await tx`insert into payments(company_id,case_id,invoice_number,amount,due_date,status) values (${f.companies.a},${ar.id},${f.tag},1200,'2026-10-30','Payment pending')`;
        const docs =
          await tx`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source) values
 (${f.companies.a},${ar.id},'other','同名文件.pdf','','staff'),(${f.companies.a},${ar.id},'other','同名文件.pdf','','staff'),(${f.companies.foreign},null,'other','同名文件.pdf','','staff') returning id,company_id`;
        await tx`insert into timeline_events(company_id,event_type,actor_type,actor_id,description,created_at) values
 (${f.companies.a},'client_updated','user',${f.owner},'Owned company change','2026-10-01T00:00:00.123456Z'),
 (${f.companies.a},'client_updated','user',${f.owner},'Owned second change','2026-10-01T00:00:00.123456Z'),
 (${f.companies.a},'contact_added','user',${f.owner},'Owned contact','2026-10-01T00:00:00.123456Z'),
 (${f.companies.foreign},'client_updated','user',${f.foreignOwner},'PRIVATE FOREIGN','2026-10-01T00:00Z')`;
        const actor = {
            userId: f.owner,
            role: "Manager" as const,
            teamId: f.team,
            active: true,
            authUserId: "synthetic-r19",
          },
          repo = createCompanyWorkspaceRepository({ sql: tx });
        const legacy = createClientRepository({ sql: tx });
        await expect(
          legacy.getClient(f.companies.foreign, { actor, profileOnly: true }),
        ).rejects.toThrow(/Forbidden/);
        const profile = await legacy.getClient(f.companies.a, { actor, profileOnly: true });
        expect(profile!.annualReturnHistory).toEqual([]);
        expect(profile!.documents).toEqual([]);
        const summary = await repo.summary(actor, { companyId: f.companies.a });
        expect(summary.openCases).toBe(2);
        expect(summary.documents).toBe(2);
        expect(summary.paymentCases).toBe(1);
        expect(summary.companyId).toBe(f.companies.a);
        const cases = await repo.cases(actor, { companyId: f.companies.a, history: true });
        expect(cases.total).toBe(3);
        expect(cases.items.some((r) => r.sourceId === f.incorporation[1].id)).toBe(false);
        const documentPage = await repo.documents(actor, { companyId: f.companies.a });
        expect(documentPage.total).toBe(2);
        expect(documentPage.items.every((d) => d.companyId === f.companies.a)).toBe(true);
        expect(
          documentPage.items.some(
            (d) => d.id === docs.find((d) => d.company_id === f.companies.foreign)!.id,
          ),
        ).toBe(false);
        const debt = await repo.payments(actor, { companyId: f.companies.a });
        expect(debt.total).toBe(1);
        expect(debt.items[0].caseId).toBe(ar.id);
        expect(debt.items[0].payment.balance).toBe(1200);
        const events = await repo.activity(actor, {
          companyId: f.companies.a,
          eventType: "client_updated",
          limit: 1,
        });
        expect(events.total).toBe(2);
        const next = await repo.activity(actor, {
          companyId: f.companies.a,
          eventType: "client_updated",
          limit: 1,
          cursor: events.nextCursor!,
        });
        expect(next.items[0].id).not.toBe(events.items[0].id);
        expect(next.items[0].description).not.toContain("PRIVATE");
        await expect(repo.summary(actor, { companyId: f.companies.foreign })).rejects.toThrow(
          /Forbidden|not found/i,
        );
        await expect(
          repo.summary({ ...actor, role: "Client" }, { companyId: f.companies.a }),
        ).rejects.toThrow(/Forbidden/);
        await expect(
          repo.summary({ ...actor, teamId: null }, { companyId: f.companies.a }),
        ).rejects.toThrow(/Forbidden/);
        await tx`update users set active=false where id=${f.owner}`;
        await expect(repo.summary(actor, { companyId: f.companies.a })).rejects.toThrow(
          /Forbidden/,
        );
        throw Error("rollback R19 fixture");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback R19 fixture") throw error;
    } finally {
      await sql.end();
    }
  }, 30000);
});
