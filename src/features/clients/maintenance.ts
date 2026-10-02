import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertClientCompanyWritable } from "./authorization";
import { createClientRepository } from "./repository";
import { readActiveStaffUser } from "@/features/auth/staff-state";
type Query = SqlClient | postgres.TransactionSql;
export async function previewClientMaintenance(
  db: Query,
  actor: AuthenticatedActor,
  id: string,
  change: { ownerId: string; teamId: string },
) {
  const [row] = await db<
    { team: string; origin: string; version: string }[]
  >`select assigned_team_id team,data_origin origin,md5(to_jsonb(c)::text) version from companies c where id=${id}`;
  if (!row) throw new Error("Forbidden: company unavailable.");
  assertClientCompanyWritable(actor, { assignedTeamId: row.team });
  assertClientCompanyWritable(actor, { assignedTeamId: change.teamId });
  if (row.origin !== "client")
    throw new Error("Locked: historical/fixture company is read-only for bulk maintenance.");
  const owner = await readActiveStaffUser(db, change.ownerId);
  if (owner.team_id !== change.teamId)
    throw new Error("Forbidden: owner must belong to the selected team.");
  const [inconsistent] = await db<
    { n: number }[]
  >`select count(*)::int n from work_items where company_id=${id} and status in ('open','in_progress','blocked') and team_id is distinct from ${change.teamId}::uuid`;
  if (inconsistent.n)
    throw new Error(
      "Locked: active work must be moved through its assignment workflow before changing the company team.",
    );
  const [cases] = await db<
    { n: number }[]
  >`select count(*)::int n from annual_return_cases a left join users owner on owner.id=a.owner_id left join users reviewer on reviewer.id=a.reviewer_id where a.company_id=${id} and a.current_status not in ('Filed','Completed') and a.locked_at is null and (owner.team_id is distinct from ${change.teamId}::uuid or (a.reviewer_id is not null and reviewer.team_id is distinct from ${change.teamId}::uuid))`;
  if (cases.n)
    throw new Error(
      "Locked: active case ownership must be reconciled with the target team before company maintenance.",
    );
  return { version: row.version, output: { kind: "client_maintenance", companyId: id, ...change } };
}
/** Shared single-company command; only owner/team change, other current fields are preserved. */
export async function applyClientMaintenance(
  tx: postgres.TransactionSql,
  actor: AuthenticatedActor,
  id: string,
  change: { ownerId: string; teamId: string },
  expectedVersion: string,
) {
  await tx`select id from companies where id=${id} for update`;
  await tx`select id from annual_return_cases where company_id=${id} order by id for update`;
  await tx`select u.id from users u join staff_profiles sp on sp.user_id=u.id where u.id in(select owner_id from annual_return_cases where company_id=${id} union select reviewer_id from annual_return_cases where company_id=${id}) order by u.id for share of u,sp`;
  const current = await previewClientMaintenance(tx, actor, id, change);
  if (current.version !== expectedVersion)
    throw Object.assign(new Error("Company version changed."), { statusCode: 409 });
  const owner = await readActiveStaffUser(tx, change.ownerId, true);
  if (owner.team_id !== change.teamId)
    throw new Error("Forbidden: owner changed team during maintenance.");
  const repo = createClientRepository({ sql: tx });
  const company = await repo.getClient(id);
  if (!company) throw new Error("Forbidden: company unavailable.");
  await repo.updateClient({
    id,
    companyName: company.companyName,
    registeredOffice: company.registeredOffice,
    status: company.status,
    ...change,
    actorId: actor.userId!,
  });
  return current.output;
}
