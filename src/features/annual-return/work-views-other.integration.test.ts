import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createOtherWorkReadRepository } from "./work-views-other-repository";
import { otherWorkPageForActor } from "./work-views-other-page";

// Run only by the parent after its exact disposable-target identity gate.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("Today other-business SQL read projection", () => {
  let sql: SqlClient;
  beforeAll(() => {
    sql = createSqlClient(databaseUrl!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it.each(["incorporation", "corporate_change"] as const)(
    "%s remains visible for manual follow-up after its final checklist verification",
    async (business) => {
      const rollback = new Error("owned Today final-verification rollback");
      let verified = false;
      try {
        await sql.begin(async (tx) => {
          const prefix = `Today-final-${randomUUID()}`;
          const teamId = randomUUID(),
            ownerId = randomUUID(),
            companyId = randomUUID(),
            caseId = randomUUID();
          await tx`insert into teams(id,name) values(${teamId},${prefix})`;
          await tx`insert into users(id,name,email,role,team_id) values(${ownerId},'Today follow-up owner',${prefix + "@example.test"},'Staff',${teamId})`;
          if (business === "incorporation") {
            await tx`insert into incorporation_cases(id,proposed_company_name_en,proposed_registered_office,proposed_company_secretary,registered_capital,business_nature,status,owner_id,team_id,target_completion_date)
              values(${caseId},${prefix},'Synthetic office','Synthetic secretary',10000,'Synthetic','Documents pending',${ownerId},${teamId},'2026-10-22')`;
            await tx`insert into incorporation_checklist_items(case_id,item_label,required,status,received_at)
              values(${caseId},'Final required evidence',true,'Received',now())`;
          } else {
            await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
              values(${companyId},${prefix},${prefix + "-cr"},${prefix + "-br"},'2020-01-01','2020-01-01','Synthetic office','Synthetic secretary',${ownerId},${teamId},'fixture')`;
            await tx`insert into corporate_change_requests(id,company_id,change_type,status,owner_id,quoted_fee,new_registered_office)
              values(${caseId},${companyId},'address_change','Documents pending',${ownerId},100,'Synthetic new office')`;
            await tx`insert into corporate_change_checklist_items(request_id,item_label,required,status,received_at)
              values(${caseId},'Final required evidence',true,'Received',now())`;
          }
          const repository = createOtherWorkReadRepository(tx as unknown as SqlClient);
          const actor = {
            authUserId: ownerId,
            userId: ownerId,
            role: "Staff" as const,
            active: true,
            teamId,
          };
          const read = (view: "newlyReceived" | "returnsAndExceptions" | "readyToFile") =>
            otherWorkPageForActor(actor, { view, q: prefix }, repository, "2026-10-23");
          expect((await read("newlyReceived")).rows.map((row) => row.caseId)).toEqual([caseId]);
          if (business === "incorporation")
            await tx`update incorporation_checklist_items set status='Verified',verified_at=now(),updated_at=now() where case_id=${caseId}`;
          else
            await tx`update corporate_change_checklist_items set status='Verified',verified_at=now(),updated_at=now() where request_id=${caseId}`;

          const followUp = await read("returnsAndExceptions");
          expect(followUp.rows.map((row) => row.caseId)).toEqual([caseId]);
          expect(followUp.rows[0]).toMatchObject({
            business,
            status: "Documents pending",
            readyForApproval: false,
          });
          expect(followUp.rows[0].blocker).toMatch(/未完成/);
          expect(followUp.rows[0].nextStep).toMatch(/人手/);
          expect((await read("newlyReceived")).rows).toEqual([]);
          expect((await read("readyToFile")).rows).toEqual([]);
          verified = true;
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      expect(verified).toBe(true);
    },
  );

  it("scopes both businesses before keyset pagination and excludes completed work", async () => {
    const rollback = new Error("owned Today read fixture rollback");
    let verified = false;
    try {
      await sql.begin(async (tx) => {
        const prefix = `Today-${randomUUID()}`;
        const teamA = randomUUID(),
          teamB = randomUUID(),
          owner = randomUUID();
        const company = randomUUID(),
          incA = randomUUID(),
          incB = randomUUID(),
          closed = randomUUID(),
          change = randomUUID();
        await tx`insert into teams(id,name) values(${teamA},${prefix + "-a"}),(${teamB},${prefix + "-b"})`;
        await tx`insert into users(id,name,email,role,team_id) values(${owner},'Today synthetic owner',${prefix + "@example.test"},'Staff',${teamA})`;
        await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
          values(${company},${prefix},${prefix + "-cr"},${prefix + "-br"},'2020-01-01','2020-01-01','Synthetic office','Synthetic secretary',${owner},${teamA},'fixture')`;
        for (const [id, team, status] of [
          [incA, teamA, "Documents pending"],
          [incB, teamB, "Documents pending"],
          [closed, teamA, "Completed"],
        ]) {
          await tx`insert into incorporation_cases(id,proposed_company_name_en,proposed_registered_office,proposed_company_secretary,registered_capital,business_nature,status,owner_id,team_id,target_completion_date,company_id,completed_at)
            values(${id},${prefix + "-" + id},'Synthetic office','Synthetic secretary',10000,'Synthetic',${status},${owner},${team},'2026-10-22',${status === "Completed" ? company : null}::uuid,${status === "Completed" ? "2026-10-20T00:00:00Z" : null}::timestamptz)`;
          await tx`insert into incorporation_checklist_items(case_id,item_label,required,status) values(${id},'Synthetic CDD',true,'Missing')`;
        }
        await tx`insert into corporate_change_requests(id,company_id,change_type,status,owner_id,quoted_fee,new_registered_office)
          values(${change},${company},'address_change','Requested',${owner},100,'Synthetic new office')`;
        await tx`insert into corporate_change_checklist_items(request_id,item_label,required,status) values(${change},'Synthetic board approval',true,'Missing')`;
        const repository = createOtherWorkReadRepository(tx as unknown as SqlClient);
        const actor = {
          authUserId: owner,
          userId: owner,
          role: "Staff" as const,
          active: true,
          teamId: teamA,
        };
        const first = await otherWorkPageForActor(
          actor,
          { view: "chaseToday", q: prefix, limit: 1 },
          repository,
          "2026-10-23",
        );
        expect(first.rows.map((r) => r.caseId)).toEqual([incA]);
        expect(first.rows[0]).toMatchObject({
          target: "/incorporation/$id",
          daysRemaining: -1,
          blocker: "Synthetic CDD",
        });
        expect(first.nextCursor).toEqual(expect.any(String));
        const second = await otherWorkPageForActor(
          actor,
          { view: "chaseToday", q: prefix, limit: 1, cursor: first.nextCursor! },
          repository,
          "2026-10-23",
        );
        expect(second.rows.map((r) => r.caseId)).toEqual([change]);
        expect(second.rows[0]).toMatchObject({
          target: "/corporate-changes/$id",
          dueDate: null,
          reviewerName: null,
          readyForApproval: false,
        });
        expect(second.nextCursor).toBeNull();
        const admin = await otherWorkPageForActor(
          { ...actor, role: "Admin" },
          { view: "chaseToday", q: prefix },
          repository,
          "2026-10-23",
        );
        expect(admin.rows.map((r) => r.caseId).sort()).toEqual([incA, incB, change].sort());
        expect(admin.rows.some((r) => r.caseId === closed)).toBe(false);
        verified = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(verified).toBe(true);
  });
});
