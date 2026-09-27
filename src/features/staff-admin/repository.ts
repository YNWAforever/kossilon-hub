import type postgres from "postgres";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getSqlClient, type SqlClient } from "@/server/db/client";

type QueryClient = SqlClient | postgres.TransactionSql;
function inTransaction<T>(
  client: QueryClient,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in client ? (client.begin(work) as Promise<T>) : work(client);
}
export type StaffInviteProvider = {
  /** Must match a provider user to this exact invitation key, never only to an email. */
  findByInvitationKey(
    key: string,
  ): Promise<{ authUserId: string; email: string; idempotencyKey: string } | null>;
  invite(input: {
    email: string;
    name: string;
    idempotencyKey: string;
  }): Promise<{ authUserId: string; email: string; idempotencyKey: string }>;
};
export type StaffAdminDependencies = {
  sql?: QueryClient;
  provider?: StaffInviteProvider;
  /** Crash-injection seam for the provider/DB boundary; never supplied by production. */
  afterProviderCreated?: () => Promise<void>;
};
export type StaffProfile = {
  staffId: string;
  role: "Admin" | "Manager" | "Staff";
  teamId: string | null;
  revision: number;
  active: boolean;
};
export type StaffInvitationInput = {
  email: string;
  name: string;
  role: StaffProfile["role"];
  teamId: string | null;
  idempotencyKey: string;
};
export type InvitationStatus = {
  id: string;
  status: "pending" | "provider_created" | "linked" | "failed";
  staffId: string | null;
  revision: number;
};
export type DisableResult = {
  staffId: string;
  active: false;
  revision: number;
  outstandingCases: number;
  outstandingWorkItems: number;
};
type StaffRow = {
  id: string;
  user_id: string;
  auth_user_id: string;
  role: StaffProfile["role"];
  user_role: StaffProfile["role"];
  team_id: string | null;
  active: boolean;
  user_active: boolean;
  access_revision: number;
};
type InvitationRow = {
  id: string;
  email: string;
  display_name: string;
  requested_role: StaffProfile["role"];
  requested_team_id: string | null;
  idempotency_key: string;
  status: InvitationStatus["status"];
  provider_auth_user_id: string | null;
  provider_call_started_at: Date | null;
  user_id: string | null;
  revision: number;
};
function profile(row: StaffRow): StaffProfile {
  return {
    staffId: row.id,
    role: row.role,
    teamId: row.team_id,
    revision: row.access_revision,
    active: row.active && row.user_active,
  };
}
function invitation(row: InvitationRow): InvitationStatus {
  return {
    id: row.id,
    status: row.status,
    staffId: row.user_id,
    revision: row.revision,
  };
}
async function lockAdmin(tx: postgres.TransactionSql, actor: AuthenticatedActor) {
  assertStaffAccess(actor);
  if (actor.role !== "Admin" || !actor.userId) throw new Error("Forbidden: Admin access required.");
  // All role, invite and disable changes use the same transaction-scoped lock.
  // It serializes the active Admin count across different staff rows.
  await tx`select pg_advisory_xact_lock(hashtext('kossilon_staff_admin_lifecycle'))`;
  const [current] = await tx<{ id: string }[]>`
    select sp.id from staff_profiles sp join users u on u.id=sp.user_id
    where sp.user_id=${actor.userId} and sp.auth_user_id=${actor.authUserId}
      and sp.active=true and u.active=true and sp.role='Admin' and u.role='Admin'
    for update of sp,u
  `;
  if (!current) throw new Error("Forbidden: active Admin profile required.");
}
async function targetStaff(tx: postgres.TransactionSql, staffId: string): Promise<StaffRow> {
  const [row] = await tx<StaffRow[]>`
    select sp.id,sp.user_id,sp.auth_user_id,sp.role,u.role user_role,
      sp.team_id,sp.active,u.active user_active,sp.access_revision
    from staff_profiles sp join users u on u.id=sp.user_id
    where sp.id=${staffId}
    for update of sp,u
  `;
  if (!row) throw new Error("Staff profile not found.");
  if (row.role !== row.user_role || row.active !== row.user_active)
    throw new Error("Staff profile and user access state disagree.");
  return row;
}
async function assertActiveTeam(tx: postgres.TransactionSql, teamId: string | null) {
  if (teamId === null) return;
  const [team] = await tx<{ id: string }[]>`
    select id from teams where id=${teamId} and active=true for share
  `;
  if (!team) throw new Error("Active target team required.");
}
async function preserveAdmin(tx: postgres.TransactionSql, row: StaffRow) {
  if (!row.active || row.role !== "Admin") return;
  const [count] = await tx<{ n: number }[]>`
    select count(*)::int n from staff_profiles sp
    join users u on u.id=sp.user_id
    where sp.role='Admin' and u.role='Admin' and sp.active=true and u.active=true
  `;
  if (count.n <= 1) throw new Error("Cannot remove the last active Admin.");
}
function validRole(role: string): role is StaffProfile["role"] {
  return role === "Admin" || role === "Manager" || role === "Staff";
}
function validRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("Expected access revision must be a positive integer.");
}

