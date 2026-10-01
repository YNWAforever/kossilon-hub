import type postgres from "postgres";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { caseFiltersForActor } from "@/features/annual-return/permissions";
import { caseScopeSql } from "@/features/annual-return/case-scope";
import { caseAssignmentVersionSql } from "@/features/annual-return/assignment-version";
import { createWorkItemRepository } from "@/features/work-items/repository";
import { assignmentDecisionFor } from "@/features/work-items/repository";
import { readActiveStaffUser } from "@/features/auth/staff-state";
import { assertBulkManager } from "./authorization";
import { assertCaseAssignmentTarget } from "@/features/annual-return/assignment-target";
import { applyAssignment } from "./assignment-adapter";
import { originFilterForActor } from "@/features/clients/data-origin";
import { hongKongBusinessDate } from "@/lib/hong-kong-time";
import {
  snapshotSchema,
  previewSchema,
  executeSchema,
  resultsSchema,
  type Assignment,
  type BulkResource,
  type BulkFilters,
  type BulkPreview,
  type SnapshotItem,
  type JobResult,
  type JobLease,
  type ItemState,
} from "./types";
type Query = SqlClient | postgres.TransactionSql;
type ResourceRow = {
  id: string;
  version: string;
  locked: boolean;
  owner_id: string | null;
  reviewer_id: string | null;
  label: string;
  child_owner_ids?: (string | null)[];
  child_reviewer_ids?: (string | null)[];
};
type JobRow = {
  id: string;
  actor_user_id: string;
  auth_user_id: string;
  resource: BulkResource;
  assignment: Assignment;
  state: JobResult["state"];
  total: number;
  lease_token: string | null;
  valid_lease: boolean;
  cancel_requested: boolean;
};
type ItemRow = {
  ordinal: number;
  resource_id: string;
  expected_version: string;
  state: ItemState;
  reason: string | null;
  retryable: boolean;
  attempts: number;
};
async function hash(value: unknown) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
export function createBulkOperationsRepository({
  sql = getSqlClient(),
  assign = applyAssignment,
}: { sql?: SqlClient; assign?: typeof applyAssignment } = {}) {
  async function currentActor(
    db: Query,
    identity: Pick<AuthenticatedActor, "userId" | "authUserId">,
    lock = false,
  ): Promise<AuthenticatedActor> {
    const [r] = await db<
      { user_id: string; role: AuthenticatedActor["role"]; team_id: string | null }[]
    >`select u.id user_id,u.role,u.team_id from users u join staff_profiles sp on sp.user_id=u.id where u.id=${identity.userId!} and sp.auth_user_id=${identity.authUserId} and u.active and sp.active and u.role=sp.role and u.team_id is not distinct from sp.team_id ${lock ? db`for share of u,sp` : db``}`;
    if (!r) throw new Error("Forbidden: verified active staff identity required.");
    const actor = {
      authUserId: identity.authUserId,
      userId: r.user_id,
      role: r.role,
      teamId: r.team_id,
      active: true,
    };
    assertBulkManager(actor);
    return actor;
  }
  async function resources(
    db: Query,
    actor: AuthenticatedActor,
    resource: BulkResource,
    filters: BulkFilters = {},
    ids?: readonly string[],
    lock = false,
  ): Promise<ResourceRow[]> {
    const allowedFields =
      resource === "annual_return_case"
        ? new Set([
            "q",
            "ownerId",
            "reviewerId",
            "teamId",
            "status",
            "risk",
            "activeOnly",
            "missingDocuments",
            "paymentStatus",
            "overdueOnly",
            "includeFixtures",
          ])
        : new Set([
            "q",
            "ownerId",
            "reviewerId",
            "teamId",
            "workType",
            "workStatus",
            "escalationState",
            "priority",
            "view",
            "unassigned",
            "includeFixtures",
          ]);
    if (Object.keys(filters).some((key) => !allowedFields.has(key)))
      throw new Error("Unsupported filters for this resource.");
    const today = hongKongBusinessDate();
    const origin = originFilterForActor(actor, filters.includeFixtures);
    const scoped = caseFiltersForActor({
      id: actor.userId,
      role: actor.role,
      teamId: actor.teamId,
      active: actor.active,
    });
    if (resource === "annual_return_case")
      return db<
        ResourceRow[]
      >`select arc.id,c.company_name label,arc.owner_id,arc.reviewer_id,array(select wi.owner_id from work_items wi where wi.annual_return_case_id=arc.id and wi.status in ('open','in_progress','blocked')) child_owner_ids,array(select wi.reviewer_id from work_items wi where wi.annual_return_case_id=arc.id and wi.status in ('open','in_progress','blocked')) child_reviewer_ids,${caseAssignmentVersionSql(db)} version,(arc.locked_at is not null or arc.completed_at is not null or arc.current_status='Completed' or c.data_origin='fixture') locked from annual_return_cases arc join companies c on c.id=arc.company_id where ${caseScopeSql(db, { ...filters, ...origin }, today)} and ${caseScopeSql(db, { ...scoped, ...origin }, today)} and (${ids ? [...ids] : null}::uuid[] is null or arc.id=any(${ids ? [...ids] : null}::uuid[])) order by arc.id limit 20001 ${lock ? db`for update of arc for share of c` : db``}`;
    const q = filters.q ? `%${filters.q.replace(/[\\%_]/g, (v) => `\\${v}`)}%` : null;
    return db<
      ResourceRow[]
    >`select w.id,w.title||' · '||c.company_name label,w.owner_id,w.reviewer_id,w.version::text version,(w.status in ('completed','cancelled') or arc.current_status='Completed' or arc.locked_at is not null or c.data_origin='fixture') locked from work_items w join companies c on c.id=w.company_id left join annual_return_cases arc on arc.id=w.annual_return_case_id
   where (${actor.role === "Admin"} or (w.team_id=${actor.teamId}::uuid and c.assigned_team_id=${actor.teamId}::uuid)) and (${origin.includeFixtures} or c.data_origin<>'fixture')
   and (${ids ? [...ids] : null}::uuid[] is null or w.id=any(${ids ? [...ids] : null}::uuid[]))
   and (${filters.teamId ?? null}::uuid is null or w.team_id=${filters.teamId ?? null}::uuid) and (${filters.ownerId ?? null}::uuid is null or w.owner_id=${filters.ownerId ?? null}::uuid)
   and (${filters.reviewerId ?? null}::uuid is null or w.reviewer_id=${filters.reviewerId ?? null}::uuid) and (${filters.unassigned !== true} or w.owner_id is null)
   and (${filters.view !== "mine"} or w.owner_id=${actor.userId!}) and (${filters.view !== "breached"} or w.escalation_state='breach')
   and (${filters.workType ?? null}::text is null or w.work_type=${filters.workType ?? null}) and (${filters.workStatus ?? null}::text is null or w.status=${filters.workStatus ?? null})
   and (${filters.escalationState ?? null}::text is null or w.escalation_state=${filters.escalationState ?? null}) and (${filters.priority ?? null}::text is null or (${filters.priority === "high"} and w.priority>=70) or (${filters.priority === "normal"} and w.priority<70))
   and (${q}::text is null or (w.title||' '||w.work_type||' '||c.company_name) ilike ${q} escape '\\') order by w.id limit 20001 ${lock ? db`for update of w for share of c` : db``}`;
  }
  const snapshotItems = (rows: ResourceRow[]): SnapshotItem[] =>
    rows.map((r) => ({ id: r.id, version: r.version, reason: r.locked ? "locked" : null }));
  async function createSnapshot(
    actor: AuthenticatedActor,
    input: Parameters<typeof snapshotSchema.parse>[0],
  ) {
    assertBulkManager(actor);
    const data = snapshotSchema.parse(input);
    const verified = await currentActor(sql, actor);
    const rows = await resources(sql, verified, data.resource, data.filters);
    if (rows.length > 20000) throw new Error("Selection exceeds20000; narrow the server filters.");
    const items = snapshotItems(rows);
    const snapshotHash = await hash({ resource: data.resource, items });
    const [saved] = await sql<
      { id: string; expires_at: string }[]
    >`insert into bulk_selection_snapshots(actor_user_id,auth_user_id,resource,filters,items,snapshot_hash) values(${verified.userId!},${verified.authUserId},${data.resource},${sql.json(data.filters)},${sql.json(items)},${snapshotHash}) returning id,expires_at::text`;
    return { snapshotId: saved.id, count: items.length, snapshotHash, expiresAt: saved.expires_at };
  }
  async function preview(
    actor: AuthenticatedActor,
    input: Parameters<typeof previewSchema.parse>[0],
  ): Promise<BulkPreview> {
    assertBulkManager(actor);
    const data = previewSchema.parse(input);
    const verified = await currentActor(sql, actor);
    let items: SnapshotItem[];
    if (data.selection.mode === "filtered_snapshot") {
      const [s] = await sql<
        { resource: BulkResource; items: SnapshotItem[] }[]
      >`select resource,items from bulk_selection_snapshots where id=${data.selection.snapshotId} and actor_user_id=${verified.userId!} and auth_user_id=${verified.authUserId} and expires_at>now()`;
      if (!s || s.resource !== data.resource)
        throw new Error("Forbidden: own unexpired matching snapshot required.");
      const excluded = new Set(data.selection.excludedIds);
      const all = new Set(s.items.map((i) => i.id));
      if ([...excluded].some((id) => !all.has(id)))
        throw new Error("Excluded IDs are outside this snapshot.");
      items = s.items.filter((i) => !excluded.has(i.id));
      const current = new Map(
        (
          await resources(
            sql,
            verified,
            data.resource,
            {},
            items.map((i) => i.id),
          )
        ).map((r) => [r.id, r]),
      );
      items = items.map((i) => ({
        ...i,
        reason: !current.has(i.id) ? "forbidden" : current.get(i.id)!.locked ? "locked" : i.reason,
      }));
    } else {
      const ids = unique(data.selection.ids);
      const current = new Map(
        (await resources(sql, verified, data.resource, {}, ids)).map((r) => [r.id, r]),
      );
      items = ids.map((id) => {
        const r = current.get(id);
        return {
          id,
          version: r?.version ?? "",
          reason: !r ? "forbidden" : r.locked ? "locked" : null,
        };
      });
    }
    await readActiveStaffUser(sql, data.assignment.assigneeId);
    const dryRunRows = new Map(
      (
        await resources(
          sql,
          verified,
          data.resource,
          {},
          items.map((i) => i.id),
        )
      ).map((r) => [r.id, r]),
    );
    for (const item of items) {
      if (item.reason) continue;
      const row = dryRunRows.get(item.id);
      if (!row) {
        item.reason = "forbidden";
        continue;
      }
      if (row.version !== item.version) {
        item.reason = "conflict";
        continue;
      }
      try {
        if (data.resource === "annual_return_case")
          assertCaseAssignmentTarget(
            data.assignment.target,
            data.assignment.assigneeId,
            data.assignment.target === "owner" ? row.reviewer_id : row.owner_id,
            verified.role,
            data.assignment.target === "owner" ? row.child_reviewer_ids : row.child_owner_ids,
          );
        else {
          const recommendations = await createWorkItemRepository({ sql }).recommendAssignees(
            item.id,
            {
              assignmentTarget: data.assignment.target,
              expectedTeamId: verified.role === "Manager" ? verified.teamId! : undefined,
            },
          );
          assignmentDecisionFor({
            selectedUserId: data.assignment.assigneeId,
            recommendations,
            overrideReason: data.assignment.overrideReason,
          });
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/^(Owner and reviewer|Forbidden:|Selected assignee|An override reason)/.test(
            error.message,
          )
        )
          throw error;
        item.reason = "failed";
      }
    }
    const payloadHash = await hash({ resource: data.resource, assignment: data.assignment, items });
    const [p] = await sql<
      { id: string }[]
    >`insert into bulk_operation_previews(actor_user_id,auth_user_id,resource,assignment,items,payload_hash) values(${verified.userId!},${verified.authUserId},${data.resource},${sql.json(data.assignment)},${sql.json(items)},${payloadHash}) returning id`;
    return {
      previewId: p.id,
      count: items.length,
      eligibleCount: items.filter((i) => !i.reason).length,
      reasons: {
        forbidden: items.filter((i) => i.reason === "forbidden").length,
        locked: items.filter((i) => i.reason === "locked").length,
        conflict: items.filter((i) => i.reason === "conflict").length,
        failed: items.filter((i) => i.reason === "failed").length,
      },
      payloadHash,
    };
  }
  async function execute(
    actor: AuthenticatedActor,
    input: Parameters<typeof executeSchema.parse>[0],
  ) {
    assertBulkManager(actor);
    const data = executeSchema.parse(input);
    return sql.begin(async (tx) => {
      const verified = await currentActor(tx, actor, true);
      const [p] = await tx<
        {
          id: string;
          resource: BulkResource;
          assignment: Assignment;
          items: SnapshotItem[];
          payload_hash: string;
          valid: boolean;
        }[]
      >`select id,resource,assignment,items,payload_hash,expires_at>now() valid from bulk_operation_previews where id=${data.previewId} and actor_user_id=${verified.userId!} and auth_user_id=${verified.authUserId}`;
      if (!p) throw new Error("Forbidden: own preview required.");
      const [existing] = await tx<
        { id: string; payload_hash: string; state: JobResult["state"] }[]
      >`select id,payload_hash,state from bulk_operation_jobs where actor_user_id=${verified.userId!} and idempotency_key=${data.idempotencyKey}`;
      if (existing) {
        if (existing.payload_hash !== p.payload_hash)
          throw new Error("Idempotency key conflicts with a different payload.");
        return { jobId: existing.id, state: existing.state };
      }
      if (!p.valid) throw new Error("Preview expired. Create a new preview.");
      const [j] = await tx<
        { id: string; state: JobResult["state"] }[]
      >`insert into bulk_operation_jobs(preview_id,actor_user_id,auth_user_id,idempotency_key,payload_hash,resource,assignment,total) values(${p.id},${verified.userId!},${verified.authUserId},${data.idempotencyKey},${p.payload_hash},${p.resource},${tx.json(p.assignment)},${p.items.length}) on conflict(actor_user_id,idempotency_key) do nothing returning id,state`;
      if (!j) {
        const [r] = await tx<
          { id: string; payload_hash: string; state: JobResult["state"] }[]
        >`select id,payload_hash,state from bulk_operation_jobs where actor_user_id=${verified.userId!} and idempotency_key=${data.idempotencyKey}`;
        if (r.payload_hash !== p.payload_hash)
          throw new Error("Idempotency key conflicts with a different payload.");
        return { jobId: r.id, state: r.state };
      }
      if (p.items.length)
        await tx`insert into bulk_operation_job_items ${tx(p.items.map((i, ordinal) => ({ job_id: j.id, ordinal, resource_id: i.id, expected_version: i.version, state: i.reason ?? "pending", reason: i.reason, finished_at: i.reason ? new Date() : null })))} `;
      return { jobId: j.id, state: j.state };
    });
  }
  async function ownJob(db: Query, actor: AuthenticatedActor, jobId: string, lock = false) {
    const verified = await currentActor(db, actor);
    const [j] = await db<
      JobRow[]
    >`select *,lease_until>now() valid_lease from bulk_operation_jobs where id=${jobId} and actor_user_id=${verified.userId!} and auth_user_id=${verified.authUserId} ${lock ? db`for update` : db``}`;
    if (!j) throw new Error("Forbidden: own job required.");
    return { job: j, actor: verified };
  }
  async function getJob(
    actor: AuthenticatedActor,
    input: Parameters<typeof resultsSchema.parse>[0],
  ): Promise<JobResult> {
    assertBulkManager(actor);
    const data = resultsSchema.parse(input);
    const { job: j, actor: verified } = await ownJob(sql, actor, data.jobId);
    const limit = data.limit ?? 50,
      cursor = data.cursor ?? 0;
    const rows = await sql<
      ItemRow[]
    >`select ordinal,resource_id,expected_version,state,reason,retryable,attempts from bulk_operation_job_items where job_id=${j.id} and ordinal>=${cursor} order by ordinal limit ${limit + 1}`;
    const allowed = new Map(
      (
        await resources(
          sql,
          verified,
          j.resource,
          {},
          rows.map((r) => r.resource_id),
        )
      ).map((r) => [r.id, r.label] as const),
    );
    const counts = await sql<
      { state: string; n: number }[]
    >`select state,count(*)::int n from bulk_operation_job_items where job_id=${j.id} group by state`;
    const [retryable] = await sql<
      { n: number }[]
    >`select count(*)::int n from bulk_operation_job_items where job_id=${j.id} and state='failed' and retryable`;
    return {
      jobId: j.id,
      resource: j.resource,
      state: j.state,
      total: j.total,
      counts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
      retryableFailedCount: retryable.n,
      items: rows.slice(0, limit).map((r) => ({
        ordinal: r.ordinal,
        resourceId: allowed.has(r.resource_id) ? r.resource_id : null,
        resourceLabel: allowed.get(r.resource_id) ?? null,
        state: r.state,
        reason: allowed.has(r.resource_id) ? r.reason : "access_denied",
        retryable: allowed.has(r.resource_id) && r.retryable,
        attempts: r.attempts,
      })),
      nextCursor: rows.length > limit ? rows[limit].ordinal : null,
    };
  }
  async function finish(tx: postgres.TransactionSql, id: string, token: string) {
    await tx`update bulk_operation_jobs set state=case when cancel_requested then 'cancelled' when exists(select 1 from bulk_operation_job_items where job_id=${id} and state='pending') then 'queued' when exists(select 1 from bulk_operation_job_items where job_id=${id} and state<>'succeeded') then 'partial' else 'completed' end,lease_token=null,lease_until=null,updated_at=now() where id=${id} and lease_token=${token}`;
  }
  async function claim(actor: AuthenticatedActor, jobId: string): Promise<JobLease | null> {
    assertBulkManager(actor);
    return sql.begin(async (tx) => {
      const { job: j } = await ownJob(tx, actor, jobId, true);
      if (
        j.cancel_requested ||
        ["completed", "partial", "cancelled"].includes(j.state) ||
        j.valid_lease
      )
        return null;
      const token = crypto.randomUUID();
      await tx`update bulk_operation_jobs set state='running',lease_token=${token},lease_until=now()+interval '30 seconds',updated_at=now() where id=${j.id}`;
      return { jobId: j.id, token };
    });
  }
  async function settleItem(
    tx: postgres.TransactionSql,
    lease: JobLease,
    item: ItemRow,
    state: ItemState,
    reason: string | null,
    retryable = false,
  ) {
    await tx`update bulk_operation_job_items set state=${state},reason=${reason},retryable=${retryable},attempts=attempts+1,started_at=coalesce(started_at,now()),finished_at=now(),result=jsonb_build_object('state',${state}::text,'reason',${reason}::text,'history',coalesce(result->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('attempt',attempts+1,'state',${state}::text,'reason',${reason}::text,'at',clock_timestamp(),'lease',${lease.token}::text,'actor',(select actor_user_id from bulk_operation_jobs where id=${lease.jobId})))) where job_id=${lease.jobId} and ordinal=${item.ordinal} and state='pending'`;
    await tx`update bulk_operation_jobs set lease_until=now()+interval '30 seconds',updated_at=now() where id=${lease.jobId} and lease_token=${lease.token}`;
  }
  async function lockedLease(tx: postgres.TransactionSql, lease: JobLease) {
    const [j] = await tx<
      JobRow[]
    >`select *,lease_until>now() valid_lease from bulk_operation_jobs where id=${lease.jobId} for update`;
    if (!j || j.lease_token !== lease.token || !j.valid_lease)
      throw new Error("Bulk lease lost; reconcile progress before resume.");
    return j;
  }
  async function processNext(lease: JobLease) {
    let selected: ItemRow | undefined;
    try {
      return await sql.begin(async (tx) => {
        const j = await lockedLease(tx, lease);
        if (j.cancel_requested) return false;
        const [item] = await tx<
          ItemRow[]
        >`select * from bulk_operation_job_items where job_id=${j.id} and state='pending' order by ordinal limit 1 for update`;
        if (!item) return false;
        selected = item;
        let actor: AuthenticatedActor;
        try {
          actor = await currentActor(
            tx,
            { userId: j.actor_user_id, authUserId: j.auth_user_id },
            true,
          );
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("Forbidden:")) throw error;
          await settleItem(tx, lease, item, "forbidden", "actor_access_revoked");
          return true;
        }
        if (j.resource === "work_item") {
          const [w] = await tx<
            { annual_return_case_id: string | null }[]
          >`select annual_return_case_id from work_items where id=${item.resource_id}`;
          if (w?.annual_return_case_id)
            await tx`select id from annual_return_cases where id=${w.annual_return_case_id} for update`;
        }
        const [current] = await resources(tx, actor, j.resource, {}, [item.resource_id], true);
        if (!current) {
          await settleItem(tx, lease, item, "forbidden", "current_scope_denied");
          return true;
        }
        if (current.locked) {
          await settleItem(tx, lease, item, "locked", "current_item_locked");
          return true;
        }
        if (current.version !== item.expected_version) {
          await settleItem(tx, lease, item, "conflict", "version_changed");
          return true;
        }
        await assign(tx, actor, {
          resource: j.resource,
          id: item.resource_id,
          expectedVersion: item.expected_version,
          assignment: j.assignment,
        });
        await settleItem(tx, lease, item, "succeeded", null);
        return true;
      });
    } catch (error) {
      if (!selected) throw error;
      const e = error as { code?: string; statusCode?: number; message?: string };
      const message = e.message ?? "";
      const retryable = ["40001", "40P01"].includes(e.code ?? "");
      const state: ItemState =
        e.statusCode === 409 || /stale|version changed/i.test(message)
          ? "conflict"
          : /Forbidden|inactive|ineligible/i.test(message)
            ? "forbidden"
            : /Closed|completed|locked/i.test(message)
              ? "locked"
              : /^08|ECONN|ETIMEDOUT/.test(e.code ?? "")
                ? "unknown"
                : "failed";
      return sql.begin(async (tx) => {
        await lockedLease(tx, lease);
        const [item] = await tx<
          ItemRow[]
        >`select * from bulk_operation_job_items where job_id=${lease.jobId} and ordinal=${selected!.ordinal} for update`;
        if (item.state !== "pending") return true;
        await settleItem(
          tx,
          lease,
          item,
          state,
          retryable
            ? "transaction_rolled_back"
            : state === "unknown"
              ? "database_outcome_unknown"
              : state === "failed"
                ? "assignment_refused"
                : state,
          retryable,
        );
        return true;
      });
    }
  }
  async function finishChunk(lease: JobLease) {
    return sql.begin(async (tx) => {
      await lockedLease(tx, lease);
      await finish(tx, lease.jobId, lease.token);
    });
  }
  async function cancel(actor: AuthenticatedActor, jobId: string) {
    assertBulkManager(actor);
    return sql.begin(async (tx) => {
      const { actor: verified } = await ownJob(tx, actor, jobId, true);
      const rows =
        await tx`update bulk_operation_job_items set state='cancelled',reason='cancelled_before_start',finished_at=now(),result=jsonb_build_object('history',coalesce(result->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('action','cancel','state','cancelled','actor',${verified.userId!}::text,'at',clock_timestamp()))) where job_id=${jobId} and state='pending' returning ordinal`;
      if (!rows.length) return { cancelledCount: 0 };
      await tx`update bulk_operation_jobs set cancel_requested=true,state='cancelled',lease_token=null,lease_until=null,updated_at=now() where id=${jobId}`;
      return { cancelledCount: rows.length };
    });
  }
  async function retryFailed(actor: AuthenticatedActor, jobId: string) {
    assertBulkManager(actor);
    return sql.begin(async (tx) => {
      const { job: j, actor: verified } = await ownJob(tx, actor, jobId, true);
      if (j.cancel_requested || j.valid_lease)
        throw new Error("Cancelled or leased job cannot retry.");
      const rows =
        await tx`update bulk_operation_job_items set state='pending',reason=null,retryable=false,finished_at=null,result=jsonb_set(coalesce(result,'{}'::jsonb),'{history}',coalesce(result->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('action','retry_failed','actor',${verified.userId!}::text,'at',clock_timestamp()))) where job_id=${jobId} and state='failed' and retryable returning ordinal`;
      if (rows.length)
        await tx`update bulk_operation_jobs set state='queued',lease_token=null,lease_until=null,updated_at=now() where id=${jobId}`;
      return { retryCount: rows.length };
    });
  }
  async function reconcileUnknown(actor: AuthenticatedActor, jobId: string) {
    assertBulkManager(actor);
    return sql.begin(async (tx) => {
      const { job: j, actor: verified } = await ownJob(tx, actor, jobId, true);
      if (j.cancel_requested || j.valid_lease)
        throw new Error("Cancelled or leased job cannot reconcile.");
      const rows = await tx<
        ItemRow[]
      >`select * from bulk_operation_job_items where job_id=${jobId} and state='unknown' order by ordinal for update`;
      for (const i of rows) {
        const [r] = await resources(tx, verified, j.resource, {}, [i.resource_id]);
        const state = r?.version === i.expected_version ? "pending" : "conflict";
        await tx`update bulk_operation_job_items set state=${state},reason='sql_outcome_reconciled',finished_at=case when ${state}='pending' then null else now() end,result=jsonb_set(coalesce(result,'{}'::jsonb),'{history}',coalesce(result->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('action','reconcile_unknown','state',${state}::text,'actor',${verified.userId!}::text,'at',clock_timestamp()))) where job_id=${jobId} and ordinal=${i.ordinal}`;
      }
      if (rows.length)
        await tx`update bulk_operation_jobs set state=case when exists(select 1 from bulk_operation_job_items where job_id=${jobId} and state='pending') then 'queued' else 'partial' end,lease_token=null,lease_until=null,updated_at=now() where id=${jobId}`;
      return { reconciledCount: rows.length };
    });
  }
  async function listJobs(actor: AuthenticatedActor) {
    assertBulkManager(actor);
    const verified = await currentActor(sql, actor);
    const rows = await sql<
      { id: string; state: JobResult["state"]; total: number; created_at: string }[]
    >`select id,state,total,created_at::text from bulk_operation_jobs where actor_user_id=${verified.userId!} and auth_user_id=${verified.authUserId} order by created_at desc,id desc limit 20`;
    return rows.map((r) => ({
      jobId: r.id,
      state: r.state,
      total: r.total,
      createdAt: r.created_at,
    }));
  }
  return {
    createSnapshot,
    preview,
    execute,
    getJob,
    claim,
    // Only the authenticated maintenance adapter calls this. Item processing
    // always rechecks the original approving actor; revoked actors get no writes.
    async claimScheduled(): Promise<JobLease | null> {
      return sql.begin(async (tx) => {
        const [j] = await tx<
          { id: string }[]
        >`select id from bulk_operation_jobs where not cancel_requested and (state='queued' or (state='running' and lease_until<=now())) order by updated_at,id limit 1 for update skip locked`;
        if (!j) return null;
        const token = crypto.randomUUID();
        await tx`update bulk_operation_jobs set state='running',lease_token=${token},lease_until=now()+interval '30 seconds',updated_at=now() where id=${j.id}`;
        return { jobId: j.id, token };
      });
    },
    processNext,
    finishChunk,
    cancel,
    retryFailed,
    reconcileUnknown,
    listJobs,
    async snapshotMembership(
      actor: AuthenticatedActor,
      input: { snapshotId: string; ids: string[] },
    ) {
      assertBulkManager(actor);
      const verified = await currentActor(sql, actor);
      const [s] = await sql<
        { resource: BulkResource; items: SnapshotItem[] }[]
      >`select resource,items from bulk_selection_snapshots where id=${input.snapshotId} and actor_user_id=${verified.userId!} and auth_user_id=${verified.authUserId} and expires_at>now()`;
      if (!s) throw new Error("Forbidden: own unexpired snapshot required.");
      const original = new Set(s.items.map((i) => i.id));
      const allowed = await resources(sql, verified, s.resource, {}, input.ids);
      return { ids: allowed.filter((i) => original.has(i.id)).map((i) => i.id) };
    },
    async listAssignees(actor: AuthenticatedActor) {
      assertBulkManager(actor);
      const verified = await currentActor(sql, actor);
      const { createAnnualReturnRepository } = await import("@/features/annual-return/repository");
      return createAnnualReturnRepository({ sql }).listAssignableStaff(
        verified.role === "Admin" ? {} : { teamId: verified.teamId! },
      );
    },
  };
}
export type BulkOperationsRepository = ReturnType<typeof createBulkOperationsRepository>;
