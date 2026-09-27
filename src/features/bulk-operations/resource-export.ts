import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { SqlClient } from "@/server/db/client";

type QueryClient = SqlClient | postgres.TransactionSql;
type Resource = "clients" | "annual-return-cases" | "work-items";
type ExportRow = {
  resourceId: string;
  companyName: string;
  reference: string;
  status: string;
  ownerId: string | null;
  teamId: string | null;
  tags: string[];
};

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  // Spreadsheet programs can interpret formula prefixes, including after whitespace.
  const safe = /^\s*[=+@-]/u.test(raw) || /^[\t\r\n]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function resourceExportCsv(resource: Resource, rows: ExportRow[]): string {
  const headings = [
    "resource",
    "resourceId",
    "companyName",
    "reference",
    "status",
    "ownerId",
    "teamId",
    "tags",
  ];
  const body = rows.map((row) => [
    resource,
    row.resourceId,
    row.companyName,
    row.reference,
    row.status,
    row.ownerId,
    row.teamId,
    row.tags.join("; "),
  ]);
  return [headings, ...body].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Resolve every row in the database under the actor's current scope. Foreign IDs are omitted. */
export async function exportResourceRowsForActor(
  actor: AuthenticatedActor,
  resource: Resource,
  ids: string[],
  sql: QueryClient,
): Promise<{ csv: string; exportedCount: number; selectedCount: number }> {
  if (!actor.active || !actor.userId || (actor.role !== "Admin" && actor.role !== "Manager"))
    throw new Error("Forbidden: active Admin or Manager required.");
  if (ids.length < 1 || ids.length > 1000 || new Set(ids).size !== ids.length)
    throw new Error("Select 1 to 1000 distinct resources.");
  const [profile] = await sql<{ id: string; role: string; teamId: string | null }[]>`
    select u.id,u.role,u.team_id "teamId" from users u
    join staff_profiles sp on sp.user_id=u.id
    where u.id=${actor.userId} and sp.auth_user_id=${actor.authUserId}
      and u.active and sp.active and u.role=sp.role
      and u.team_id is not distinct from sp.team_id
    for share of u,sp`;
  if (!profile || profile.role !== actor.role || profile.teamId !== actor.teamId)
    throw new Error("Forbidden: actor scope changed; select again.");
  const teamId = actor.role === "Manager" ? actor.teamId : null;
  if (actor.role === "Manager" && !teamId) throw new Error("Forbidden: manager team required.");
  let rows: ExportRow[];
  if (resource === "clients") {
    rows = await sql<ExportRow[]>`
      select c.id "resourceId",c.company_name "companyName",c.cr_number reference,
        c.status,c.assigned_owner_id "ownerId",c.assigned_team_id "teamId",
        coalesce((select array_agg(t.tag order by t.tag) from company_tags t
          where t.company_id=c.id),array[]::text[]) tags
      from companies c where c.id=any(${ids}::uuid[])
        and (${teamId}::uuid is null or c.assigned_team_id=${teamId})
      order by c.id`;
  } else if (resource === "annual-return-cases") {
    rows = await sql<ExportRow[]>`
      select a.id "resourceId",c.company_name "companyName",
        a.return_year::text reference,a.current_status status,
        a.owner_id "ownerId",c.assigned_team_id "teamId",
        coalesce((select array_agg(t.tag order by t.tag) from annual_return_case_tags t
          where t.case_id=a.id),array[]::text[]) tags
      from annual_return_cases a join companies c on c.id=a.company_id
      where a.id=any(${ids}::uuid[])
        and (${teamId}::uuid is null or c.assigned_team_id=${teamId})
      order by a.id`;
  } else {
    rows = await sql<ExportRow[]>`
      select w.id "resourceId",c.company_name "companyName",
        w.title reference,w.status,w.owner_id "ownerId",w.team_id "teamId",
        coalesce((select array_agg(t.tag order by t.tag) from work_item_tags t
          where t.work_item_id=w.id),array[]::text[]) tags
      from work_items w join companies c on c.id=w.company_id
      where w.id=any(${ids}::uuid[])
        and (${teamId}::uuid is null or w.team_id=${teamId})
      order by w.id`;
  }
  return {
    csv: resourceExportCsv(resource, rows),
    exportedCount: rows.length,
    selectedCount: ids.length,
  };
}