async function outstandingForUser(tx: postgres.TransactionSql, userId: string) {
  const [balance] = await tx<{ cases: number; work_items: number }[]>`
    select
      ((select count(*)::int from annual_return_cases
        where (owner_id=${userId} or reviewer_id=${userId})
          and current_status <> 'Completed')
       + (select count(*)::int from corporate_change_requests
        where owner_id=${userId} and status not in ('Completed','Cancelled'))) cases,
      (select count(*)::int from work_items
        where (owner_id=${userId} or reviewer_id=${userId})
          and status not in ('completed','cancelled')) work_items
  `;
  return balance;
}

export async function changeStaffAccessForActor(
  actor: AuthenticatedActor,
  input: {
    staffId: string;
    role: StaffProfile["role"];
    teamId: string | null;
    expectedRevision: number;
  },
  dependencies: StaffAdminDependencies = {},
): Promise<StaffProfile> {
  validRevision(input.expectedRevision);
  if (!validRole(input.role)) throw new Error("Invalid staff role.");
  const sql = dependencies.sql ?? getSqlClient();
  return inTransaction(sql, async (tx) => {
    await lockAdmin(tx, actor);
    const row = await targetStaff(tx, input.staffId);
    if (!row.active) throw new Error("Disabled staff cannot be changed through role assignment.");
    if (row.access_revision !== input.expectedRevision)
      throw new Error("Staff access revision changed.");
    await assertActiveTeam(tx, input.teamId);
    if (row.role === input.role && row.team_id === input.teamId) return profile(row);
    if (row.team_id !== input.teamId) {
      const balance = await outstandingForUser(tx, row.user_id);
      if (balance.cases || balance.work_items) {
        throw new Error(
          `Outstanding handover: ${balance.cases} cases, ${balance.work_items} work items.`,
        );
      }
    }
    if (row.role === "Admin" && input.role !== "Admin") await preserveAdmin(tx, row);
    await tx`update users set role=${input.role},team_id=${input.teamId},updated_at=now()
      where id=${row.user_id}`;
    const [updated] = await tx<StaffRow[]>`
      update staff_profiles set role=${input.role},team_id=${input.teamId},
        access_revision=access_revision+1,updated_at=now()
      where id=${row.id} and access_revision=${input.expectedRevision}
      returning id,user_id,auth_user_id,role,role user_role,team_id,active,
        active user_active,access_revision
    `;
    if (!updated) throw new Error("Staff access revision changed.");
    await tx`insert into staff_access_events(target_user_id,actor_user_id,
      event_type,old_role,new_role,old_team_id,new_team_id)
      values (${row.user_id},${actor.userId},'access_changed',${row.role},
        ${input.role},${row.team_id},${input.teamId})`;
    return profile(updated);
  });
}

export async function disableStaffForActor(
  actor: AuthenticatedActor,
  input: { staffId: string; expectedRevision: number; handoverOperationId?: string },
  dependencies: StaffAdminDependencies = {},
): Promise<DisableResult> {
  validRevision(input.expectedRevision);
  const sql = dependencies.sql ?? getSqlClient();
  return inTransaction(sql, async (tx) => {
    await lockAdmin(tx, actor);
    const row = await targetStaff(tx, input.staffId);
    if (!row.active) throw new Error("Staff is already disabled.");
    if (row.access_revision !== input.expectedRevision)
      throw new Error("Staff access revision changed.");
    if (row.role === "Admin") await preserveAdmin(tx, row);
    if (input.handoverOperationId) {
      const [op] = await tx<{ id: string }[]>`
        select id from bulk_operations where id=${input.handoverOperationId}
          and action='assign' and state='completed'
          and created_by_id=${actor.userId} for share
      `;
      if (!op) throw new Error("Authorized T09 handover operation is not completed.");
    }
    const balance = await outstandingForUser(tx, row.user_id);
    if (balance.cases || balance.work_items)
      throw new Error(
        `Outstanding handover: ${balance.cases} cases, ${balance.work_items} work items.`,
      );
    await tx`update users set active=false,updated_at=now() where id=${row.user_id}`;
    const [updated] = await tx<{ access_revision: number }[]>`
      update staff_profiles set active=false,access_revision=access_revision+1,
        updated_at=now()
      where id=${row.id} and access_revision=${input.expectedRevision}
      returning access_revision
    `;
    if (!updated) throw new Error("Staff access revision changed.");
    await tx`insert into staff_access_events(target_user_id,actor_user_id,event_type,
      old_role,new_role,old_team_id,new_team_id,handover_operation_id,metadata)
      values (${row.user_id},${actor.userId},'disabled',${row.role},${row.role},
        ${row.team_id},${row.team_id},${input.handoverOperationId ?? null},
        ${tx.json({ outstandingCases: 0, outstandingWorkItems: 0 })})`;
    return {
      staffId: row.id,
      active: false,
      revision: updated.access_revision,
      outstandingCases: 0,
      outstandingWorkItems: 0,
    };
  });
}

