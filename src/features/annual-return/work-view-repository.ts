import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { CaseFilters } from "./repository";
import type { WorkViewKey, WorkViewRow } from "./work-views";
import { caseScopeSql } from "./case-scope";
import { readyForApprovalSql } from "./readiness-sql";
import { daysBetween } from "@/lib/date-math";
import { boundedPageSize } from "@/server/db/pagination";
import { operationalRead } from "@/server/db/operational-read";
type Query = SqlClient | postgres.TransactionSql;
export type WorkViewQuery = {
  view: WorkViewKey;
  scope: CaseFilters;
  viewerUserId: string | null;
  cursor?: string;
  limit?: number;
  sort?: "deadline" | "company";
};
export type WorkViewPage = { rows: WorkViewRow[]; nextCursor: string | null };
export type WorkViewCounts = Record<WorkViewKey, number>;
type Row = {
  id: string;
  company_name: string;
  return_year: number;
  filing_due_date: string;
  owner_name: string;
  blocker: string;
};
function mutable(sql: Query) {
  return sql`arc.current_status not in ('Filed','Completed') and arc.locked_at is null and arc.completed_at is null`;
}
function predicate(sql: Query, view: WorkViewKey, today: string, userId: string | null) {
  if (view === "chaseToday")
    return sql`${mutable(sql)} and arc.filing_due_date<=${today}::date+30 and exists(select 1 from annual_return_checklist_items ci where ci.case_id=arc.id and ci.required and ci.status in ('Missing','Rejected'))`;
  if (view === "newlyReceived" || view === "awaitingMyReview")
    return sql`${mutable(sql)} and exists(select 1 from annual_return_checklist_items ci where ci.case_id=arc.id and ci.status='Received') and (${view === "newlyReceived"} or arc.owner_id=${userId}::uuid or arc.reviewer_id=${userId}::uuid)`;
  if (view === "readyToFile") return readyForApprovalSql(sql);
  return sql`exists(select 1 from package_handoffs h where h.case_id=arc.id and (h.delivery_fact is null or h.delivery_fact='unknown' or (h.status='prepared' and h.delivery_fact in ('prepared','exported'))
    or exists(select 1 from handoff_returns r where r.handoff_id=h.id and (r.reconciled_at is null or r.outcome<>'accepted'))))`;
}
function cursorOf(row: Row, sort: string) {
  return Buffer.from(
    JSON.stringify([sort, row.filing_due_date, row.company_name, row.id]),
  ).toString("base64url");
}
function decodeCursor(cursor: string | undefined, sort: string) {
  if (!cursor) return null;
  try {
    const tuple: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 4 ||
      tuple[0] !== sort ||
      !tuple.every((v) => typeof v === "string") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(tuple[1]) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tuple[3])
    )
      throw new Error();
    return tuple as string[];
  } catch {
    throw new Error("Invalid work-view cursor; reset pagination explicitly.");
  }
}
async function workPageQuery(
  sql: Query,
  input: WorkViewQuery,
  today: string,
): Promise<WorkViewPage> {
  const limit = boundedPageSize(input.limit, 50),
    sort = input.sort ?? "deadline",
    cursor = decodeCursor(input.cursor, sort);
  const blocker =
    input.view === "chaseToday"
      ? sql`(select string_agg(ci.item_label,'、' order by ci.id) from annual_return_checklist_items ci where ci.case_id=arc.id and ci.required and ci.status in ('Missing','Rejected'))`
      : input.view === "newlyReceived" || input.view === "awaitingMyReview"
        ? sql`(select count(*)::text||' 份文件待覆核' from annual_return_checklist_items where case_id=arc.id and status='Received')`
        : input.view === "readyToFile"
          ? sql`'文件及付款已核對；待套件批准及外部提交'::text`
          : sql`(select count(*) filter(where r.reconciled_at is null)::text||' 筆待核對回件 · '||count(*) filter(where r.outcome<>'accepted')::text||' 筆拒收／部分／未匹配' from handoff_returns r join package_handoffs h on h.id=r.handoff_id where h.case_id=arc.id)
      ||' · '||(select count(*) from package_handoffs where case_id=arc.id and (delivery_fact is null or delivery_fact='unknown'))::text||' 筆未知 · '||(select count(*) from package_handoffs where case_id=arc.id and status='prepared' and delivery_fact in ('prepared','exported'))::text||' 筆待人工提交'`;
  const rows = await sql<
    Row[]
  >`select arc.id,c.company_name,arc.return_year,arc.filing_due_date::text,owner.name owner_name,${blocker} blocker
    from annual_return_cases arc join companies c on c.id=arc.company_id join users owner on owner.id=arc.owner_id
    where ${caseScopeSql(sql, input.scope, today)} and ${predicate(sql, input.view, today, input.viewerUserId)}
      and (${cursor === null} or ${sort === "company" ? sql`(c.company_name,arc.id)>(${cursor?.[2] ?? ""},${cursor?.[3] ?? null}::uuid)` : sql`(arc.filing_due_date,arc.id)>(${cursor?.[1] ?? null}::date,${cursor?.[3] ?? null}::uuid)`})
    order by ${sort === "company" ? sql`c.company_name,arc.id` : sql`arc.filing_due_date,arc.id`} limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  return {
    rows: page.map((r) => ({
      caseId: r.id,
      companyName: r.company_name,
      returnYear: r.return_year,
      filingDueDate: r.filing_due_date,
      daysRemaining: daysBetween(today, r.filing_due_date),
      ownerName: r.owner_name,
      blocker: r.blocker,
    })),
    nextCursor: rows.length > limit ? cursorOf(page.at(-1)!, sort) : null,
  };
}
async function workMetricsQuery(
  sql: Query,
  input: { scope: CaseFilters; viewerUserId: string | null },
  today: string,
): Promise<WorkViewCounts> {
  const [row] = await sql<
    WorkViewCounts[]
  >`select count(*) filter(where ${predicate(sql, "chaseToday", today, input.viewerUserId)})::int "chaseToday",
    count(*) filter(where ${predicate(sql, "newlyReceived", today, input.viewerUserId)})::int "newlyReceived",
    count(*) filter(where ${predicate(sql, "awaitingMyReview", today, input.viewerUserId)})::int "awaitingMyReview",
    count(*) filter(where ${predicate(sql, "readyToFile", today, input.viewerUserId)})::int "readyToFile",
    count(*) filter(where ${predicate(sql, "returnsAndExceptions", today, input.viewerUserId)})::int "returnsAndExceptions"
    from annual_return_cases arc join companies c on c.id=arc.company_id where ${caseScopeSql(sql, input.scope, today)}`;
  if (!row) throw new Error("Work-view metrics unavailable");
  return row;
}
export function listWorkView(sql: Query, input: WorkViewQuery, today: string) {
  return operationalRead(sql, (tx) => workPageQuery(tx, input, today));
}
export function workViewMetrics(
  sql: Query,
  input: { scope: CaseFilters; viewerUserId: string | null },
  today: string,
) {
  return operationalRead(sql, (tx) => workMetricsQuery(tx, input, today));
}
