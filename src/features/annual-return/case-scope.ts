import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { CaseFilters } from "./repository";

type Query = SqlClient | postgres.TransactionSql;

/** Business checklist evidence awaiting verification; distinct from client chase. */
export function outstandingChecklistSql(sql: Query) {
  return sql`i.required and (i.status<>'Verified' or i.received_at is null or i.verified_at is null or i.document_id is null)`;
}
export function activeCaseSql(sql: Query) {
  return sql`arc.current_status not in ('Filed','Completed')`;
}

/** Same inputs and threshold order as workflow.riskForCase; observed, never stored risk. */
export function caseRiskSql(sql: Query, today: string) {
  const missing = sql`exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id and ${outstandingChecklistSql(sql)})`;
  const paymentIncomplete = sql`not exists(select 1 from payments p where p.case_id=arc.id and p.status='Payment received')`;
  const filingIncomplete = sql`(nullif(btrim(arc.filing_reference),'') is null or arc.confirmation_document_id is null)`;
  const paymentProofIncomplete = sql`not exists(select 1 from payments p where p.case_id=arc.id and p.status='Payment received' and p.payment_proof_document_id is not null)`;
  return sql`case
    when arc.current_status in ('Filed','Completed') and not ${missing} and not ${paymentProofIncomplete} and not ${filingIncomplete} then 'green'
    when arc.filing_due_date<${today}::date then 'red'
    when arc.filing_due_date<=${today}::date+7 and (${missing} or ${paymentIncomplete} or ${filingIncomplete}) then 'red'
    when arc.filing_due_date<=${today}::date+14 and ${missing} then 'orange'
    when arc.filing_due_date<=${today}::date+30 and (${missing} or ${paymentIncomplete}) then 'yellow'
    else 'green' end`;
}

/** List and aggregate use exactly this actor/origin/filter scope, independent of page cursor. */
export function caseScopeSql(sql: Query, filters: CaseFilters, today: string) {
  const query = filters.q?.trim()
    ? `%${filters.q.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    : null;
  const companyIds = filters.companyIds ? [...filters.companyIds] : null;
  return sql`
    (${filters.ownerId ?? null}::uuid is null or arc.owner_id=${filters.ownerId ?? null}::uuid)
    and (${filters.caseIds ? [...filters.caseIds] : null}::uuid[] is null or arc.id=any(${filters.caseIds ? [...filters.caseIds] : null}::uuid[]))
    and (${filters.includeFixtures === true} or c.data_origin<>'fixture')
    and (${filters.activeOnly !== true} or ${activeCaseSql(sql)})
    and (${filters.teamId ?? null}::uuid is null or c.assigned_team_id=${filters.teamId ?? null}::uuid)
    and (${filters.reviewerId ?? null}::uuid is null or arc.reviewer_id=${filters.reviewerId ?? null}::uuid)
    and (${filters.status ?? null}::text is null or arc.current_status=${filters.status ?? null})
    and (${filters.visibleToUserId ?? null}::uuid is null or arc.owner_id=${filters.visibleToUserId ?? null}::uuid or arc.reviewer_id=${filters.visibleToUserId ?? null}::uuid)
    and (${companyIds}::uuid[] is null or arc.company_id=any(${companyIds}::uuid[]))
    and (${filters.paymentStatus ?? null}::text is null or exists(select 1 from payments p where p.case_id=arc.id and p.status=${filters.paymentStatus ?? null}))
    and (${filters.overdueOnly !== true} or (${activeCaseSql(sql)} and arc.filing_due_date<${today}::date))
    and (${typeof filters.missingDocuments !== "boolean"} or ${filters.missingDocuments === true}=exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id and ${outstandingChecklistSql(sql)}))
    and (${query}::text is null or c.company_name ilike ${query} escape '\\' or c.cr_number ilike ${query} escape '\\')
    and (${filters.risk ?? null}::text is null or ${caseRiskSql(sql, today)}=${filters.risk ?? null})`;
}

export type ScopedCaseMetrics = {
  businessDate: string;
  total: number;
  activeCases: number;
  overdueCases: number;
  missingDocumentCount: number;
  casesWithMissingDocuments: number;
  assignedToMe: number;
  dueIn7: number;
  dueIn30: number;
  highRisk: number;
  paymentPending: number;
};

export async function countScopedCases(
  sql: Query,
  filters: CaseFilters,
  today: string,
  userId?: string,
): Promise<ScopedCaseMetrics> {
  const [row] = await sql<
    {
      total: number;
      active_cases: number;
      overdue_cases: number;
      missing_document_count: number;
      cases_with_missing_documents: number;
      assigned_to_me: number;
      due_in_7: number;
      due_in_30: number;
      high_risk: number;
      payment_pending: number;
    }[]
  >`
    select count(*)::int total,
      count(*) filter(where ${activeCaseSql(sql)})::int active_cases,
      count(*) filter(where ${activeCaseSql(sql)} and arc.filing_due_date<${today}::date)::int overdue_cases,
      coalesce(sum((select count(*) from annual_return_checklist_items i where i.case_id=arc.id and ${outstandingChecklistSql(sql)})) filter(where ${activeCaseSql(sql)}),0)::int missing_document_count,
      count(*) filter(where ${activeCaseSql(sql)} and exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id and ${outstandingChecklistSql(sql)}))::int cases_with_missing_documents,
      count(*) filter(where ${activeCaseSql(sql)} and arc.owner_id=${userId || null}::uuid)::int assigned_to_me,
      count(*) filter(where ${activeCaseSql(sql)} and arc.filing_due_date>=${today}::date and arc.filing_due_date<=${today}::date+7)::int due_in_7,
      count(*) filter(where ${activeCaseSql(sql)} and arc.filing_due_date>=${today}::date and arc.filing_due_date<=${today}::date+30)::int due_in_30,
      count(*) filter(where ${activeCaseSql(sql)} and ${caseRiskSql(sql, today)} in ('red','orange'))::int high_risk,
      count(*) filter(where ${activeCaseSql(sql)} and not exists(select 1 from payments p where p.case_id=arc.id and p.status='Payment received'))::int payment_pending
    from annual_return_cases arc join companies c on c.id=arc.company_id
    where ${caseScopeSql(sql, filters, today)}`;
  if (!row) throw new Error("Operational metrics unavailable.");
  return {
    businessDate: today,
    total: Number(row.total),
    activeCases: Number(row.active_cases),
    overdueCases: Number(row.overdue_cases),
    missingDocumentCount: Number(row.missing_document_count),
    casesWithMissingDocuments: Number(row.cases_with_missing_documents),
    assignedToMe: Number(row.assigned_to_me),
    dueIn7: Number(row.due_in_7),
    dueIn30: Number(row.due_in_30),
    highRisk: Number(row.high_risk),
    paymentPending: Number(row.payment_pending),
  };
}
