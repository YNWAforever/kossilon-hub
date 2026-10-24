import type postgres from "postgres";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  staffFiltersSchema,
  updateStaffSchema,
  reassignmentPreviewSchema,
  type StaffFilters,
  type UpdateStaffInput,
  type StaffPage,
  type HandoverPreview,
} from "./types";
type Query = SqlClient | postgres.TransactionSql;
export class StaffAccessConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Staff version changed. Refresh before updating.");
  }
}
export function assertAdminActor(actor: AuthenticatedActor) {
  assertStaffAccess(actor);
  if (actor.role !== "Admin" || !actor.userId) throw new Error("Forbidden: Admin access required.");
}
export function createAdminRepository({ sql = getSqlClient() }: { sql?: Query } = {}) {
  const transact = <T>(run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    ("begin" in sql ? sql.begin(run) : run(sql)) as Promise<T>;
  async function requireCurrentAdmin(tx: Query, actor: AuthenticatedActor) {
    assertAdminActor(actor);
    const [current] =
      await tx`select sp.user_id from staff_profiles sp join users u on u.id=sp.user_id
      where sp.user_id=${actor.userId!} and sp.auth_user_id=${actor.authUserId} and sp.active and u.active and sp.role='Admin' and u.role='Admin' and sp.team_id is not distinct from u.team_id`;
    if (!current) throw new Error("Forbidden: current verified active Admin profile required.");
  }
  async function listStaff(
    actor: AuthenticatedActor,
    filters: StaffFilters = {},
  ): Promise<StaffPage> {
    const input = staffFiltersSchema.parse(filters);
    await requireCurrentAdmin(sql, actor);
    const limit = input.limit ?? 50;
    const rows = await sql<
      {
        user_id: string;
        name: string;
        email: string;
        role: UpdateStaffInput["role"];
        team_id: string | null;
        team_name: string | null;
        active: boolean;
        access_revision: number;
        state_mismatch: boolean;
        open_cases: number;
        open_work_items: number;
      }[]
    >`select u.id user_id,u.name,u.email,sp.role,sp.team_id,t.name team_name,sp.active and u.active active,sp.access_revision,
      (sp.role<>u.role or sp.active<>u.active or sp.team_id is distinct from u.team_id) state_mismatch,
      (select count(*)::int from annual_return_cases a where (a.owner_id=u.id or a.reviewer_id=u.id) and a.current_status<>'Completed') open_cases,
      (select count(*)::int from work_items w where (w.owner_id=u.id or w.reviewer_id=u.id) and w.status not in ('completed','cancelled')) open_work_items
      from staff_profiles sp join users u on u.id=sp.user_id left join teams t on t.id=sp.team_id
      where (${input.q ?? null}::text is null or u.name ilike ${"%" + (input.q ?? "") + "%"} or u.email ilike ${"%" + (input.q ?? "") + "%"} or u.id::text=${input.q ?? null})
      and (${input.role ?? null}::text is null or sp.role=${input.role ?? null}) and (${input.teamId ?? null}::uuid is null or sp.team_id=${input.teamId ?? null})
      and (${input.active ?? null}::boolean is null or (sp.active and u.active)=${input.active ?? null})
      and (${input.cursor ?? null}::uuid is null or u.id>${input.cursor ?? null}::uuid) order by u.id limit ${limit + 1}`;
    return {
      staff: rows.slice(0, limit).map((r) => ({
        userId: r.user_id,
        displayName: r.name,
        email: r.email,
        role: r.role,
        teamId: r.team_id,
        teamName: r.team_name,
        active: r.active,
        expectedVersion: r.access_revision,
        openCases: r.open_cases,
        openWorkItems: r.open_work_items,
        lastLogin: null,
        stateMismatch: r.state_mismatch,
      })),
      nextCursor: rows.length > limit ? rows[limit - 1].user_id : null,
    };
  }
  async function target(tx: Query, userId: string, lock = false) {
    const [row] = await tx<
      {
        id: string;
        role: UpdateStaffInput["role"];
        user_role: UpdateStaffInput["role"];
        team_id: string | null;
        user_team_id: string | null;
        active: boolean;
        user_active: boolean;
        access_revision: number;
      }[]
    >`select u.id,sp.role,u.role user_role,sp.team_id,u.team_id user_team_id,sp.active,u.active user_active,sp.access_revision from staff_profiles sp join users u on u.id=sp.user_id where u.id=${userId} ${lock ? tx`for update of sp,u` : tx``}`;
    if (!row) throw new Error("Staff profile not found.");
    if (
      row.role !== row.user_role ||
      row.team_id !== row.user_team_id ||
      row.active !== row.user_active
    )
      throw new Error(
        "Staff profile/user state disagrees; review identity lineage before updating.",
      );
    return row;
  }
  async function previewReassignment(
    actor: AuthenticatedActor,
    input: zInput,
  ): Promise<HandoverPreview> {
    const data = reassignmentPreviewSchema.parse(input);
    await requireCurrentAdmin(sql, actor);
    const row = await target(sql, data.userId);
    if (row.access_revision !== data.expectedVersion) throw new StaffAccessConflictError();
    const cases = await sql<
      { id: string; company_name: string; status: string }[]
    >`select a.id,c.company_name,a.current_status status from annual_return_cases a join companies c on c.id=a.company_id where (a.owner_id=${row.id} or a.reviewer_id=${row.id}) and a.current_status<>'Completed' order by a.id limit 101`;
    const items = await sql<
      { id: string; title: string; version: number }[]
    >`select id,title,version from work_items where (owner_id=${row.id} or reviewer_id=${row.id}) and status not in ('completed','cancelled') order by id limit 101`;
    const [count] = await sql<
      { cases: number; items: number }[]
    >`select (select count(*)::int from annual_return_cases where (owner_id=${row.id} or reviewer_id=${row.id}) and current_status<>'Completed') cases,(select count(*)::int from work_items where (owner_id=${row.id} or reviewer_id=${row.id}) and status not in ('completed','cancelled')) items`;
    return {
      userId: row.id,
      expectedVersion: row.access_revision,
      openCases: count.cases,
      openWorkItems: count.items,
      cases: cases
        .slice(0, 100)
        .map((c) => ({ id: c.id, companyName: c.company_name, status: c.status })),
      workItems: items.slice(0, 100),
      truncated: cases.length > 100 || items.length > 100,
    };
  }
  async function updateStaff(actor: AuthenticatedActor, input: UpdateStaffInput) {
    assertAdminActor(actor);
    const data = updateStaffSchema.parse(input);
    return transact(async (tx) => {
      // Same shared invariant lock used by preserved lifecycle code. Never count separately per target.
      await tx`select pg_advisory_xact_lock(hashtext('kossilon_staff_admin_lifecycle'))`;
      await requireCurrentAdmin(tx, actor);
      const row = await target(tx, data.userId, true);
      if (row.access_revision !== data.expectedVersion) throw new StaffAccessConflictError();
      if (data.active && ["Staff", "Manager"].includes(data.role) && !data.teamId)
        throw new Error("Active Staff/Manager needs a team.");
      if (data.active && data.teamId) {
        const [team] = await tx`select id from teams where id=${data.teamId} and active for share`;
        if (!team) throw new Error("Active target team required.");
      }
      if (row.active && row.role === "Admin" && (!data.active || data.role !== "Admin")) {
        const [remaining] = await tx<
          { n: number }[]
        >`select count(*)::int n from staff_profiles sp join users u on u.id=sp.user_id where sp.role='Admin' and u.role='Admin' and sp.active and u.active and sp.team_id is not distinct from u.team_id`;
        if (remaining.n <= 1) throw new Error("Cannot remove the last active Admin.");
      }
      if (!data.active || data.teamId !== row.team_id || data.role === "Client") {
        const [work] = await tx<
          { n: number }[]
        >`select (select count(*)::int from annual_return_cases where (owner_id=${row.id} or reviewer_id=${row.id}) and current_status<>'Completed')+(select count(*)::int from work_items where (owner_id=${row.id} or reviewer_id=${row.id}) and status not in ('completed','cancelled')) n`;
        if (work.n > 0)
          throw new Error(
            "Outstanding handover: preview and transfer open cases/work items first.",
          );
      }
      if (row.role === data.role && row.team_id === data.teamId && row.active === data.active)
        return { userId: row.id, expectedVersion: row.access_revision };
      await tx`update users set role=${data.role},team_id=${data.teamId},active=${data.active},updated_at=now() where id=${row.id}`;
      await tx`update staff_profiles set role=${data.role},team_id=${data.teamId},active=${data.active},access_revision=access_revision+1,updated_at=now() where user_id=${row.id}`;
      await tx`insert into staff_access_events(target_user_id,actor_user_id,event_type,old_role,new_role,old_team_id,new_team_id,metadata) values(${row.id},${actor.userId!},${data.active ? "access_changed" : "disabled"},${row.role},${data.role},${row.team_id},${data.teamId},${tx.json({ before: { role: row.role, teamId: row.team_id, active: row.active, version: row.access_revision }, after: { role: data.role, teamId: data.teamId, active: data.active, version: row.access_revision + 1 } })})`;
      return { userId: row.id, expectedVersion: row.access_revision + 1 };
    });
  }
  return {
    listStaff,
    updateStaff,
    previewReassignment,
    async listTeams(actor: AuthenticatedActor) {
      await requireCurrentAdmin(sql, actor);
      return sql<
        { id: string; name: string; active: boolean }[]
      >`select id,name,active from teams order by name,id`;
    },
    async listAudit(actor: AuthenticatedActor, userId: string) {
      await requireCurrentAdmin(sql, actor);
      reassignmentPreviewSchema.shape.userId.parse(userId);
      return sql<
        {
          id: string;
          event_type: string;
          created_at: string;
          actor_name: string;
        }[]
      >`select e.id,e.event_type,e.created_at::text,u.name actor_name from staff_access_events e join users u on u.id=e.actor_user_id where e.target_user_id=${userId} order by e.created_at desc,e.id desc limit 50`;
    },
  };
}
type zInput = { userId: string; expectedVersion: number };
export type AdminRepository = ReturnType<typeof createAdminRepository>;
