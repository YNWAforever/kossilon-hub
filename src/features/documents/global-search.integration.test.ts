import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createDocumentRepository } from "./repository";
import { createBulkOperationsRepository } from "@/features/bulk-operations/repository";
import type { SqlClient } from "@/server/db/client";
describe.skipIf(!process.env.TEST_DATABASE_URL)("R17 global document search", () => {
  it("counts all1000 authorized rows and finds Chinese literal tail without loading it first", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const team = randomUUID(),
            tag = randomUUID();
          await tx`insert into teams(id,name) values (${team},'R17 owned')`;
          const [f] =
            await tx`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
 select 'R17global',${tag},${tag},incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,${team},'client' from companies limit 1 returning id company_id`;
          await tx`insert into documents(company_id,file_type,file_name,storage_url,verification_status,uploaded_at,upload_source)
 select ${f.company_id},'payment',case when n=1000 then '尾頁中文 100%_literal.pdf' else ${tag}||n||'.pdf' end,${tag}||n,'pending','2026-10-01T00:00:00.123456Z','staff' from generate_series(1,1000)n`;
          const repo = createDocumentRepository({ sql: tx });
          expect((await repo.listDocumentPage({ teamId: team })).documents).toHaveLength(50);
          await expect(repo.listDocumentPage({ teamId: team, limit: 51 })).rejects.toThrow();
          const page = await repo.listDocumentPage({ teamId: team, limit: 50 });
          expect(page.documents).toHaveLength(50);
          expect(page.total).toBe(1000);
          await tx`update documents set verification_status='verified' where company_id=${f.company_id}`;
          // Legacy metadata's old status is not a review of the current bytes.
          expect(
            (await repo.listDocumentPage({ teamId: team, reviewStatus: "pending", limit: 50 }))
              .total,
          ).toBe(1000);
          const found = await repo.listDocumentPage({ teamId: team, q: "中文 100%_", limit: 50 });
          expect(found.documents.map((d) => d.fileName)).toEqual(["尾頁中文 100%_literal.pdf"]);
          expect(found.total).toBe(1);
          await expect(
            repo.listDocumentPage({
              teamId: team,
              q: "changed",
              cursor: page.nextCursor!,
              limit: 50,
            }),
          ).rejects.toThrow(/cursor/i);
          expect((await repo.listDocumentPage({ teamId: randomUUID(), limit: 50 })).total).toBe(0);
          const next = await repo.listDocumentPage({
            teamId: team,
            limit: 50,
            cursor: page.nextCursor!,
          });
          expect(new Set([...page.documents, ...next.documents].map((d) => d.id)).size).toBe(100);
          const manager = randomUUID(),
            authId = "r17-" + manager;
          await tx`insert into users(id,name,email,role,team_id,active) values (${manager},'R17 manager',${manager + "@example.test"},'Manager',${team},true)`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values (${manager},${authId},'Manager',${team},true)`;
          const actor = {
            userId: manager,
            authUserId: authId,
            role: "Manager" as const,
            teamId: team,
            active: true,
          };
          const bulk = createBulkOperationsRepository({ sql: tx as unknown as SqlClient });
          expect(
            (
              await bulk.createSnapshot(actor, {
                resource: "document",
                filters: {
                  q: "中文 100%_",
                  documentCategory: "payment",
                  documentReviewStatus: "pending",
                },
              })
            ).count,
          ).toBe(found.total);
          const snapshot = await bulk.createSnapshot(actor, {
            resource: "document",
            filters: { documentCategory: "payment", documentReviewStatus: "pending" },
          });
          expect(snapshot.count).toBe(1000);
          await tx`insert into documents(company_id,file_type,file_name,storage_url,verification_status,upload_source) values (${f.company_id},'payment','New after snapshot.pdf',${tag}||'new','pending','staff')`;
          expect(
            (
              await tx`select jsonb_array_length(items)::int n from bulk_selection_snapshots where id=${snapshot.snapshotId}`
            )[0].n,
          ).toBe(1000);
          throw Error("rollback R17 documents");
        }),
      ).rejects.toThrow("rollback R17 documents");
    } finally {
      await sql.end();
    }
  }, 30000);
});
