import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createBulkOperationsRepository } from "@/features/bulk-operations/repository";
import { readCompanyWorkPage } from "@/features/clients/company-work";
import { createDocumentRepository } from "./repository";

// Parent owns execution on its verified disposable target. Every test rolls back
// its own synthetic company, staff profile, cases, metadata and snapshot together.
const databaseUrl = process.env.TEST_DATABASE_URL;
let connection: SqlClient | undefined;
function sqlForTests() {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL required for this integration test");
  return (connection ??= createSqlClient(databaseUrl, { max: 1 }));
}
afterAll(async () => {
  await connection?.end();
});

async function syntheticCompany(tx: SqlClient) {
  const companyId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const token = `cosec-r26-${companyId}`;
  const [company] = await tx<{ team_id: string }[]>`
    insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,
      registered_office,company_secretary,status,assigned_owner_id,assigned_team_id,data_origin)
    select ${companyId},${token},${"CR-" + companyId},${"BR-" + companyId},incorporation_date,annual_return_basis_date,
      registered_office,company_secretary,'active',assigned_owner_id,assigned_team_id,'client'
    from companies order by created_at,id limit 1 returning assigned_team_id team_id`;
  if (!company) throw new Error("A synthetic seeded company is required");
  await tx`insert into users(id,name,email,role,team_id,active) values(${userId},'Synthetic CoSec reviewer',${userId + "@example.test"},'Admin',${company.team_id},true)`;
  await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${userId},${token},'Admin',${company.team_id},true)`;
  const actor: AuthenticatedActor = {
    authUserId: token,
    userId,
    role: "Admin",
    teamId: company.team_id,
    active: true,
  };
  return { companyId, token, actor, teamId: company.team_id };
}

describe.skipIf(!databaseUrl)("company register exact scoped pages and counts", () => {
  it("keeps metadata visible and matches cross-page document ids to the filtered snapshot count", async () => {
    const rollback = new Error("R26 synthetic transaction rollback");
    await expect(
      sqlForTests().begin(async (transaction) => {
        const tx = transaction as unknown as SqlClient;
        const fixture = await syntheticCompany(tx);
        const expectedIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort();
        for (const id of expectedIds) {
          await tx`insert into documents(id,company_id,file_type,file_name,storage_url,upload_source,verification_status,uploaded_at)
          values(${id},${fixture.companyId},'payment','proof.pdf',${"synthetic/" + id},'client','verified','2026-10-23 01:00:00.123456+00')`;
        }
        for (const [category, source] of [
          ["identity", "client"],
          ["payment", "staff"],
        ]) {
          await tx`insert into documents(company_id,file_type,file_name,storage_url,upload_source,verification_status)
          values(${fixture.companyId},${category},'exclude.pdf',${"synthetic/" + crypto.randomUUID()},${source},'pending')`;
        }
        const filters = {
          q: fixture.token,
          source: "client",
          category: "payment",
          reviewStatus: "pending" as const,
        };
        const repository = createDocumentRepository({ sql: transaction });
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await repository.listDocumentPage({ ...filters, limit: 1, cursor });
          expect(page.documents).toHaveLength(1);
          expect(page.documents[0]).toMatchObject({
            availability: "metadata_only",
            reviewStatus: "pending",
            objectAvailability: "not_checked",
          });
          ids.push(page.documents[0].id);
          expect(ids.length).toBeLessThanOrEqual(3);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(ids).toEqual(expectedIds);
        const snapshot = await createBulkOperationsRepository({ sql: tx }).createSnapshot(
          fixture.actor,
          { resource: "document", filters },
        );
        expect(snapshot.count).toBe(3);
        const [saved] = await tx<
          { items: { id: string }[] }[]
        >`select items from bulk_selection_snapshots where id=${snapshot.snapshotId}`;
        expect(saved.items.map((item) => item.id).sort()).toEqual(expectedIds);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("reads three exact company businesses with consistent metrics and denies another team's scope", async () => {
    const rollback = new Error("R19 synthetic transaction rollback");
    await expect(
      sqlForTests().begin(async (transaction) => {
        const tx = transaction as unknown as SqlClient;
        const fixture = await syntheticCompany(tx);
        await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,owner_id,created_at)
        values(${fixture.companyId},2026,'2026-10-23','2026-12-04','Documents pending',${fixture.actor.userId!},'2026-10-23 01:00:00.123456+00')`;
        await tx`insert into incorporation_cases(proposed_company_name_en,proposed_registered_office,proposed_company_secretary,registered_capital,business_nature,status,owner_id,team_id,target_completion_date,company_id,completed_at,created_at)
        values('Synthetic intake','Synthetic office','Synthetic secretary',10000,'Synthetic','Completed',${fixture.actor.userId!},${fixture.teamId},'2026-10-23',${fixture.companyId},now(),'2026-10-23 01:00:00.123456+00')`;
        await tx`insert into corporate_change_requests(company_id,change_type,status,owner_id,quoted_fee,new_name_en,created_at)
        values(${fixture.companyId},'name_change','Requested',${fixture.actor.userId!},100,'Synthetic new name','2026-10-23 01:00:00.123456+00')`;
        const kinds: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await readCompanyWorkPage(tx, fixture.actor, {
            companyId: fixture.companyId,
            limit: 1,
            cursor,
          });
          expect(page).toMatchObject({ total: 3, unfinished: 2 });
          expect(page.items).toHaveLength(1);
          kinds.push(page.items[0].kind);
          expect(kinds.length).toBeLessThanOrEqual(3);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(kinds).toEqual(["annual_return", "corporate_change", "incorporation"]);
        const [foreignTeam] = await tx<
          { id: string }[]
        >`insert into teams(name) values('Synthetic other team') returning id`;
        const outside = await readCompanyWorkPage(
          tx,
          { ...fixture.actor, role: "Manager", teamId: foreignTeam.id },
          { companyId: fixture.companyId },
        );
        expect(outside).toEqual({ items: [], total: 0, unfinished: 0, nextCursor: null });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
