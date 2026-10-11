import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import { literalContains } from "@/lib/list-page";
export type DocumentReadFilters = {
  id?: string;
  ids?: readonly string[];
  companyId?: string;
  caseId?: string;
  teamId?: string;
  assignedUserId?: string;
  ownerId?: string;
  q?: string;
  category?: string;
  reviewStatus?: "pending" | "verified" | "rejected";
  includeFixtures?: boolean;
};
/** List, count and bulk snapshot/preview use aliases d,c,arc and one predicate. */
export function documentScopeSql(sql: SqlClient | postgres.TransactionSql, f: DocumentReadFilters) {
  return sql`
 (${f.id ?? null}::uuid is null or d.id=${f.id ?? null})
 and (${f.ids ? [...f.ids] : null}::uuid[] is null or d.id=any(${f.ids ? [...f.ids] : null}::uuid[]))
 and (${f.companyId ?? null}::uuid is null or d.company_id=${f.companyId ?? null})
 and (${f.caseId ?? null}::uuid is null or d.case_id=${f.caseId ?? null})
 and (${f.category ?? null}::text is null or d.file_type=${f.category ?? null})
 and (${f.reviewStatus ?? null}::text is null or (case when d.reviewed_document_version_id=(select v.id from document_versions v where v.document_id=d.id and v.superseded_by_version_id is null order by v.version_number desc limit 1) then d.verification_status else 'pending' end)=${f.reviewStatus ?? null})
 and (${f.ownerId ?? null}::uuid is null or arc.owner_id=${f.ownerId ?? null})
 and (${f.includeFixtures === true} or c.data_origin<>'fixture')
 and ((${f.teamId ?? null}::uuid is null and ${f.assignedUserId ?? null}::uuid is null)
   or c.assigned_team_id=${f.teamId ?? null} or arc.owner_id=${f.assignedUserId ?? null} or arc.reviewer_id=${f.assignedUserId ?? null})
 and (${f.q?.trim() ?? ""}='' or d.file_name ilike ${literalContains(f.q?.trim() ?? "")} or c.company_name ilike ${literalContains(f.q?.trim() ?? "")})`;
}