function normalizeInvitation(input: StaffInvitationInput): StaffInvitationInput {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320)
    throw new Error("Valid staff email required.");
  if (name.length < 1 || name.length > 200)
    throw new Error("Staff display name must be 1 to 200 characters.");
  if (!validRole(input.role)) throw new Error("Invalid staff role.");
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128)
    throw new Error("Invitation idempotency key must be 8 to 128 characters.");
  return { ...input, email, name, idempotencyKey };
}
function sameInvitation(row: InvitationRow, input: StaffInvitationInput) {
  return (
    row.email === input.email &&
    row.display_name === input.name &&
    row.requested_role === input.role &&
    row.requested_team_id === input.teamId &&
    row.idempotency_key === input.idempotencyKey
  );
}
export async function inviteStaffForActor(
  actor: AuthenticatedActor,
  rawInput: StaffInvitationInput,
  dependencies: StaffAdminDependencies = {},
): Promise<InvitationStatus> {
  // There is no verified live Neon staff-invite adapter for this tenant.
  // Reserving no DB row before this guard keeps production fail-closed.
  const provider = dependencies.provider;
  if (!provider) throw new Error("Neon staff invitation provider capability is unverified.");
  const input = normalizeInvitation(rawInput);
  const sql = dependencies.sql ?? getSqlClient();
  const reserved = await inTransaction(sql, async (tx) => {
    await lockAdmin(tx, actor);
    await assertActiveTeam(tx, input.teamId);
    const [existing] = await tx<InvitationRow[]>`
      select * from staff_provisioning_requests where idempotency_key=${input.idempotencyKey}
      for update
    `;
    if (existing) {
      if (!sameInvitation(existing, input))
        throw new Error("Invitation idempotency key has different parameters.");
      if (existing.status === "linked") return { row: existing, shouldInvite: false };
      if (existing.status === "failed")
        throw new Error("Invitation requires manual reconciliation.");
      return { row: existing, shouldInvite: false };
    }
    const [person] = await tx<{ id: string }[]>`
      select id from users where lower(email)=${input.email} limit 1
    `;
    if (person) throw new Error("Staff email is already provisioned.");
    const [created] = await tx<InvitationRow[]>`
      insert into staff_provisioning_requests(email,display_name,requested_role,
        requested_team_id,requested_by_id,idempotency_key,provider_call_started_at)
      values (${input.email},${input.name},${input.role},${input.teamId},
        ${actor.userId},${input.idempotencyKey},now())
      returning *
    `;
    return { row: created, shouldInvite: true };
  });
  if (reserved.row.status === "linked") return invitation(reserved.row);
  const found = await provider.findByInvitationKey(input.idempotencyKey);
  if (
    found &&
    (found.email.toLowerCase() !== input.email || found.idempotencyKey !== input.idempotencyKey)
  )
    throw new Error("Provider invitation correlation does not match.");
  if (!found && !reserved.shouldInvite)
    throw new Error("Provider result unknown; manual reconciliation required before retry.");
  const created =
    found ??
    (await provider.invite({
      email: input.email,
      name: input.name,
      idempotencyKey: input.idempotencyKey,
    }));
  if (
    !created.authUserId.trim() ||
    created.email.toLowerCase() !== input.email ||
    created.idempotencyKey !== input.idempotencyKey
  )
    throw new Error("Provider invitation response does not match reserved request.");
  await inTransaction(sql, async (tx) => {
    await lockAdmin(tx, actor);
    const [row] = await tx<InvitationRow[]>`
      select * from staff_provisioning_requests where id=${reserved.row.id} for update
    `;
    if (!row || !sameInvitation(row, input)) throw new Error("Invitation reservation changed.");
    if (row.status === "linked") return;
    if (row.provider_auth_user_id && row.provider_auth_user_id !== created.authUserId)
      throw new Error("Provider identity changed; manual reconciliation required.");
    await tx`update staff_provisioning_requests set status='provider_created',
      provider_auth_user_id=${created.authUserId},revision=revision+1,updated_at=now()
      where id=${row.id}`;
  });
  await dependencies.afterProviderCreated?.();
  return inTransaction(sql, async (tx) => {
    await lockAdmin(tx, actor);
    const [row] = await tx<InvitationRow[]>`
      select * from staff_provisioning_requests where id=${reserved.row.id} for update
    `;
    if (!row || !sameInvitation(row, input)) throw new Error("Invitation reservation changed.");
    if (row.status === "linked") return invitation(row);
    if (row.status !== "provider_created" || row.provider_auth_user_id !== created.authUserId)
      throw new Error("Provider-created identity is not linked to this invitation.");
    const [clientMembership] = await tx<{ id: string }[]>`
      select id from client_company_memberships
      where auth_user_id=${created.authUserId} limit 1 for share
    `;
    if (clientMembership) {
      throw new Error(
        "Provider identity already has a client membership; manual reconciliation required.",
      );
    }
    const [user] = await tx<{ id: string }[]>`
      insert into users(name,email,role,team_id) values (
        ${input.name},${input.email},${input.role},${input.teamId})
      returning id
    `;
    await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id)
      values (${user.id},${created.authUserId},${input.role},${input.teamId})`;
    const [linked] = await tx<InvitationRow[]>`
      update staff_provisioning_requests set status='linked',user_id=${user.id},
        revision=revision+1,updated_at=now() where id=${row.id}
      returning *
    `;
    await tx`insert into staff_access_events(target_user_id,actor_user_id,event_type,
      new_role,new_team_id,metadata) values (${user.id},${actor.userId},'linked',
        ${input.role},${input.teamId},${tx.json({ invitationId: row.id })})`;
    return invitation(linked);
  });
}

export type StaffAdminRow = StaffProfile & {
  userId: string;
  name: string;
  email: string;
  teamName: string | null;
  outstandingCases: number;
  outstandingWorkItems: number;
};
export type StaffAdminList = {
  staff: StaffAdminRow[];
  teams: { id: string; name: string }[];
  invitations: {
    id: string;
    email: string;
    name: string;
    status: InvitationStatus["status"];
    revision: number;
  }[];
};

export async function listStaffAdministrationForActor(
  actor: AuthenticatedActor,
  dependencies: StaffAdminDependencies = {},
): Promise<StaffAdminList> {
  const sql = dependencies.sql ?? getSqlClient();
  return inTransaction(sql, async (tx) => {
    await lockAdmin(tx, actor);
    const rows = await tx<
      {
        id: string;
        user_id: string;
        name: string;
        email: string;
        role: string;
        user_role: string;
        team_id: string | null;
        user_team_id: string | null;
        team_name: string | null;
        profile_active: boolean;
        user_active: boolean;
        access_revision: number;
        cases: number;
        work_items: number;
      }[]
    >`
      select sp.id,sp.user_id,u.name,u.email,sp.role,u.role user_role,
        sp.team_id,u.team_id user_team_id,t.name team_name,
        sp.active profile_active,u.active user_active,sp.access_revision,
        ((select count(*)::int from annual_return_cases arc
          where (arc.owner_id=u.id or arc.reviewer_id=u.id)
            and arc.current_status <> 'Completed')
         + (select count(*)::int from corporate_change_requests ccr
          where ccr.owner_id=u.id and ccr.status not in ('Completed','Cancelled'))) cases,
        (select count(*)::int from work_items wi
          where (wi.owner_id=u.id or wi.reviewer_id=u.id)
            and wi.status not in ('completed','cancelled')) work_items
      from staff_profiles sp join users u on u.id=sp.user_id
      left join teams t on t.id=sp.team_id
      order by u.name,u.id
    `;
    const teams = await tx<{ id: string; name: string }[]>`
      select id,name from teams where active=true order by name,id
    `;
    const invitations = await tx<
      {
        id: string;
        email: string;
        display_name: string;
        status: InvitationStatus["status"];
        revision: number;
      }[]
    >`
      select id,email,display_name,status,revision
      from staff_provisioning_requests
      where status <> 'linked' order by created_at desc limit 100
    `;
    return {
      staff: rows.map((row) => {
        if (
          !validRole(row.role) ||
          row.role !== row.user_role ||
          row.team_id !== row.user_team_id ||
          row.profile_active !== row.user_active
        ) {
          throw new Error(
            "Staff roster role, team or active state disagree; reconcile before changes.",
          );
        }
        return {
          staffId: row.id,
          userId: row.user_id,
          name: row.name,
          email: row.email,
          role: row.role,
          teamId: row.team_id,
          teamName: row.team_name,
          active: row.profile_active,
          revision: row.access_revision,
          outstandingCases: row.cases,
          outstandingWorkItems: row.work_items,
        };
      }),
      teams,
      invitations: invitations.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.display_name,
        status: row.status,
        revision: row.revision,
      })),
    };
  });
}
