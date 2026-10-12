import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { TeamReadScope } from "@/features/auth/team-read-scope";
import { businessListContext } from "@/lib/business-list";
import { encodeListCursor, type ListPage } from "@/lib/list-page";
import {
  corporateChangeListPageSchema,
  type CorporateChangeListInput,
  type CorporateChangeListRow,
} from "./list-page";
export async function readCorporateChangePage(
  sql: SqlClient | postgres.TransactionSql,
  scope: TeamReadScope,
  raw: CorporateChangeListInput = {},
  viewerUserId?: string,
): Promise<ListPage<CorporateChangeListRow>> {
  const input = corporateChangeListPageSchema.parse(raw),
    ctx = businessListContext("corporate_change_request", scope, input, viewerUserId);
  const due = sql`(select min((w.sla_due_at at time zone 'Asia/Hong_Kong')::date) from work_items w where w.corporate_change_request_id=r.id and w.company_id=r.company_id and w.status not in ('completed','cancelled'))`;
  const key =
    input.sort === "company"
      ? sql`c.company_name`
      : input.sort === "recent"
        ? sql`-extract(epoch from r.created_at)`
        : sql`coalesce(${due},'9999-12-31'::date)`;
  const predicate = sql`(${ctx.scope.kind === "all"} or c.assigned_team_id=${ctx.scope.kind === "team" ? ctx.scope.teamId : null}::uuid)
 and (${input.companyId ?? null}::uuid is null or r.company_id=${input.companyId ?? null}::uuid)
 and (${ctx.owner === "all"} or (${ctx.owner === "unassigned"} and r.owner_id is null) or r.owner_id=${["all", "unassigned"].includes(ctx.owner) ? null : ctx.owner}::uuid)
 and (${input.status === "all" || (input.history && input.status === "open")} or
 (${input.status === "open"} and r.status not in ('Completed','Cancelled')) or r.status=${input.status})
 and (${input.q === ""} or c.company_name ilike ${ctx.q} escape '\\' or coalesce(r.new_name_en,'') ilike ${ctx.q} escape '\\' or coalesce(r.new_name_zh,'') ilike ${ctx.q} escape '\\')
 and (${ctx.due === "all"} or (${ctx.due === "overdue"} and ${due}<(current_timestamp at time zone 'Asia/Hong_Kong')::date)
 or (${ctx.due === "next30"} and ${due} between (current_timestamp at time zone 'Asia/Hong_Kong')::date and (current_timestamp at time zone 'Asia/Hong_Kong')::date+30)
 or (${ctx.due === "none"} and ${due} is null))`;
  const [count] =
    await sql`select count(*)::int total from corporate_change_requests r join companies c on c.id=r.company_id where ${predicate}`;
  const boundary = ctx.values
    ? input.sort === "recent"
      ? sql`(${key},r.id)>(${ctx.values[0]}::numeric,${ctx.values[1]}::uuid)`
      : input.sort === "deadline"
        ? sql`(${key},r.id)>(${ctx.values[0]}::date,${ctx.values[1]}::uuid)`
        : sql`(${key},r.id)>(${ctx.values[0]},${ctx.values[1]}::uuid)`
    : sql`true`;
  const rows =
    await sql`with bounded as materialized(select r.id,${key}::text sort_key,${due}::text due_date from corporate_change_requests r join companies c on c.id=r.company_id where ${predicate} and ${boundary} order by ${key},r.id limit ${input.limit + 1})
 select r.id,r.company_id,r.change_type,r.status,r.owner_id,r.quoted_fee,r.created_at::text created_raw,r.updated_at::text updated_raw,c.company_name,u.name owner_name,b.sort_key,b.due_date
 from bounded b join corporate_change_requests r on r.id=b.id join companies c on c.id=r.company_id join users u on u.id=r.owner_id order by ${key},r.id`;
  const page = rows.slice(0, input.limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      changeType: r.change_type,
      status: r.status,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      quotedFee: Number(r.quoted_fee),
      companyName: r.company_name,
      dueDate: r.due_date,
      createdAt: new Date(r.created_raw).toISOString(),
      updatedAt: new Date(r.updated_raw).toISOString(),
    })),
    total: count.total,
    nextCursor:
      rows.length > input.limit
        ? encodeListCursor(ctx.key, [page.at(-1)!.sort_key, page.at(-1)!.id])
        : null,
    observedAt: new Date().toISOString(),
  };
}
