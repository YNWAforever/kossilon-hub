import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import { literalContains } from "@/lib/list-page";

/** Used by list/count and bulk snapshot/preview against aliases w and c. */
export function queueScopeSql(
  sql: SqlClient | postgres.TransactionSql,
  filters: {
    teamId?: string;
    ownerId?: string;
    reviewerId?: string;
    unassigned?: boolean;
    escalationState?: string;
    workType?: string;
    workStatus?: string;
    priority?: string;
    q?: string;
    includeFixtures?: boolean;
    activeOnly?: boolean;
  },
) {
  return sql`
    (${filters.activeOnly === false && !filters.workStatus} or w.status = any(${filters.workStatus ? [filters.workStatus] : ["open", "in_progress", "blocked"]}))
    and (${filters.teamId ?? null}::uuid is null or (w.team_id=${filters.teamId ?? null} and c.assigned_team_id=${filters.teamId ?? null}))
    and (${filters.ownerId ?? null}::uuid is null or w.owner_id=${filters.ownerId ?? null})
    and (${filters.reviewerId ?? null}::uuid is null or w.reviewer_id=${filters.reviewerId ?? null})
    and (${filters.unassigned !== true} or w.owner_id is null)
    and (${filters.includeFixtures === true} or c.data_origin<>'fixture')
    and (${filters.escalationState ?? null}::text is null or w.escalation_state=${filters.escalationState ?? null})
    and (${filters.workType ?? null}::text is null or w.work_type=${filters.workType ?? null})
    and (${filters.priority ?? null}::text is null or (${filters.priority === "high"} and w.priority>=70) or (${filters.priority === "normal"} and w.priority<70))
    and (${filters.q?.trim() ?? ""}='' or (w.title||' '||w.work_type||' '||c.company_name) ilike ${literalContains(filters.q?.trim() ?? "")})`;
}
