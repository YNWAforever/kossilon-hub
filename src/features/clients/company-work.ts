import type { AuthenticatedActor } from "@/features/auth/types";
import type { SqlClient } from "@/server/db/client";
import { boundedPageSize, readTupleCursor, tupleCursor } from "@/server/db/pagination";
import { caseFiltersForActor } from "@/features/annual-return/permissions";
import { caseScopeSql } from "@/features/annual-return/case-scope";
import { incorporationReadScope } from "@/features/incorporation/authorization";
import { hongKongBusinessDate } from "@/lib/hong-kong-time";

export type CompanyWorkItem = {
  id: string;
  kind: "annual_return" | "incorporation" | "corporate_change";
  title: string;
  status: string;
  active: boolean;
  dueDate: string | null;
  paymentStatus: string | null;
  amount: number | null;
};
export type CompanyWorkPage = {
  items: CompanyWorkItem[];
  total: number;
  unfinished: number;
  nextCursor: string | null;
};
type WorkRow = Omit<CompanyWorkItem, "dueDate" | "paymentStatus"> & {
  due_date: string | null;
  payment_status: string | null;
  cursor_created_at: string;
};

/** One statement binds metrics and the bounded page to the same database snapshot.
 * Company links are exact ids; an unlinked intake is never guessed by its name.
 * These are workflow statuses, not a new filing-readiness or safety verdict.
 */
export async function readCompanyWorkPage(
  sql: SqlClient,
  actor: AuthenticatedActor,
  input: { companyId: string; cursor?: string; limit?: number },
): Promise<CompanyWorkPage> {
  if (!actor.active || !actor.userId || actor.role === "Client")
    throw new Error("Forbidden: active staff identity required.");
  const caseScope = caseFiltersForActor({ ...actor, id: actor.userId });
  const teamScope = incorporationReadScope(actor);
  const limit = boundedPageSize(input.limit);
  const cursor = readTupleCursor(input.cursor, 4);
  if (cursor && !["0", "1"].includes(cursor[0])) throw new Error("Invalid company work cursor.");
  const [result] = await sql<
    { total: string | number; unfinished: string | number; items: WorkRow[] }[]
  >`
    with eligible as materialized (
      select arc.id,'annual_return'::text kind,arc.return_year::text title,arc.current_status status,
        arc.current_status not in ('Filed','Completed') active,arc.filing_due_date::text due_date,
        arc.created_at,p.status payment_status,p.amount
      from annual_return_cases arc join companies c on c.id=arc.company_id
      left join payments p on p.case_id=arc.id and p.company_id=c.id
      where arc.company_id=${input.companyId}::uuid and ${caseScopeSql(sql, caseScope, hongKongBusinessDate())}
      union all
      select i.id,'incorporation',i.proposed_company_name_en,i.status,i.status<>'Completed',
        i.target_completion_date::text,i.created_at,null::text,null::integer
      from incorporation_cases i join companies co on co.id=i.company_id
      where i.company_id=${input.companyId}::uuid and co.data_origin<>'fixture'
        and (${teamScope.kind === "all"} or i.team_id=${teamScope.teamId ?? null}::uuid)
      union all
      select r.id,'corporate_change',r.change_type,r.status,r.status not in ('Completed','Cancelled'),
        null::text,r.created_at,null::text,null::integer
      from corporate_change_requests r join companies co on co.id=r.company_id
      where r.company_id=${input.companyId}::uuid and co.data_origin<>'fixture'
        and (${teamScope.kind === "all"} or co.assigned_team_id=${teamScope.teamId ?? null}::uuid)
    ), metrics as (select count(*) total,count(*) filter(where active) unfinished from eligible),
    page as (
      select *,created_at::text cursor_created_at from eligible
      where (${cursor === null} or active<${cursor?.[0] === "1"}::boolean or
        (active=${cursor?.[0] === "1"}::boolean and (created_at<${cursor?.[1] ?? null}::text::timestamptz or
          (created_at=${cursor?.[1] ?? null}::text::timestamptz and (kind,id)>(${cursor?.[2] ?? null}::text,${cursor?.[3] ?? null}::uuid)))))
      order by active desc,created_at desc,kind,id limit ${limit + 1}
    )
    select metrics.total,metrics.unfinished,coalesce(jsonb_agg(to_jsonb(page) order by page.active desc,page.created_at desc,page.kind,page.id)
      filter(where page.id is not null),'[]'::jsonb) items from metrics left join page on true group by metrics.total,metrics.unfinished`;
  const rows = result?.items ?? [];
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    total: Number(result?.total ?? 0),
    unfinished: Number(result?.unfinished ?? 0),
    items: visible.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      active: row.active,
      dueDate: row.due_date,
      paymentStatus: row.payment_status,
      amount: row.amount === null ? null : Number(row.amount),
    })),
    nextCursor:
      rows.length > limit && last
        ? tupleCursor([last.active ? "1" : "0", last.cursor_created_at, last.kind, last.id])
        : null,
  };
}
