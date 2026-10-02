import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
type Query = SqlClient | postgres.TransactionSql;
/** Aggregate assignment token. Callers bind aliases arc/c to their scoped query. */
export function caseAssignmentVersionSql(sql: Query) {
  return sql`md5(jsonb_build_object('case',to_jsonb(arc),'team',c.assigned_team_id,'origin',c.data_origin,'work',coalesce((select jsonb_agg(jsonb_build_array(w.id,w.version,w.status,w.owner_id,w.reviewer_id,w.team_id) order by w.id) from work_items w where w.annual_return_case_id=arc.id),'[]'::jsonb))::text)`;
}
export async function assertCaseAssignmentVersion(
  tx: postgres.TransactionSql,
  caseId: string,
  expected?: string,
) {
  await tx`select id from work_items where annual_return_case_id=${caseId} order by id for update`;
  if (!expected) return;
  const [row] = await tx<
    { version: string }[]
  >`select ${caseAssignmentVersionSql(tx)} version from annual_return_cases arc join companies c on c.id=arc.company_id where arc.id=${caseId}`;
  if (row?.version !== expected)
    throw Object.assign(new Error("Assignment version changed. Refresh preview."), {
      statusCode: 409,
    });
}
