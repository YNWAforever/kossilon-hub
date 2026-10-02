import { afterAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { requireActor, type NeonSessionAdapter } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAdminRepository } from "./repository";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 4 }) : null;
afterAll(async () => {
  await sql?.end();
});
const teamId = "10000000-0000-0000-0000-000000000001";
const rollback = new Error("Admin fixture rollback");
async function observedLockWait(pid: number) {
  for (let n = 0; n < 100; n++) {
    const [state] = await sql!`select wait_event_type from pg_stat_activity where pid=${pid}`;
    if (state?.wait_event_type === "Lock") return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}
async function fixture(db: SqlClient | postgres.TransactionSql, role: "Admin" | "Staff" = "Admin") {
  const id = crypto.randomUUID(),
    authUserId = `synthetic-auth-${id}`;
  await db`insert into users(id,name,email,role,team_id,active) values(${id},'Synthetic staff lifecycle',${id + "@example.test"},${role},${teamId},true)`;
  await db`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${id},${authUserId},${role},${teamId},true)`;
  return { authUserId, userId: id, role, teamId, active: true } satisfies AuthenticatedActor;
}
const session = (actor: AuthenticatedActor): NeonSessionAdapter => ({
  getSession: async () => ({ user: { id: actor.authUserId, email: "same-email@example.test" } }),
  signOut: async () => new Response(null, { status: 204 }),
});
describe.skipIf(!url)("actual PostgreSQL staff administration", () => {
  it("rejects assignment to a user whose verified profile is inactive even when the user row is active", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const actor = await fixture(tx),
          staff = await fixture(tx, "Staff");
        const companyId = crypto.randomUUID(),
          caseId = crypto.randomUUID();
        await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${companyId},'Synthetic assignment race',${companyId},${companyId},'2020-01-01','2026-01-01','Test','Test','active',${actor.userId!},${teamId})`;
        await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id) values(${caseId},${companyId},2026,'2026-01-01','2026-02-12','Upcoming','green',${actor.userId!})`;
        await tx`update staff_profiles set active=false where user_id=${staff.userId!}`;
        expect(
          (await createAnnualReturnRepository({ sql: tx }).listAssignableStaff({ teamId })).some(
            (u) => u.id === staff.userId,
          ),
        ).toBe(false);
        await expect(
          createAnnualReturnRepository({ sql: tx }).assignOwner({
            caseId,
            ownerId: staff.userId!,
            actorId: actor.userId!,
          }),
        ).rejects.toThrow(/inactive|eligible/);
        const [row] = await tx`select owner_id from annual_return_cases where id=${caseId}`;
        expect(row.owner_id).toBe(actor.userId);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("checks exact verified identity, versions, persisted state/audit and rejects the same old session after disable", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const actor = await fixture(tx),
          staff = await fixture(tx, "Staff");
        const repo = createAdminRepository({ sql: tx });
        const before = await requireActor(new Request("https://example.test/admin"), {
          auth: session(staff),
          sql: tx as unknown as SqlClient,
        });
        expect(before.active).toBe(true);
        await expect(repo.listStaff({ ...actor, authUserId: "wrong-auth" }, {})).rejects.toThrow(
          /Admin|Forbidden/,
        );
        const page = await repo.listStaff(actor, { q: staff.userId!, limit: 1 });
        expect(page.staff).toHaveLength(1);
        expect(page.staff[0]).toMatchObject({
          userId: staff.userId,
          role: "Staff",
          lastLogin: null,
          expectedVersion: 1,
        });
        await repo.updateStaff(actor, {
          userId: staff.userId!,
          expectedVersion: 1,
          role: "Staff",
          teamId,
          active: false,
        });
        await expect(
          repo.updateStaff(actor, {
            userId: staff.userId!,
            expectedVersion: 1,
            role: "Staff",
            teamId,
            active: true,
          }),
        ).rejects.toMatchObject({ statusCode: 409 });
        await expect(
          requireActor(new Request("https://example.test/admin"), {
            auth: session(staff),
            sql: tx as unknown as SqlClient,
          }),
        ).rejects.toThrow(/inactive|Forbidden/);
        await expect(
          requireActor(new Request("https://example.test/admin"), {
            auth: session({ ...staff, authUserId: "unknown-id-same-email" }),
            sql: tx as unknown as SqlClient,
          }),
        ).rejects.toThrow(/Forbidden/);
        const [audit] = await tx<
          { count: number }[]
        >`select count(*)::int count from staff_access_events where target_user_id=${staff.userId!}`;
        expect(audit.count).toBe(1);
        const [pair] = await tx<
          { user_active: boolean; profile_active: boolean }[]
        >`select u.active user_active,sp.active profile_active from users u join staff_profiles sp on sp.user_id=u.id where u.id=${staff.userId!}`;
        expect(pair).toEqual({ user_active: false, profile_active: false });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("shows outstanding handover and refuses to disable staff or move their team while work remains", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const actor = await fixture(tx),
          staff = await fixture(tx, "Staff"),
          companyId = crypto.randomUUID(),
          caseId = crypto.randomUUID();
        await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${companyId},'Synthetic handover',${companyId},${companyId},'2020-01-01','2026-01-01','Test','Test','active',${staff.userId!},${teamId})`;
        await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id) values(${caseId},${companyId},2026,'2026-01-01','2026-02-12','Upcoming','green',${staff.userId!})`;
        const repo = createAdminRepository({ sql: tx });
        const preview = await repo.previewReassignment(actor, {
          userId: staff.userId!,
          expectedVersion: 1,
        });
        expect(preview).toMatchObject({ openCases: 1, openWorkItems: 0 });
        expect(preview.cases.map((c) => c.id)).toContain(caseId);
        await expect(
          repo.updateStaff(actor, {
            userId: staff.userId!,
            expectedVersion: 1,
            role: "Staff",
            teamId,
            active: false,
          }),
        ).rejects.toThrow(/handover/i);
        await expect(
          repo.updateStaff(actor, {
            userId: staff.userId!,
            expectedVersion: 1,
            role: "Staff",
            teamId: "10000000-0000-0000-0000-000000000002",
            active: true,
          }),
        ).rejects.toThrow(/handover/i);
        expect((await repo.listStaff(actor, { q: staff.userId! })).staff[0].active).toBe(true);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("waits for an in-flight staff disable, then rejects assignment without writing case history", async () => {
    const actor = await fixture(sql!),
      staff = await fixture(sql!, "Staff");
    const companyId = crypto.randomUUID(),
      caseId = crypto.randomUUID();
    const disabling = createSqlClient(url!, { max: 1 }),
      assigning = createSqlClient(url!, { max: 1 });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: () => void;
    const disabled = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await sql!`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${companyId},'Synthetic lifecycle overlap',${companyId},${companyId},'2020-01-01','2026-01-01','Test','Test','active',${actor.userId!},${teamId})`;
      await sql!`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id) values(${caseId},${companyId},2026,'2026-01-01','2026-02-12','Upcoming','green',${actor.userId!})`;
      const [{ pid }] = await assigning<{ pid: number }[]>`select pg_backend_pid() pid`;
      const first = disabling.begin(async (tx) => {
        const result = await createAdminRepository({ sql: tx }).updateStaff(actor, {
          userId: staff.userId!,
          expectedVersion: 1,
          role: "Staff",
          teamId,
          active: false,
        });
        ready();
        await hold;
        return result;
      });
      await Promise.race([disabled, first]);
      const second = createAnnualReturnRepository({ sql: assigning }).assignOwner({
        caseId,
        ownerId: staff.userId!,
        actorId: actor.userId!,
      });
      pending = Promise.allSettled([first, second]);
      let waited = false;
      try {
        waited = await observedLockWait(pid);
      } finally {
        release();
      }
      const results = await pending;
      expect(waited).toBe(true);
      expect(results[0].status).toBe("fulfilled");
      expect(results[1]).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ message: expect.stringMatching(/inactive|eligible/) }),
      });
      const [row] =
        await sql!`select owner_id,(select count(*)::int from annual_return_audit_events where case_id=${caseId}) audit_count from annual_return_cases where id=${caseId}`;
      expect(row).toMatchObject({ owner_id: actor.userId, audit_count: 0 });
    } finally {
      release();
      await pending;
      await sql!.begin(async (tx) => {
        await tx`delete from annual_return_audit_events where case_id=${caseId}`;
        await tx`delete from timeline_events where case_id=${caseId}`;
        await tx`delete from annual_return_cases where id=${caseId}`;
        await tx`delete from companies where id=${companyId}`;
        const own = [actor.userId!, staff.userId!];
        await tx`delete from staff_access_events where target_user_id=any(${own}::uuid[]) or actor_user_id=any(${own}::uuid[])`;
        await tx`delete from staff_profiles where user_id=any(${own}::uuid[])`;
        await tx`delete from users where id=any(${own}::uuid[])`;
      });
      await Promise.all([disabling.end(), assigning.end()]);
    }
  });
  it("serializes two independent Admin self-demotions and leaves exactly one active Admin", async () => {
    // Local serialized test database only: snapshot seed Admin active flags and restore exactly.
    const originals = await sql!<
      { user_id: string; user_active: boolean; profile_active: boolean }[]
    >`select u.id user_id,u.active user_active,sp.active profile_active from staff_profiles sp join users u on u.id=sp.user_id where sp.role='Admin' or u.role='Admin'`;
    const first = await fixture(sql!),
      second = await fixture(sql!);
    const firstConnection = createSqlClient(url!, { max: 1 }),
      secondConnection = createSqlClient(url!, { max: 1 });
    try {
      for (const original of originals) {
        await sql!`update users set active=false where id=${original.user_id}`;
        await sql!`update staff_profiles set active=false where user_id=${original.user_id}`;
      }
      const [a] = await firstConnection<{ pid: number }[]>`select pg_backend_pid() pid`,
        [b] = await secondConnection<{ pid: number }[]>`select pg_backend_pid() pid`;
      expect(a.pid).not.toBe(b.pid);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const atInvariant = new Promise<void>((resolve) => {
        started = resolve;
      });
      const firstWrite = firstConnection.begin(async (tx) => {
        const result = await createAdminRepository({ sql: tx }).updateStaff(first, {
          userId: first.userId!,
          expectedVersion: 1,
          role: "Staff",
          teamId,
          active: true,
        });
        started();
        await hold;
        return result;
      });
      await Promise.race([atInvariant, firstWrite]);
      const secondWrite = createAdminRepository({ sql: secondConnection }).updateStaff(second, {
        userId: second.userId!,
        expectedVersion: 1,
        role: "Staff",
        teamId,
        active: true,
      });
      const settled = Promise.allSettled([firstWrite, secondWrite]);
      let waited = false;
      try {
        waited = await observedLockWait(b.pid);
      } finally {
        release();
      }
      const results = await settled;
      expect(waited).toBe(true);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const [count] = await sql!<
        { n: number }[]
      >`select count(*)::int n from staff_profiles sp join users u on u.id=sp.user_id where sp.role='Admin' and u.role='Admin' and sp.active and u.active`;
      expect(count.n).toBe(1);
    } finally {
      await sql!.begin(async (tx) => {
        for (const original of originals) {
          await tx`update users set active=${original.user_active} where id=${original.user_id}`;
          await tx`update staff_profiles set active=${original.profile_active} where user_id=${original.user_id}`;
        }
        const owned = [first.userId!, second.userId!];
        await tx`delete from staff_access_events where target_user_id=any(${owned}::uuid[]) or actor_user_id=any(${owned}::uuid[])`;
        await tx`delete from staff_profiles where user_id=any(${owned}::uuid[])`;
        await tx`delete from users where id=any(${owned}::uuid[])`;
      });
      await Promise.all([firstConnection.end(), secondConnection.end()]);
    }
  });
});
