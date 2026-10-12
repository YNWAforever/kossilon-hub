import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createPaymentWorkspaceRepository } from "./payment-workspace-repository";
import { attachCaseReadiness } from "./readiness-repository";
import type { AnnualReturnCase } from "./types";
describe.skipIf(!process.env.TEST_DATABASE_URL)("R17 joined payment workspace", () => {
  it("joins proof on case201, includes debt without proof and refuses cross-team/Client/revoked reads", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const team = randomUUID(),
            tag = randomUUID();
          await tx`insert into teams(id,name) values (${team},'R17 payment scope')`;
          const [owner] = await tx`select id from users where active limit 1`;
          const companies =
            await tx`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
 select ${tag}||'-'||lpad(n::text,3,'0'),${tag}||n,${tag}||n,'2020-01-01','2026-01-01','Test','Test',${owner.id},${team},'client' from generate_series(1,201)n returning id,company_name`;
          const cases =
            await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
 select id,2026,'2026-01-01','2026-02-12','Payment pending',${owner.id} from companies where assigned_team_id=${team} returning id,company_id`;
          await tx`insert into payments(company_id,case_id,invoice_number,amount,due_date,status) select company_id,id,${tag},1200,'2026-02-12','Payment pending' from annual_return_cases where company_id=any(${companies.map((c) => c.id)}::uuid[])`;
          const target = cases.find(
            (c) => c.company_id === companies.find((c) => c.company_name.endsWith("-201"))!.id,
          )!;
          const [proof] =
            await tx`insert into documents(company_id,case_id,file_type,file_name,storage_url,verification_status,upload_source) values (${target.company_id},${target.id},'payment','中文尾頁-proof.pdf',${tag},'pending','staff') returning id`;
          const actor = {
            userId: owner.id,
            authUserId: "owned-r17",
            teamId: team,
            active: true,
            role: "Manager" as const,
          };
          const repo = createPaymentWorkspaceRepository(tx);
          const page = await repo.list(actor, { mode: "review" });
          expect(page.total).toBe(1);
          expect(page.items[0]).toMatchObject({
            caseId: target.id,
            document: { id: proof.id },
            payment: { receivedAmount: 0, balance: 1200 },
          });
          expect(page.items[0].sourceVersion).toMatch(/^[a-f0-9]{32}$/);
          expect(
            (await attachCaseReadiness(tx, [{ id: target.id } as AnnualReturnCase]))[0].readiness
              ?.sourceVersion,
          ).toBe(page.items[0].sourceVersion);
          const [secondProof] =
            await tx`insert into documents(company_id,case_id,file_type,file_name,storage_url,verification_status,upload_source) values (${target.company_id},${target.id},'payment','second-proof.pdf',${tag}||'second','pending','staff') returning id`;
          const two = await repo.list(actor, { mode: "review" });
          expect(two.total).toBe(2);
          expect(new Set(two.items.map((r) => r.rowId))).toEqual(
            new Set([proof.id, secondProof.id]),
          );
          expect(two.items.every((r) => r.caseId === target.id)).toBe(true);
          expect(two.items[0].sourceVersion).not.toBe(page.items[0].sourceVersion);
          const debt = await repo.list(actor, { mode: "outstanding" });
          expect(debt.total).toBe(201);
          expect(debt.items).toHaveLength(50);
          expect(debt.items.some((r) => r.document === null)).toBe(true);
          const ids = new Set(debt.items.map((r) => r.caseId));
          let cursor = debt.nextCursor;
          while (cursor) {
            const next = await repo.list(actor, { mode: "outstanding", cursor });
            for (const row of next.items) {
              expect(ids.has(row.caseId)).toBe(false);
              ids.add(row.caseId);
            }
            cursor = next.nextCursor;
          }
          expect(ids.size).toBe(201);
          expect(
            (await repo.list({ ...actor, teamId: randomUUID() }, { mode: "review" })).total,
          ).toBe(0);
          await expect(repo.list({ ...actor, teamId: null }, { mode: "review" })).rejects.toThrow(
            /Forbidden/,
          );
          await expect(repo.list({ ...actor, role: "Client" }, { mode: "review" })).rejects.toThrow(
            /Forbidden/,
          );
          await expect(repo.list({ ...actor, active: false }, { mode: "review" })).rejects.toThrow(
            /Forbidden/,
          );
          await expect(
            repo.list(actor, { mode: "review", cursor: debt.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          throw Error("rollback R17 payments");
        }),
      ).rejects.toThrow("rollback R17 payments");
    } finally {
      await sql.end();
    }
  }, 30000);
});
