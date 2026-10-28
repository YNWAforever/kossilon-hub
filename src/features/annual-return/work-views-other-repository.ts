import type { SqlClient } from "@/server/db/client";
import { operationalRead } from "@/server/db/operational-read";
import type { OtherWorkPageRepository } from "./work-views-other-page";
import type { OtherWorkSource } from "./work-views-other";

type Row = {
  business: OtherWorkSource["business"];
  id: string;
  company_name: string;
  owner_id: string | null;
  owner_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  due_date: string | null;
  status: string;
  status_at: string | Date | null;
  required_count: number;
  missing_labels: string[];
  received_count: number;
  sort_key: string;
};

/** SELECT-only projection. Each case domain remains the sole owner of its writes. */
export function createOtherWorkReadRepository(client: SqlClient): OtherWorkPageRepository {
  return {
    async list(input) {
      const pattern = input.q ? `%${input.q.replace(/[\\%_]/g, (value) => `\\${value}`)}%` : null;
      return operationalRead(client, async (sql) => {
        const rows = await sql<Row[]>`
          with sources as (
            select 'incorporation'::text business, ic.id,
              coalesce(nullif(ic.proposed_company_name_zh,''),ic.proposed_company_name_en) company_name,
              ic.proposed_company_name_en||' '||coalesce(ic.proposed_company_name_zh,'') search_name,
              ic.owner_id, owner.name owner_name, null::uuid reviewer_id, null::text reviewer_name,
              ic.target_completion_date::text due_date, ic.status,
              greatest(ic.updated_at,ci.updated_at) status_at,
              ci.required_count,ci.missing_labels,ci.received_count,ci.rejected_count
            from incorporation_cases ic left join users owner on owner.id=ic.owner_id
            cross join lateral (
              select count(*) filter(where required)::int required_count,
                coalesce(array_agg(item_label order by id) filter(where required and status in ('Missing','Rejected')),array[]::text[]) missing_labels,
                count(*) filter(where status='Received')::int received_count,
                count(*) filter(where status='Rejected')::int rejected_count,max(updated_at) updated_at
              from incorporation_checklist_items where case_id=ic.id
            ) ci
            where (${input.incorporationScope.kind === "all"} or ic.team_id=${input.incorporationScope.teamId ?? null}::uuid)
              and ic.status<>'Completed' and ic.completed_at is null
            union all
            select 'corporate_change',r.id,c.company_name,c.company_name,
              r.owner_id,owner.name,w.reviewer_id,w.reviewer_name,
              to_char(w.sla_due_at at time zone 'Asia/Hong_Kong','YYYY-MM-DD'),r.status,
              greatest(r.updated_at,ci.updated_at,w.updated_at),ci.required_count,ci.missing_labels,ci.received_count,ci.rejected_count
            from corporate_change_requests r join companies c on c.id=r.company_id
            left join users owner on owner.id=r.owner_id
            left join lateral (
              select wi.reviewer_id,reviewer.name reviewer_name,wi.sla_due_at,wi.updated_at
              from work_items wi left join users reviewer on reviewer.id=wi.reviewer_id
              where wi.corporate_change_request_id=r.id and wi.company_id=r.company_id
                and wi.status not in ('completed','cancelled')
              order by wi.sla_due_at asc nulls last,wi.id limit 1
            ) w on true
            cross join lateral (
              select count(*) filter(where required)::int required_count,
                coalesce(array_agg(item_label order by id) filter(where required and status in ('Missing','Rejected')),array[]::text[]) missing_labels,
                count(*) filter(where status='Received')::int received_count,
                count(*) filter(where status='Rejected')::int rejected_count,max(updated_at) updated_at
              from corporate_change_checklist_items where request_id=r.id
            ) ci
            where (${input.corporateTeamId ?? null}::uuid is null or c.assigned_team_id=${input.corporateTeamId ?? null}::uuid)
              and r.status not in ('Completed','Cancelled') and r.completed_at is null
          ), filtered as (
            select *,case when ${input.sort}='company' then company_name else coalesce(due_date,'9999-12-31') end sort_key
            from sources where (${pattern}::text is null or search_name ilike ${pattern} escape '\\')
              and case ${input.view}
                when 'chaseToday' then status<>'Filed with Registrar'
                  and (cardinality(missing_labels)>0 or required_count=0 or status in ('Intake','Requested'))
                  and (due_date is null or due_date::date<=${input.today}::date+30)
                when 'newlyReceived' then status<>'Filed with Registrar' and received_count>0
                when 'awaitingMyReview' then status<>'Filed with Registrar'
                  and (owner_id=${input.viewerUserId}::uuid or reviewer_id=${input.viewerUserId}::uuid)
                  and (received_count>0 or status='Ready to file')
                when 'returnsAndExceptions' then status='Filed with Registrar' or rejected_count>0
                  or (status='Documents pending' and required_count>0
                    and cardinality(missing_labels)=0 and received_count=0)
                else false
              end
          ) select * from filtered
          where (${input.after === null} or (sort_key collate "C",business collate "C",id)>
            (${input.after?.sortKey ?? ""} collate "C",${input.after?.business ?? ""} collate "C",${input.after?.id ?? null}::uuid))
          order by sort_key collate "C",business collate "C",id limit ${input.limit}
        `;
        return rows.map((r) => ({
          business: r.business,
          id: r.id,
          companyName: r.company_name,
          ownerId: r.owner_id,
          ownerName: r.owner_name,
          reviewerId: r.reviewer_id,
          reviewerName: r.reviewer_name,
          dueDate: r.due_date,
          status: r.status,
          statusAt: r.status_at instanceof Date ? r.status_at.toISOString() : r.status_at,
          completedAt: null,
          requiredCount: r.required_count,
          missingLabels: r.missing_labels,
          receivedCount: r.received_count,
          sortKey: r.sort_key,
        }));
      });
    },
  };
}
