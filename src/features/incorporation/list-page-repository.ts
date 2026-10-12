import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { TeamReadScope } from "@/features/auth/team-read-scope";
import { businessListContext } from "@/lib/business-list";
import { encodeListCursor, type ListPage } from "@/lib/list-page";
import {
  incorporationListPageSchema,
  type IncorporationListInput,
  type IncorporationListRow,
} from "./list-page";
export async function readIncorporationPage(
  sql: SqlClient | postgres.TransactionSql,
  scope: TeamReadScope,
  raw: IncorporationListInput = {},
  viewerUserId?: string,
): Promise<ListPage<IncorporationListRow>> {
  const input = incorporationListPageSchema.parse(raw),
    ctx = businessListContext("incorporation", scope, input, viewerUserId);
  const key =
    input.sort === "company"
      ? sql`ic.proposed_company_name_en`
      : input.sort === "recent"
        ? sql`-extract(epoch from ic.created_at)`
        : sql`ic.target_completion_date`;
  const predicate = sql`(${ctx.scope.kind === "all"} or ic.team_id=${ctx.scope.kind === "team" ? ctx.scope.teamId : null}::uuid)
 and (${input.companyId ?? null}::uuid is null or ic.company_id=${input.companyId ?? null}::uuid)
 and (${ctx.owner === "all"} or (${ctx.owner === "unassigned"} and ic.owner_id is null) or ic.owner_id=${["all", "unassigned"].includes(ctx.owner) ? null : ctx.owner}::uuid)
 and (${input.status === "all" || (input.history && input.status === "open")} or
 (${input.status === "open"} and ic.status<>'Completed') or ic.status=${input.status})
 and (${input.q === ""} or ic.proposed_company_name_en ilike ${ctx.q} escape '\\' or coalesce(ic.proposed_company_name_zh,'') ilike ${ctx.q} escape '\\')
 and (${ctx.due === "all"} or (${ctx.due === "overdue"} and ic.target_completion_date<(current_timestamp at time zone 'Asia/Hong_Kong')::date)
 or (${ctx.due === "next30"} and ic.target_completion_date between (current_timestamp at time zone 'Asia/Hong_Kong')::date and (current_timestamp at time zone 'Asia/Hong_Kong')::date+30)
 or (${ctx.due === "none"} and ic.target_completion_date is null))`;
  const [count] =
    await sql`select count(*)::int total from incorporation_cases ic where ${predicate}`;
  const boundary = ctx.values
    ? input.sort === "recent"
      ? sql`(${key},ic.id)>(${ctx.values[0]}::numeric,${ctx.values[1]}::uuid)`
      : input.sort === "deadline"
        ? sql`(${key},ic.id)>(${ctx.values[0]}::date,${ctx.values[1]}::uuid)`
        : sql`(${key},ic.id)>(${ctx.values[0]},${ctx.values[1]}::uuid)`
    : sql`true`;
  const rows =
    await sql`with bounded as materialized(select ic.id,${key}::text sort_key from incorporation_cases ic where ${predicate} and ${boundary} order by ${key},ic.id limit ${input.limit + 1})
 select ic.*,u.name owner_name,t.name team_name,b.sort_key,ic.target_completion_date::text due_date,ic.created_at::text created_raw,ic.updated_at::text updated_raw
 from bounded b join incorporation_cases ic on ic.id=b.id join users u on u.id=ic.owner_id join teams t on t.id=ic.team_id
 order by ${key},ic.id`;
  const page = rows.slice(0, input.limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      proposedCompanyNameEn: r.proposed_company_name_en,
      proposedCompanyNameZh: r.proposed_company_name_zh,
      proposedRegisteredOffice: r.proposed_registered_office,
      proposedCompanySecretary: r.proposed_company_secretary,
      registeredCapital: r.registered_capital,
      businessNature: r.business_nature,
      status: r.status,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      teamId: r.team_id,
      teamName: r.team_name,
      targetCompletionDate: r.due_date,
      dueDate: r.due_date,
      companyId: r.company_id,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
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
