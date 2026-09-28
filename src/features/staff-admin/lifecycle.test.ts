import "dotenv/config";
import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { requireStaffActor } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  changeStaffAccessForActor,
  disableStaffForActor,
  inviteStaffForActor,
  listStaffAdministrationForActor,
  type StaffInviteProvider,
} from "./repository";

const url = process.env.TEST_DATABASE_URL;
const db: SqlClient | null = url ? createSqlClient(url, { max: 2 }) : null;
afterAll(async () => {
  await db?.end();
});
const rollback = new Error("t20-rollback");
type Fixture = {
  tx: postgres.TransactionSql;
  admins: [AuthenticatedActor, AuthenticatedActor];
  staff: AuthenticatedActor;
  staffProfileIds: [string, string, string];
  teamId: string;
  otherTeamId: string;
  caseId: string;
};
async function fixture(work: (f: Fixture) => Promise<void>) {
  if (!db) throw new Error("TEST_DATABASE_URL required.");
  try {
    await db.begin(async (tx) => {
      const teamId = crypto.randomUUID(),
        otherTeamId = crypto.randomUUID();
      await tx`insert into teams(id,name) values (${teamId},${"t20-" + teamId}),(${otherTeamId},${"t20-" + otherTeamId})`;
      const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
      const profileIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
      for (const [index, id] of ids.entries()) {
        const role = index < 2 ? "Admin" : "Staff";
        await tx`insert into users(id,name,email,role,team_id)
          values (${id},${"T20 person " + index},${id + "@example.invalid"},${role},${teamId})`;
        await tx`insert into staff_profiles(id,user_id,auth_user_id,role,team_id)
          values (${profileIds[index]},${id},${"auth-" + id},${role},${teamId})`;
      }
      // The disposable database may contain previous integration fixtures.
      // Scope this transaction's active Admin count to the two actors under test.
      await tx`update staff_profiles set active=false where role='Admin'
        and id not in (${profileIds[0]},${profileIds[1]})`;
      const companyId = crypto.randomUUID(),
        caseId = crypto.randomUUID();
      await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,
        annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,
        assigned_team_id,data_origin)
        values (${companyId},'T20 fixture',${companyId},${companyId},'2020-01-01',
          '2020-01-01','T20 office','T20 secretary',${ids[2]},${teamId},'client')`;
      await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,
        filing_due_date,current_status,owner_id)
        values (${caseId},${companyId},2026,'2026-01-01','2026-02-01',
          'Documents pending',${ids[2]})`;
      const actor = (index: number): AuthenticatedActor => ({
        authUserId: "auth-" + ids[index],
        userId: ids[index],
        role: index < 2 ? "Admin" : "Staff",
        teamId,
        active: true,
      });
      await work({
        tx,
        admins: [actor(0), actor(1)],
        staff: actor(2),
        staffProfileIds: [...profileIds],
        teamId,
        otherTeamId,
        caseId,
      });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describe.skipIf(!url)("T20 staff lifecycle", () => {
  it("t20_scenario_1 refuses to demote the last active Admin under the database guard", async () => {
    await fixture(async ({ tx, admins, staffProfileIds, teamId }) => {
      const first = await changeStaffAccessForActor(
        admins[0],
        {
          staffId: staffProfileIds[1],
          role: "Staff",
          teamId,
          expectedRevision: 1,
        },
        { sql: tx },
      );
      expect(first.role).toBe("Staff");
      await expect(
        changeStaffAccessForActor(
          admins[0],
          {
            staffId: staffProfileIds[0],
            role: "Staff",
            teamId,
            expectedRevision: 1,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/last active Admin/i);
      const [count] = await tx<{ n: number }[]>`select count(*)::int n from staff_profiles
        where role='Admin' and active=true and id in (${staffProfileIds[0]},${staffProfileIds[1]})`;
      expect(count.n).toBe(1);
    });
  });
  it("t20_scenario_2 reconciles provider-created invitation after a local link failure without a second invite", async () => {
    await fixture(async ({ tx, admins, teamId }) => {
      let invites = 0,
        found = false,
        fail = true;
      const provider: StaffInviteProvider = {
        async findByInvitationKey(key) {
          return found
            ? {
                authUserId: "neon-t20-invite",
                email: "new.staff@example.invalid",
                idempotencyKey: key,
              }
            : null;
        },
        async invite(input) {
          invites++;
          found = true;
          return {
            authUserId: "neon-t20-invite",
            email: input.email,
            idempotencyKey: input.idempotencyKey,
          };
        },
      };
      const input = {
        email: "New.Staff@Example.invalid",
        name: "New Staff",
        role: "Staff" as const,
        teamId,
        idempotencyKey: "t20-" + crypto.randomUUID(),
      };
      const dependencies = {
        sql: tx,
        provider,
        afterProviderCreated: async () => {
          if (fail) {
            fail = false;
            throw new Error("simulated local link failure");
          }
        },
      };
      await expect(inviteStaffForActor(admins[0], input, dependencies)).rejects.toThrow(
        /simulated local link failure/,
      );
      const result = await inviteStaffForActor(admins[0], input, dependencies);
      expect(result.status).toBe("linked");
      expect(result.staffId).toBeTruthy();
      expect(invites).toBe(1);
      const [profile] = await tx<{ active: boolean }[]>`select active from staff_profiles
        where user_id=${result.staffId}`;
      expect(profile.active).toBe(true);
    });
  });
  it("t20_scenario_2 refuses linking a provider identity already used by a client", async () => {
    await fixture(async ({ tx, admins, teamId, caseId }) => {
      const [currentCase] = await tx<{ company_id: string }[]>`
        select company_id from annual_return_cases where id=${caseId}
      `;
      await tx`insert into client_company_memberships(auth_user_id,company_id,role)
        values ('existing-client-auth',${currentCase.company_id},'Client')`;
      const key = "t20-" + crypto.randomUUID();
      const provider: StaffInviteProvider = {
        async findByInvitationKey() {
          return null;
        },
        async invite(input) {
          return {
            authUserId: "existing-client-auth",
            email: input.email,
            idempotencyKey: input.idempotencyKey,
          };
        },
      };
      await expect(
        inviteStaffForActor(
          admins[0],
          {
            email: "staff-collision@example.invalid",
            name: "Collision",
            role: "Staff",
            teamId,
            idempotencyKey: key,
          },
          { sql: tx, provider },
        ),
      ).rejects.toThrow(/client|membership/i);
      const [count] = await tx<{ n: number }[]>`select count(*)::int n
        from staff_profiles where auth_user_id='existing-client-auth'`;
      expect(count.n).toBe(0);
    });
  });
  it("t20_scenario_3 refuses a Manager assigning a case to another team", async () => {
    await fixture(async ({ tx, admins, otherTeamId, caseId }) => {
      const managerId = admins[1].userId!;
      const targetId = crypto.randomUUID();
      await tx`update users set role='Manager' where id=${managerId}`;
      await tx`update staff_profiles set role='Manager' where user_id=${managerId}`;
      await tx`insert into users(id,name,email,role,team_id)
        values (${targetId},'T20 outside',${targetId + "@example.invalid"},'Staff',${otherTeamId})`;
      await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id)
        values (${targetId},${"auth-" + targetId},'Staff',${otherTeamId})`;
      const { createAnnualReturnRepository } = await import("@/features/annual-return/repository");
      const repo = createAnnualReturnRepository({ sql: tx });
      await expect(
        repo.assignOwner({ caseId, ownerId: targetId, actorId: managerId }),
      ).rejects.toThrow(/team|Forbidden/i);
    });
  });
  it("t20_scenario_3 refuses to show a role-disagreed staff row as authoritative", async () => {
    await fixture(async ({ tx, admins, staff }) => {
      await tx`update users set role='Manager' where id=${staff.userId}`;
      await expect(listStaffAdministrationForActor(admins[0], { sql: tx })).rejects.toThrow(
        /disagree|inconsistent/i,
      );
    });
  });
  it("t20_scenario_3 requires handover before moving an assigned staff member to another team", async () => {
    await fixture(async ({ tx, admins, staffProfileIds, otherTeamId }) => {
      await expect(
        changeStaffAccessForActor(
          admins[0],
          {
            staffId: staffProfileIds[2],
            role: "Staff",
            teamId: otherTeamId,
            expectedRevision: 1,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/handover|outstanding/i);
    });
  });
  it("t20_scenario_3 counts open corporate-change cases before staff disable", async () => {
    await fixture(async ({ tx, admins, staff, staffProfileIds, caseId }) => {
      await tx`update annual_return_cases set current_status='Completed',
        completed_at=now() where id=${caseId}`;
      const [existingCase] = await tx<{ company_id: string }[]>`
        select company_id from annual_return_cases where id=${caseId}`;
      const [change] = await tx<{ id: string }[]>`
        insert into corporate_change_requests(company_id,change_type,owner_id,
          quoted_fee,new_name_en)
        values (${existingCase.company_id},'name_change',${staff.userId},0,
          'T20 new name') returning id
      `;
      await expect(
        disableStaffForActor(
          admins[0],
          {
            staffId: staffProfileIds[2],
            expectedRevision: 1,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/handover|outstanding/i);
      await tx`update corporate_change_requests set status='Completed',
        completed_at=now() where id=${change.id}`;
      const result = await disableStaffForActor(
        admins[0],
        {
          staffId: staffProfileIds[2],
          expectedRevision: 1,
        },
        { sql: tx },
      );
      expect(result.active).toBe(false);
    });
  });
  it("t20_scenario_3 rejects cross-team self escalation and disables access only after handover", async () => {
    await fixture(async ({ tx, admins, staff, staffProfileIds, otherTeamId, caseId }) => {
      await expect(
        changeStaffAccessForActor(
          staff,
          {
            staffId: staffProfileIds[2],
            role: "Admin",
            teamId: otherTeamId,
            expectedRevision: 1,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/Admin|Forbidden/i);
      await expect(
        disableStaffForActor(
          admins[0],
          {
            staffId: staffProfileIds[2],
            expectedRevision: 1,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/handover|outstanding/i);
      await tx`update annual_return_cases set current_status='Completed',
        completed_at=now() where id=${caseId}`;
      const result = await disableStaffForActor(
        admins[0],
        {
          staffId: staffProfileIds[2],
          expectedRevision: 1,
        },
        { sql: tx },
      );
      expect(result.active).toBe(false);
      await expect(
        requireStaffActor(new Request("https://example.invalid/admin"), {
          auth: {
            getSession: async () => ({
              user: { id: staff.authUserId, email: "staff@example.invalid" },
            }),
            signOut: async () => new Response(null),
          },
          sql: tx as unknown as SqlClient,
        }),
      ).rejects.toThrow(/inactive|Forbidden/i);
    });
  });
  it.skipIf(!process.env.T20_CONCURRENCY_DB_URL)(
    "t20_scenario_3 waits for disable before assigning a case to that staff member",
    async () => {
      const raceDb = createSqlClient(process.env.T20_CONCURRENCY_DB_URL!, { max: 3 });
      const teamId = crypto.randomUUID(),
        adminId = crypto.randomUUID();
      const staffId = crypto.randomUUID(),
        companyId = crypto.randomUUID();
      const caseId = crypto.randomUUID();
      let assignment: Promise<unknown> | null = null;
      try {
        await raceDb`insert into teams(id,name)
          values (${teamId},${"t20-race-" + teamId})`;
        for (const [id, role] of [
          [adminId, "Admin"],
          [staffId, "Staff"],
        ] as const) {
          await raceDb`insert into users(id,name,email,role,team_id)
            values (${id},${"T20 " + role},${id + "@example.invalid"},${role},${teamId})`;
          await raceDb`insert into staff_profiles(user_id,auth_user_id,role,team_id)
            values (${id},${"auth-" + id},${role},${teamId})`;
        }
        await raceDb`insert into companies(id,company_name,cr_number,br_number,
          incorporation_date,annual_return_basis_date,registered_office,
          company_secretary,assigned_owner_id,assigned_team_id,data_origin)
          values (${companyId},'T20 race',${companyId},${companyId},
            '2020-01-01','2020-01-01','T20 office','T20 secretary',
            ${adminId},${teamId},'client')`;
        await raceDb`insert into annual_return_cases(id,company_id,return_year,
          made_up_date,filing_due_date,current_status,owner_id)
          values (${caseId},${companyId},2026,'2026-01-01','2026-02-01',
            'Documents pending',${adminId})`;
        const { createAnnualReturnRepository } =
          await import("@/features/annual-return/repository");
        const repo = createAnnualReturnRepository({ sql: raceDb });
        let stateAtLock = "unstarted";
        await raceDb.begin(async (tx) => {
          await tx`select u.id from users u join staff_profiles sp on sp.user_id=u.id
            where u.id=${staffId} for update of u,sp`;
          assignment = repo.assignOwner({ caseId, ownerId: staffId, actorId: adminId });
          stateAtLock = await Promise.race([
            assignment.then(
              () => "resolved",
              () => "rejected",
            ),
            new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 300)),
          ]);
          await tx`update users set active=false where id=${staffId}`;
          await tx`update staff_profiles set active=false where user_id=${staffId}`;
        });
        const outcome = await assignment!.then(
          () => "resolved",
          () => "rejected",
        );
        expect(stateAtLock).toBe("waiting");
        expect(outcome).toBe("rejected");
        const [current] = await raceDb<{ owner_id: string }[]>`
          select owner_id from annual_return_cases where id=${caseId}`;
        expect(current.owner_id).toBe(adminId);
      } finally {
        await (assignment as Promise<unknown> | null)?.catch(() => undefined);
        await raceDb`delete from timeline_events where case_id=${caseId}`;
        await raceDb`delete from annual_return_audit_events where case_id=${caseId}`;
        await raceDb`delete from annual_return_cases where id=${caseId}`;
        await raceDb`delete from companies where id=${companyId}`;
        await raceDb`delete from staff_profiles where user_id in (${adminId},${staffId})`;
        await raceDb`delete from users where id in (${adminId},${staffId})`;
        await raceDb`delete from teams where id=${teamId}`;
        await raceDb.end();
      }
    },
  );
  it.skipIf(!process.env.T20_CONCURRENCY_DB_URL)(
    "t20_scenario_1 serializes two Admin self-demotions so one remains active",
    async () => {
      const concurrencyDb = createSqlClient(process.env.T20_CONCURRENCY_DB_URL!, { max: 4 });
      const teamId = crypto.randomUUID();
      const ids = [crypto.randomUUID(), crypto.randomUUID()] as const;
      const profileIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
      try {
        await concurrencyDb`insert into teams(id,name) values (${teamId},${"t20-concurrent-" + teamId})`;
        for (const [index, id] of ids.entries()) {
          await concurrencyDb`insert into users(id,name,email,role,team_id)
            values (${id},${"T20 concurrent " + index},${id + "@example.invalid"},'Admin',${teamId})`;
          await concurrencyDb`insert into staff_profiles(id,user_id,auth_user_id,role,team_id)
            values (${profileIds[index]},${id},${"auth-" + id},'Admin',${teamId})`;
        }
        const actor = (index: number): AuthenticatedActor => ({
          authUserId: "auth-" + ids[index],
          userId: ids[index],
          role: "Admin",
          teamId,
          active: true,
        });
        const outcomes = await Promise.allSettled([
          changeStaffAccessForActor(
            actor(0),
            {
              staffId: profileIds[0],
              role: "Staff",
              teamId,
              expectedRevision: 1,
            },
            { sql: concurrencyDb },
          ),
          changeStaffAccessForActor(
            actor(1),
            {
              staffId: profileIds[1],
              role: "Staff",
              teamId,
              expectedRevision: 1,
            },
            { sql: concurrencyDb },
          ),
        ]);
        expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
        const [count] = await concurrencyDb<{ n: number }[]>`
          select count(*)::int n from staff_profiles where role='Admin' and active=true
            and id in (${profileIds[0]},${profileIds[1]})
        `;
        expect(count.n).toBe(1);
      } finally {
        await concurrencyDb`delete from staff_access_events where target_user_id in (${ids[0]},${ids[1]})`;
        await concurrencyDb`delete from staff_profiles where id in (${profileIds[0]},${profileIds[1]})`;
        await concurrencyDb`delete from users where id in (${ids[0]},${ids[1]})`;
        await concurrencyDb`delete from teams where id=${teamId}`;
        await concurrencyDb.end();
      }
    },
  );
});
