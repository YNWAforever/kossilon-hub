import { BusinessHandoverRejection } from "./business-handover-errors";
import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  businessHandoverSchema,
  type BusinessHandoverItem,
  type BusinessHandoverReceipt,
} from "./types";
type Query = SqlClient | postgres.TransactionSql;
export async function staffBusinessOutstanding(sql: Query, userId: string) {
  const [r] =
    await sql`select (select count(*)::int from incorporation_cases where owner_id=${userId} and status not in ('Completed','Cancelled'))+(select count(*)::int from corporate_change_requests where owner_id=${userId} and status not in ('Completed','Cancelled')) business,(select count(*)::int from companies where assigned_owner_id=${userId}) companies,(select count(*)::int from bulk_operation_jobs j join bulk_operation_previews p on p.id=j.preview_id where (j.actor_user_id=${userId} or j.assignment->>'assigneeId'=${userId} or p.assignment->'selectionFilters'->>'ownerId'=${userId} or p.assignment->'selectionFilters'->>'reviewerId'=${userId}) and (j.state in ('queued','running') or exists(select 1 from bulk_operation_job_items i where i.job_id=j.id and (i.state='unknown' or (i.state='conflict' and (exists(select 1 from annual_return_cases a where a.id=i.resource_id and (a.owner_id=${userId} or a.reviewer_id=${userId})) or exists(select 1 from work_items w where w.id=i.resource_id and (w.owner_id=${userId} or w.reviewer_id=${userId})))))))) unresolved`;
  return {
    openBusinessCases: r.business as number,
    ownedCompanies: r.companies as number,
    unresolvedJobs: r.unresolved as number,
  };
}
export function createBusinessHandoverRepository({
  sql,
  transact,
  authorize,
  target,
}: {
  sql: Query;
  transact: <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T>;
  authorize: (tx: Query, actor: AuthenticatedActor) => Promise<void>;
  target: (
    tx: Query,
    id: string,
    lock?: boolean,
  ) => Promise<{ id: string; role: string; team_id: string | null; access_revision: number }>;
}) {
  async function previewBusiness(userId: string) {
    const counts = await staffBusinessOutstanding(sql, userId);
    const rows =
      await sql`(select 'incorporation' kind,b.id,b.proposed_company_name_en label,b.status,md5(to_jsonb(b)::text) version from incorporation_cases b where b.owner_id=${userId} and b.status not in ('Completed','Cancelled') order by b.id limit 101) union all (select 'corporate_change_request' kind,b.id,c.company_name label,b.status,md5(to_jsonb(b)::text) version from corporate_change_requests b join companies c on c.id=b.company_id where b.owner_id=${userId} and b.status not in ('Completed','Cancelled') order by b.id limit 101) union all (select 'client_company' kind,b.id,b.company_name label,b.status,md5(to_jsonb(b)::text) version from companies b where b.assigned_owner_id=${userId} order by b.id limit 101)`;
    return {
      ...counts,
      businessItems: rows.slice(0, 100) as BusinessHandoverItem[],
      businessTruncated: rows.length > 100,
    };
  }
  async function getBusinessHandoverReceipt(
    actor: AuthenticatedActor,
    userId: string,
    operationId: string,
  ): Promise<BusinessHandoverReceipt | null> {
    await authorize(sql, actor);
    const [r] =
      await sql`select metadata from staff_access_events where target_user_id=${userId} and actor_user_id=${actor.userId} and handover_operation_id=${operationId} order by created_at desc limit 1`;
    return r?.metadata?.receipt ?? null;
  }
  async function transferBusinessHandover(
    actor: AuthenticatedActor,
    raw: unknown,
  ): Promise<BusinessHandoverReceipt> {
    const input = businessHandoverSchema.parse(raw);
    return transact(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('kossilon_staff_admin_lifecycle'))`;
      await authorize(tx, actor);
      const [payload] = await tx`select md5(${tx.json(input)}::jsonb::text) hash`;
      const [saved] =
        await tx`select metadata from staff_access_events where target_user_id=${input.userId} and actor_user_id=${actor.userId} and handover_operation_id=${input.operationId} limit 1`;
      if (saved) {
        if (saved.metadata.payloadHash !== payload.hash)
          throw Error("Idempotency key conflicts with a different payload.");
        return saved.metadata.receipt;
      }
      const source = await target(tx, input.userId, true);
      if (source.access_revision !== input.expectedVersion)
        throw new BusinessHandoverRejection("staff_version_conflict");
      const [recipient] =
        await tx`select u.id,u.team_id from users u join staff_profiles sp on sp.user_id=u.id join teams t on t.id=u.team_id where u.id=${input.recipientId} and u.active and sp.active and u.role in ('Admin','Manager','Staff') and sp.role=u.role and sp.team_id=u.team_id and t.active for share of u,sp`;
      if (!recipient || recipient.id === input.userId)
        throw new BusinessHandoverRejection("recipient_unavailable");
      const item = input.item;
      let rows;
      if (item.kind === "incorporation")
        rows =
          await tx`update incorporation_cases b set owner_id=${recipient.id},updated_at=now() where b.id=${item.id} and b.owner_id=${source.id} and b.team_id=${recipient.team_id} and b.status not in ('Completed','Cancelled') and md5(to_jsonb(b)::text)=${item.version} returning b.id`;
      else if (item.kind === "corporate_change_request")
        rows =
          await tx`update corporate_change_requests b set owner_id=${recipient.id},updated_at=now() from companies c where b.id=${item.id} and c.id=b.company_id and c.assigned_team_id=${recipient.team_id} and b.owner_id=${source.id} and b.status not in ('Completed','Cancelled') and md5(to_jsonb(b)::text)=${item.version} returning b.id`;
      else
        rows =
          await tx`update companies b set assigned_owner_id=${recipient.id},updated_at=now() where b.id=${item.id} and b.assigned_owner_id=${source.id} and b.assigned_team_id=${recipient.team_id} and md5(to_jsonb(b)::text)=${item.version} returning b.id`;
      const receipt: BusinessHandoverReceipt = {
        operationId: input.operationId,
        resourceId: item.id,
        kind: item.kind,
        state: rows.length ? "succeeded" : "conflict",
        recipientId: input.recipientId,
      };
      await tx`insert into staff_access_events(target_user_id,actor_user_id,event_type,old_role,new_role,old_team_id,new_team_id,handover_operation_id,metadata) values(${source.id},${actor.userId},'access_changed',${source.role},${source.role},${source.team_id},${source.team_id},${input.operationId},${tx.json({ kind: "business_handover", payloadHash: payload.hash, receipt })})`;
      return receipt;
    });
  }
  return { previewBusiness, transferBusinessHandover, getBusinessHandoverReceipt };
}
