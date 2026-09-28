import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  applyOneCaseOwnerAssignmentForActor,
  applyOneClientOwnerAssignmentForActor,
  previewCaseOwnerAssignmentsForActor,
  previewClientOwnerAssignmentsForActor,
} from "./assignment-handler";
import {
  addPageToSelection,
  changeSelectionFilter,
  newBulkSelection,
  retryFailedSelection,
} from "./selection";

describe("T22 bulk assignment selection", () => {
  it("t22_scenario_1 keeps 401 distinct cross-page IDs, clears on filter change, and retries failed items only", () => {
    const ids = Array.from(
      { length: 401 },
      (_, index) => `30000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    );
    let selection = newBulkSelection("team=open");
    selection = addPageToSelection(selection, ids.slice(0, 201));
    selection = addPageToSelection(selection, [ids[200]!, ...ids.slice(201)]);
    expect(selection.ids).toHaveLength(401);
    expect(new Set(selection.ids).size).toBe(401);
    selection = changeSelectionFilter(selection, "team=blocked");
    expect(selection.ids).toEqual([]);
    expect(selection.notice).toMatch(/cleared/i);
    selection = retryFailedSelection("team=blocked", [
      { resourceId: ids[0]!, state: "succeeded" },
      { resourceId: ids[1]!, state: "failed" },
      { resourceId: ids[2]!, state: "forbidden" },
      { resourceId: ids[1]!, state: "failed" },
    ]);
    expect(selection.ids).toEqual([ids[1]]);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("T22 case owner assignment on disposable PostgreSQL", () => {
  it("t22_scenario_2 refuses cross-team, inactive target and locked cases per item while allowing the eligible case", async () => {
    const db = createSqlClient(databaseUrl!, { max: 2 });
    const rollback = new Error("T22 fixture rollback");
    try {
      await expect(
        db.begin(async (tx) => {
          const teamA = crypto.randomUUID();
          const teamB = crypto.randomUUID();
          const managerId = crypto.randomUUID();
          const oldOwnerId = crypto.randomUUID();
          const targetId = crypto.randomUUID();
          const inactiveId = crypto.randomUUID();
          const authUserId = `t22-${managerId}`;
          const actor: AuthenticatedActor = {
            authUserId,
            userId: managerId,
            role: "Manager",
            teamId: teamA,
            active: true,
          };
          await tx`insert into teams(id,name) values
          (${teamA},${`T22 A ${teamA}`}),(${teamB},${`T22 B ${teamB}`})`;
          for (const [id, role, teamId, active] of [
            [managerId, "Manager", teamA, true],
            [oldOwnerId, "Staff", teamB, true],
            [targetId, "Staff", teamA, true],
            [inactiveId, "Staff", teamA, false],
          ] as const) {
            await tx`insert into users(id,name,email,role,team_id,active)
            values (${id},${`T22 ${id}`},${`${id}@example.invalid`},${role},${teamId},${active})`;
            await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active)
            values (${id},${id === managerId ? authUserId : `t22-${id}`},${role},${teamId},${active})`;
          }
          const caseIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
          for (const [index, caseId] of caseIds.entries()) {
            const companyId = crypto.randomUUID();
            const teamId = index === 1 ? teamB : teamA;
            await tx`insert into companies(id,company_name,cr_number,br_number,
            incorporation_date,annual_return_basis_date,registered_office,
            company_secretary,assigned_owner_id,assigned_team_id,data_origin)
            values (${companyId},${`T22 ${caseId}`},${`CR-${companyId}`},${`BR-${companyId}`},
              '2020-01-01','2026-01-01','Test address','Test secretary',
              ${managerId},${teamId},'fixture')`;
            await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,
            filing_due_date,current_status,owner_id,locked_at)
            values (${caseId},${companyId},2026,'2026-01-01','2026-02-11',
              'Upcoming',${managerId},${index === 2 ? new Date().toISOString() : null})`;
          }
          const preview = await previewCaseOwnerAssignmentsForActor(
            actor,
            { caseIds, ownerId: targetId },
            { sql: tx },
          );
          expect(preview.map((item) => [item.state, item.reasonCode])).toEqual([
            ["eligible", null],
            ["forbidden", "CASE_OUT_OF_SCOPE"],
            ["conflict", "CASE_LOCKED"],
          ]);
          expect(preview[1]).toMatchObject({
            revision: null,
            oldOwnerId: null,
            oldTeamId: null,
          });
          const foreignTargetPreview = await previewCaseOwnerAssignmentsForActor(
            actor,
            { caseIds: [caseIds[0]!], ownerId: oldOwnerId },
            { sql: tx },
          );
          expect(foreignTargetPreview[0]).toMatchObject({
            state: "conflict",
            reasonCode: "TARGET_UNAVAILABLE",
            newTeamId: null,
          });
          const inactivePreview = await previewCaseOwnerAssignmentsForActor(
            actor,
            { caseIds: [caseIds[0]!], ownerId: inactiveId },
            { sql: tx },
          );
          expect(inactivePreview[0]).toMatchObject({
            state: "conflict",
            reasonCode: "TARGET_UNAVAILABLE",
          });
          await expect(
            applyOneCaseOwnerAssignmentForActor(
              actor,
              { caseId: caseIds[0]!, ownerId: inactiveId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/inactive|unprovisioned/i);
          await expect(
            applyOneCaseOwnerAssignmentForActor(
              actor,
              { caseId: caseIds[1]!, ownerId: targetId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/forbidden|team/i);
          await expect(
            applyOneCaseOwnerAssignmentForActor(
              actor,
              { caseId: caseIds[2]!, ownerId: targetId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/locked|completed/i);
          const result = await applyOneCaseOwnerAssignmentForActor(
            actor,
            { caseId: caseIds[0]!, ownerId: targetId, expectedAssignmentRevision: 1 },
            { sql: tx },
          );
          expect(result.revision).toBe(2);
          const [updated] = await tx<{ owner_id: string; assignment_revision: number }[]>`
          select owner_id,assignment_revision from annual_return_cases where id=${caseIds[0]}`;
          expect(updated).toMatchObject({ owner_id: targetId, assignment_revision: 2 });
          await expect(
            applyOneCaseOwnerAssignmentForActor(
              actor,
              { caseId: caseIds[0]!, ownerId: managerId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/revision changed/i);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.end();
    }
  }, 60_000);
});

describe.skipIf(!databaseUrl)("T22 client owner assignment on disposable PostgreSQL", () => {
  it("t22 client assignment rechecks team, target and revision per item while eligible clients succeed", async () => {
    const db = createSqlClient(databaseUrl!, { max: 2 });
    const rollback = new Error("T22 client fixture rollback");
    try {
      await expect(
        db.begin(async (tx) => {
          const teamA = crypto.randomUUID();
          const teamB = crypto.randomUUID();
          const managerId = crypto.randomUUID();
          const targetId = crypto.randomUUID();
          const inactiveId = crypto.randomUUID();
          const actor: AuthenticatedActor = {
            authUserId: `t22-client-${managerId}`,
            userId: managerId,
            role: "Manager",
            teamId: teamA,
            active: true,
          };
          await tx`insert into teams(id,name) values
          (${teamA},${`T22 Client A ${teamA}`}),(${teamB},${`T22 Client B ${teamB}`})`;
          for (const [id, role, teamId, active] of [
            [managerId, "Manager", teamA, true],
            [targetId, "Staff", teamA, true],
            [inactiveId, "Staff", teamA, false],
          ] as const) {
            await tx`insert into users(id,name,email,role,team_id,active)
            values (${id},${`T22 Client ${id}`},${`${id}@example.invalid`},
              ${role},${teamId},${active})`;
            await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active)
            values (${id},${id === managerId ? actor.authUserId : `t22-client-${id}`},
              ${role},${teamId},${active})`;
          }
          const eligibleId = crypto.randomUUID();
          const foreignId = crypto.randomUUID();
          for (const [id, teamId] of [
            [eligibleId, teamA],
            [foreignId, teamB],
          ] as const) {
            await tx`insert into companies(id,company_name,cr_number,br_number,
            incorporation_date,annual_return_basis_date,registered_office,
            company_secretary,assigned_owner_id,assigned_team_id,data_origin)
            values (${id},${`T22 Client ${id}`},${`CR-${id}`},${`BR-${id}`},
              '2020-01-01','2026-01-01','Test address','Test secretary',
              ${managerId},${teamId},'client')`;
          }
          const preview = await previewClientOwnerAssignmentsForActor(
            actor,
            { clientIds: [eligibleId, foreignId], ownerId: targetId },
            { sql: tx },
          );
          expect(preview.map((item) => [item.state, item.reasonCode])).toEqual([
            ["eligible", null],
            ["forbidden", "CLIENT_OUT_OF_SCOPE"],
          ]);
          expect(preview[1]).toMatchObject({
            revision: null,
            oldOwnerId: null,
            oldTeamId: null,
          });
          const inactive = await previewClientOwnerAssignmentsForActor(
            actor,
            { clientIds: [eligibleId], ownerId: inactiveId },
            { sql: tx },
          );
          expect(inactive[0]).toMatchObject({
            state: "conflict",
            reasonCode: "TARGET_UNAVAILABLE",
          });
          await expect(
            applyOneClientOwnerAssignmentForActor(
              actor,
              { clientId: foreignId, ownerId: targetId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/forbidden|team/i);
          await expect(
            applyOneClientOwnerAssignmentForActor(
              actor,
              { clientId: eligibleId, ownerId: inactiveId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/inactive|unavailable/i);
          const applied = await applyOneClientOwnerAssignmentForActor(
            actor,
            { clientId: eligibleId, ownerId: targetId, expectedAssignmentRevision: 1 },
            { sql: tx },
          );
          expect(applied).toMatchObject({ clientId: eligibleId, revision: 2 });
          const [saved] = await tx<{ assigned_owner_id: string; assignment_revision: number }[]>`
          select assigned_owner_id,assignment_revision from companies where id=${eligibleId}`;
          expect(saved).toMatchObject({ assigned_owner_id: targetId, assignment_revision: 2 });
          await expect(
            applyOneClientOwnerAssignmentForActor(
              actor,
              { clientId: eligibleId, ownerId: managerId, expectedAssignmentRevision: 1 },
              { sql: tx },
            ),
          ).rejects.toThrow(/revision changed/i);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.end();
    }
  }, 60_000);
});
