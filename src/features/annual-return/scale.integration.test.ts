import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createAnnualReturnRepository } from "./repository";
import { createClientRepository } from "@/features/clients/repository";
import { createDocumentRepository } from "@/features/documents/repository";
const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 1 }) : null;
afterAll(async () => {
  await sql?.end();
});
const rollback = new Error("Owned scale fixture rollback");
describe.skipIf(!url)("SQL operational view scale", () => {
  it("rejects invalid cursors and oversized pages instead of silently resetting", async () => {
    await expect(
      createClientRepository({ sql: sql! }).listClientPage({ limit: 201 }),
    ).rejects.toThrow("1–200");
    await expect(
      createDocumentRepository({ sql: sql! }).listDocumentPage({ cursor: "invalid" }),
    ).rejects.toThrow("Invalid list cursor");
    await expect(
      createAnnualReturnRepository({ sql: sql! }).listWorkView({
        view: "chaseToday",
        scope: {},
        viewerUserId: null,
        limit: 201,
      }),
    ).rejects.toThrow("1–200");
  });
  it("paginates 10000 authorised cases, reaches201/401/5001, and counts the full scope without hydration", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const key = crypto.randomUUID(),
          owner = "20000000-0000-0000-0000-000000000001";
        const companies = await tx<
          { id: string }[]
        >`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id)
        select ${key}||' Scale '||lpad(n::text,5,'0'),${key}||n,${key}||n,'2020-01-01'::date,'2026-09-01'::date,'Local','Local','active',${owner}::uuid,'10000000-0000-0000-0000-000000000001'::uuid from generate_series(1,10000)n returning id`;
        const ids = companies.map((c) => c.id);
        const eligibleRepo = createAnnualReturnRepository({ sql: tx, today: "2026-10-02" });
        expect(
          await eligibleRepo.listCompaniesEligibleForCase({
            q: key + " Scale 05001",
            teamId: "10000000-0000-0000-0000-000000000001",
            limit: 1,
          }),
        ).toHaveLength(1);
        expect(
          await eligibleRepo.listCompaniesEligibleForCase({
            q: key + " Scale 05001",
            teamId: "10000000-0000-0000-0000-000000000002",
            limit: 1,
          }),
        ).toEqual([]);
        await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id)select id,2026,'2026-09-01'::date,'2026-10-01'::date,'Documents pending','green',${owner}::uuid from companies where id=any(${ids}::uuid[])`;
        await tx`insert into annual_return_checklist_items(case_id,item_label,required,status,due_date)select id,'Owned missing document',true,'Missing','2026-10-01'::date from annual_return_cases where company_id=any(${ids}::uuid[])`;
        const repository = createAnnualReturnRepository({ sql: tx, today: "2026-10-02" });
        const scope = { q: key };
        const metrics = await repository.workViewMetrics({ scope, viewerUserId: owner });
        expect(metrics).toMatchObject({
          chaseToday: 10000,
          newlyReceived: 0,
          awaitingMyReview: 0,
          readyToFile: 0,
          returnsAndExceptions: 0,
        });
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await repository.listWorkView({
            view: "chaseToday",
            scope,
            viewerUserId: owner,
            cursor,
            limit: 200,
          });
          expect(page.rows.length).toBeLessThanOrEqual(200);
          for (const row of page.rows) {
            expect(seen.has(row.caseId)).toBe(false);
            seen.add(row.caseId);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(seen.size).toBe(10000);
        const clients = createClientRepository({ sql: tx });
        const firstClientPage = await clients.listClientPage({ q: key, limit: 200 });
        expect(firstClientPage).toMatchObject({ total: 10000 });
        expect(firstClientPage.clients).toHaveLength(200);
        expect(firstClientPage.nextCursor).toBeTruthy();
        expect(
          (await clients.listClientPage({ q: key + " Scale 05001", limit: 1 })).clients,
        ).toHaveLength(1);
        await tx`insert into documents(company_id,case_id,file_type,file_name,storage_url,upload_source,verification_status,uploaded_by)
          select arc.company_id,arc.id,'Other',${key}||' Doc '||lpad((row_number() over(order by arc.id,n))::text,5,'0'),${key}||'/'||arc.id||'/'||n,'staff','pending',${owner}::uuid
          from annual_return_cases arc cross join generate_series(1,5)n where arc.company_id=any(${ids}::uuid[])`;
        const documents = createDocumentRepository({ sql: tx });
        const firstDocPage = await documents.listDocumentPage({ q: key, limit: 200 });
        expect(firstDocPage.documents).toHaveLength(200);
        expect(firstDocPage.nextCursor).toBeTruthy();
        expect(
          (
            await documents.listDocumentPage({
              q: key,
              limit: 200,
              cursor: firstDocPage.nextCursor!,
            })
          ).documents,
        ).toHaveLength(200);
        await expect(documents.listDocuments({ q: key })).rejects.toThrow("use listDocumentPage");
        await expect(clients.listClients({ q: key })).rejects.toThrow("use listClientPage");
        expect(
          (await documents.listDocumentPage({ q: key + " Doc 50000", limit: 1 })).documents,
        ).toHaveLength(1);
        let docCursor: string | undefined;
        const docSeen = new Set<string>();
        do {
          const page = await documents.listDocumentPage({ q: key, limit: 200, cursor: docCursor });
          for (const doc of page.documents) {
            expect(docSeen.has(doc.id)).toBe(false);
            docSeen.add(doc.id);
          }
          docCursor = page.nextCursor ?? undefined;
        } while (docCursor);
        expect(docSeen.size).toBe(50000);
        expect(
          (
            await documents.listDocumentPage({
              q: key,
              teamId: "10000000-0000-0000-0000-000000000002",
              assignedUserId: "20000000-0000-0000-0000-000000000002",
            })
          ).documents,
        ).toEqual([]);
        for (const n of [201, 401, 5001, 10000]) {
          const page = await repository.listWorkView({
            view: "chaseToday",
            scope: { q: key + " Scale " + String(n).padStart(5, "0") },
            viewerUserId: owner,
            limit: 1,
          });
          expect(page.rows).toHaveLength(1);
        }
        expect(
          (
            await repository.listWorkView({
              view: "chaseToday",
              scope: { ...scope, visibleToUserId: "20000000-0000-0000-0000-000000000002" },
              viewerUserId: owner,
            })
          ).rows,
        ).toEqual([]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }, 120000);
});
