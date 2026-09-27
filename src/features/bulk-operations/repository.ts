import type postgres from "postgres";
import {
  createNarImportApplyRepository,
  ImportApplyError,
} from "@/features/nar-import/apply-repository";
import { importLogicalKey } from "@/features/nar-import/apply";
import type { ImportPreviewRow } from "@/features/nar-import/preview";
import { createSqlClient, getSqlClient, type SqlClient } from "@/server/db/client";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import {
  applyOneCaseOwnerAssignmentForActor,
  previewCaseOwnerAssignmentsForActor,
} from "./assignment-handler";
import type { AuthenticatedActor } from "@/features/auth/types";
import { filterWorkQueueDisplay } from "@/features/work-items/queue-display-filters";
import { deriveSlaDisplay } from "@/features/work-items/sla";
import {
  assignmentDecisionFor,
  createWorkItemRepository,
  type PersistedWorkItem,
} from "@/features/work-items/repository";
import {
  assertActorCanAssignWorkItem,
  assignWorkItemForActor,
  queueFiltersForActor,
} from "@/features/work-items/server-fns";
import {
  bulkCommitInputSchema,
  bulkPreviewInputSchema,
  type BulkCommitInput,
  type BulkItemState,
  type BulkOperation,
  type BulkOperationView,
  type BulkPreview,
  type BulkPreviewInput,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type WorkAssignInput = Extract<BulkPreviewInput, { action: "assign" }>;
type CaseAssignInput = Extract<BulkPreviewInput, { action: "caseAssign" }>;
type Tx = postgres.TransactionSql;
type PreviewRow = {
  id: string;
  action: "assign" | "caseAssign" | "importApply";
  created_by_id: string;
  auth_user_id: string;
  scope_role: "Admin" | "Manager";
  scope_team_id: string | null;
  parameters: BulkPreviewInput["parameters"] | { approvalId: string };
  selection: BulkPreviewInput["selection"] | { kind: "ids"; ids: string[] };
  resource_snapshot: Record<string, Snapshot>;
  preview_hash: string;
  selection_count: number;
  eligible_count: number;
  skipped_count: number;
  conflict_count: number;
  expires_at: string | Date;
};
type Snapshot = {
  revision: number;
  state: "eligible" | "skipped" | "conflict" | "forbidden";
  teamId: string | null;
  status: string;
  ownerId: string | null;
  reviewerId: string | null;
  reasonCode?: string | null;
  newOwnerId?: string | null;
  newTeamId?: string | null;
};
type OperationRow = {
  id: string;
  preview_id: string;
  action: "assign" | "caseAssign" | "importApply";
  created_by_id: string;
  auth_user_id: string;
  state: BulkOperation["state"];
  created_at: string | Date;
};
type ItemRow = {
  id: string;
  operation_id: string;
  resource_id: string;
  revision_before: number;
  revision_after: number | null;
  state: BulkItemState;
  reason_code: string | null;
  audit_ref: string | null;
  lease_token: string | null;
  attempt_count: number;
};
class BulkItemFailure extends Error {
  constructor(
    public readonly state: "conflict" | "forbidden",
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}
const MAX_ITEMS = 1000;
const MAX_ATTEMPTS = 3;
const RETRY_LEASE_MS = 15 * 60_000;
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}
function transaction<T>(client: QueryClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in client ? (client.begin(fn) as Promise<T>) : fn(client);
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function currentActor(sql: QueryClient, authUserId: string): Promise<AuthenticatedActor> {
  const [row] = await sql<{ user_id: string; role: string; team_id: string | null }[]>`
    select sp.user_id, sp.role, sp.team_id from staff_profiles sp
    join users u on u.id = sp.user_id and u.active
    where sp.auth_user_id = ${authUserId} and sp.active limit 1 for share of sp,u`;
  if (!row || (row.role !== "Admin" && row.role !== "Manager"))
    throw new Error("Forbidden: active Manager or Admin profile required.");
  return { authUserId, userId: row.user_id, role: row.role, teamId: row.team_id, active: true };
}
function assertSameActor(actual: AuthenticatedActor, requested: AuthenticatedActor): void {
  if (
    !requested.active ||
    requested.userId !== actual.userId ||
    requested.role !== actual.role ||
    requested.teamId !== actual.teamId ||
    requested.authUserId !== actual.authUserId
  )
    throw new Error("Forbidden: actor scope changed; create a new preview.");
}
function assertPreviewScope(actor: AuthenticatedActor, preview: PreviewRow): void {
  if (
    preview.created_by_id !== actor.userId ||
    preview.auth_user_id !== actor.authUserId ||
    preview.scope_role !== actor.role ||
    preview.scope_team_id !== actor.teamId
  )
    throw new Error("Forbidden: preview actor or scope changed.");
}
function itemCounts(items: ItemRow[]): BulkOperation["counts"] {
  const counts = {
    pending: 0,
    running: 0,
    succeeded: 0,
    skipped: 0,
    conflict: 0,
    forbidden: 0,
    failed: 0,
    "needs-reconciliation": 0,
    cancelled: 0,
  };
  for (const item of items) counts[item.state] += 1;
  return counts;
}
function mapOperation(row: OperationRow, items: ItemRow[]): BulkOperationView {
  return {
    id: row.id,
    action: row.action,
    state: row.state,
    createdBy: row.created_by_id,
    createdAt: iso(row.created_at),
    counts: itemCounts(items),
    items: items.map((item) => ({
      itemId: item.id,
      resourceId: item.resource_id,
      state: item.state,
      reasonCode: item.reason_code,
      revisionBefore:
        row.action === "caseAssign" && item.reason_code === "CASE_OUT_OF_SCOPE"
          ? null
          : item.revision_before,
      revisionAfter: item.revision_after,
      auditRef: item.audit_ref,
    })),
  };
}
async function snapshotRows(
  sql: QueryClient,
  actor: AuthenticatedActor,
  input: WorkAssignInput,
): Promise<PersistedWorkItem[]> {
  const repository = createWorkItemRepository({ sql });
  if (input.selection.kind === "ids") {
    const ids = [...new Set(input.selection.ids)].sort();
    if (ids.length !== input.selection.ids.length) throw new Error("Duplicate selected IDs.");
    const rows = await Promise.all(ids.map((id) => repository.get(id)));
    if (rows.some((row) => !row)) throw new Error("Forbidden: selected work item is unavailable.");
    for (const row of rows) assertActorCanAssignWorkItem(actor, row!);
    return rows as PersistedWorkItem[];
  }
  if (new Set(input.selection.excludedIds).size !== input.selection.excludedIds.length)
    throw new Error("Duplicate excluded IDs.");
  if ("view" in input.selection.filters) {
    const filters = input.selection.filters;
    const evaluatedAt = await repository.lastSlaEvaluationAt();
    const now = new Date().toISOString();
    const queue = await repository.listQueue(queueFiltersForActor(actor, { view: filters.view }));
    const excluded = new Set(input.selection.excludedIds);
    const selected = filterWorkQueueDisplay(
      queue,
      filters,
      (item) =>
        deriveSlaDisplay(
          {
            status: item.status,
            escalationState: item.escalationState,
            workDueAt: item.workDueAt ?? null,
            slaPolicyVersionId: item.slaPolicyVersionId,
            slaStartedAt: item.slaStartedAt,
            slaWarningAt: item.slaWarningAt,
            slaDueAt: item.slaDueAt,
            slaBreachedAt: item.slaBreachedAt,
            evaluatedAt,
          },
          now,
        ).state,
    ).filter((item) => !excluded.has(item.id));
    if (selected.length > MAX_ITEMS)
      throw new Error("Selection exceeds the 1000-item preview limit.");
    for (const row of selected) assertActorCanAssignWorkItem(actor, row);
    return selected;
  }
  if (
    actor.role === "Manager" &&
    input.selection.filters.teamId &&
    input.selection.filters.teamId !== actor.teamId
  )
    throw new Error("Forbidden: filter is outside the manager's team.");
  const teamId = actor.role === "Manager" ? actor.teamId : (input.selection.filters.teamId ?? null);
  const statuses = input.selection.filters.statuses ?? ["open", "in_progress", "blocked"];
  const rows = await sql<{ id: string }[]>`
    select id from work_items where status = any(${statuses})
      and (${teamId}::uuid is null or team_id = ${teamId})
      and not (id = any(${input.selection.excludedIds}::uuid[]))
    order by id limit ${MAX_ITEMS + 1}`;
  if (rows.length > MAX_ITEMS) throw new Error("Selection exceeds the 1000-item preview limit.");
  const selected = await Promise.all(rows.map((row) => repository.get(row.id)));
  for (const row of selected) if (row) assertActorCanAssignWorkItem(actor, row);
  return selected.filter((row): row is PersistedWorkItem => row !== null);
}

async function caseIdsForSelection(
  sql: QueryClient,
  actor: AuthenticatedActor,
  selection: CaseAssignInput["selection"],
): Promise<string[]> {
  if (selection.kind === "ids") {
    if (new Set(selection.ids).size !== selection.ids.length)
      throw new Error("Duplicate selected IDs.");
    return [...selection.ids].sort();
  }
  if (new Set(selection.excludedIds).size !== selection.excludedIds.length)
    throw new Error("Duplicate excluded IDs.");
  if (actor.role === "Manager" && !actor.teamId)
    throw new Error("Forbidden: manager team is unavailable.");
  const repository = createAnnualReturnRepository({ sql });
  const excluded = new Set(selection.excludedIds);
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await repository.listCasePage({
      ...selection.filters,
      ...(actor.role === "Manager" ? { teamId: actor.teamId! } : {}),
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const case_ of page.cases) {
      if (!excluded.has(case_.id)) ids.add(case_.id);
      if (ids.size > MAX_ITEMS) throw new Error("Selection exceeds the 1000-item preview limit.");
    }
    if (!page.nextCursor) return [...ids].sort();
    cursor = page.nextCursor;
  }
  throw new Error("Matching case scan exceeded 100 pages; narrow the filter.");
}

export function createBulkOperationRepository(
  options: { sql?: QueryClient; databaseUrl?: string } = {},
) {
  const sql =
    options.sql ?? (options.databaseUrl ? createSqlClient(options.databaseUrl) : getSqlClient());
  const ownsClient = Boolean(options.databaseUrl) && !options.sql;
  async function loadView(id: string): Promise<BulkOperationView> {
    const [operation] = await sql<OperationRow[]>`select * from bulk_operations where id = ${id}`;
    if (!operation) throw new Error("Bulk operation not found.");
    const items = await sql<
      ItemRow[]
    >`select * from bulk_operation_items where operation_id = ${id} order by resource_id`;
    return mapOperation(operation, items);
  }
  async function updateOperationState(id: string): Promise<void> {
    const items = await sql<
      ItemRow[]
    >`select * from bulk_operation_items where operation_id = ${id}`;
    const active = items.some(
      (item) =>
        item.state === "pending" ||
        item.state === "running" ||
        (item.state === "failed" && item.attempt_count < MAX_ATTEMPTS),
    );
    if (active) return;
    const allGood = items.every((item) => item.state === "succeeded" || item.state === "skipped");
    const [operation] = await sql<{ action: string; preview_id: string }[]>`
      update bulk_operations set state = ${allGood ? "completed" : "completed-with-errors"},
        updated_at = now() where id = ${id} and state in ('queued','running')
        returning action,preview_id`;
    if (operation?.action === "importApply") {
      await sql`update nar_import_batches b set status = ${allGood ? "applied" : "failed"},
        applied_at = ${allGood ? new Date().toISOString() : null},updated_at = now()
        from nar_import_approvals a,bulk_previews p
        where p.id = ${operation.preview_id}
          and a.id = (p.parameters->>'approvalId')::uuid and b.id = a.batch_id
          and b.revision = a.batch_revision and b.status = 'applying'`;
    }
  }
  return {
    async preview(actor: AuthenticatedActor, rawInput: BulkPreviewInput): Promise<BulkPreview> {
      const input = bulkPreviewInputSchema.parse(rawInput);
      const current = await currentActor(sql, actor.authUserId);
      assertSameActor(current, actor);
      const snapshot: Record<string, Snapshot> = {};
      if (input.action === "caseAssign") {
        const caseIds = await caseIdsForSelection(sql, current, input.selection);
        if (caseIds.length === 0) throw new Error("Selection has no eligible or reviewable items.");
        const decisions = await previewCaseOwnerAssignmentsForActor(
          current,
          { caseIds, ownerId: input.parameters.ownerId },
          { sql },
        );
        for (const item of decisions) {
          snapshot[item.caseId] = {
            // Forbidden explicit IDs deliberately use a sentinel that is never run.
            // No existence, owner, team or revision metadata crosses this boundary.
            revision: item.revision ?? 1,
            state: item.state,
            teamId: item.oldTeamId,
            status: item.reasonCode ?? "assignable",
            ownerId: item.oldOwnerId,
            reviewerId: null,
            reasonCode: item.reasonCode,
            newOwnerId: item.newOwnerId,
            newTeamId: item.newTeamId,
          };
        }
      } else {
        const rows = await snapshotRows(sql, current, input);
        const workRepository = createWorkItemRepository({ sql });
        for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
          const alreadyAssigned =
            (input.parameters.assignmentTarget === "owner" ? row.ownerId : row.reviewerId) ===
            input.parameters.assigneeId;
          let state: Snapshot["state"] =
            row.status === "completed" || row.status === "cancelled"
              ? "conflict"
              : alreadyAssigned
                ? "skipped"
                : "eligible";
          if (state === "eligible") {
            const recommendations = await workRepository.recommendAssignees(row.id, {
              assignmentTarget: input.parameters.assignmentTarget,
              expectedTeamId:
                current.role === "Manager" ? (current.teamId ?? undefined) : undefined,
            });
            try {
              assignmentDecisionFor({
                selectedUserId: input.parameters.assigneeId,
                recommendations,
                overrideReason: input.parameters.overrideReason,
              });
            } catch (error) {
              if (
                !(error instanceof Error) ||
                !/^(Selected assignee is not eligible|An override reason is required)/.test(
                  error.message,
                )
              )
                throw error;
              state = "conflict";
            }
          }
          snapshot[row.id] = {
            revision: row.version,
            state,
            teamId: row.teamId,
            status: row.status,
            ownerId: row.ownerId,
            reviewerId: row.reviewerId,
          };
        }
      }
      const entries = Object.entries(snapshot);
      if (entries.length === 0) throw new Error("Selection has no eligible or reviewable items.");
      const hash = await digest({
        actor: { userId: current.userId, role: current.role, teamId: current.teamId },
        action: input.action,
        parameters: input.parameters,
        snapshot,
      });
      const counts = {
        eligible: entries.filter(([, value]) => value.state === "eligible").length,
        skipped: entries.filter(([, value]) => value.state === "skipped").length,
        conflict: entries.filter(
          ([, value]) => value.state === "conflict" || value.state === "forbidden",
        ).length,
      };
      const [saved] = await sql<{ id: string; expires_at: string | Date }[]>`
        insert into bulk_previews (action,created_by_id,auth_user_id,scope_role,scope_team_id,
          parameters,selection,resource_snapshot,preview_hash,selection_count,eligible_count,skipped_count,conflict_count,expires_at)
        values (${input.action},${current.userId},${current.authUserId},${current.role},${current.teamId},
          ${sql.json(input.parameters)},${sql.json(input.selection)},${sql.json(snapshot)},${hash},
          ${entries.length},${counts.eligible},${counts.skipped},${counts.conflict},
          ${new Date(Date.now() + 15 * 60_000).toISOString()}) returning id,expires_at`;
      return {
        id: saved.id,
        previewHash: hash,
        action: input.action,
        selectionCount: entries.length,
        eligibleCount: counts.eligible,
        skippedCount: counts.skipped,
        conflictCount: counts.conflict,
        expiresAt: iso(saved.expires_at),
        itemsPreview: entries.slice(0, 50).map(([resourceId, value]) => ({
          resourceId,
          revision:
            input.action === "caseAssign" && value.reasonCode === "CASE_OUT_OF_SCOPE"
              ? null
              : value.revision,
          state: value.state,
          reasonCode: value.reasonCode ?? null,
          oldOwnerId: value.ownerId,
          oldTeamId: value.teamId,
          newOwnerId: value.newOwnerId ?? null,
          newTeamId: value.newTeamId ?? null,
        })),
      };
    },
    async commit(actor: AuthenticatedActor, rawInput: BulkCommitInput): Promise<BulkOperation> {
      const input = bulkCommitInputSchema.parse(rawInput);
      const id = await transaction(sql, async (tx) => {
        const current = await currentActor(tx, actor.authUserId);
        assertSameActor(current, actor);
        const [preview] = await tx<
          PreviewRow[]
        >`select * from bulk_previews where id = ${input.previewId} for update`;
        if (!preview) throw new Error("Bulk preview not found.");
        assertPreviewScope(current, preview);
        if (preview.action !== "assign" && preview.action !== "caseAssign")
          throw new Error("Unsupported bulk preview action for generic commit.");
        if (
          preview.preview_hash !== input.previewHash ||
          Date.parse(iso(preview.expires_at)) <= Date.now()
        )
          throw new Error("Bulk preview is stale; revalidate before approval.");
        const selectedIds = Object.keys(preview.resource_snapshot);
        if (preview.action === "assign") {
          const currentItems = await tx<{ id: string; version: number; team_id: string | null }[]>`
          select id,version,team_id from work_items
          where id = any(${selectedIds}::uuid[]) for share`;
          if (currentItems.length !== selectedIds.length)
            throw new Error("Bulk preview is stale; resource disappeared.");
          for (const item of currentItems) {
            const snapshot = preview.resource_snapshot[item.id];
            if (item.version !== snapshot.revision || item.team_id !== snapshot.teamId)
              throw new Error("Bulk preview is stale; revalidate changed work items.");
            if (current.role === "Manager" && item.team_id !== current.teamId)
              throw new Error("Forbidden: work item moved outside the actor's team.");
          }
        }
        // Case assignments use per-item revision and authority checks in the runner.
        // A changed case must not abort unrelated eligible cases at commit time.
        const logicalKey = preview.preview_hash;
        const [inserted] = await tx<{ id: string }[]>`
          insert into bulk_operations (preview_id,action,created_by_id,auth_user_id,idempotency_key,logical_key)
          values (${preview.id},${preview.action},${current.userId},${current.authUserId},${input.idempotencyKey},${logicalKey})
          on conflict do nothing returning id`;
        if (!inserted) {
          const [existing] = await tx<{ id: string; preview_id: string; logical_key: string }[]>`
            select id,preview_id,logical_key from bulk_operations where preview_id = ${preview.id}
              or (created_by_id = ${current.userId} and idempotency_key = ${input.idempotencyKey})
              or logical_key = ${logicalKey} limit 1`;
          if (!existing || existing.logical_key !== logicalKey)
            throw new Error("Idempotency key belongs to another operation.");
          return existing.id;
        }
        for (const [resourceId, value] of Object.entries(preview.resource_snapshot)) {
          await tx`insert into bulk_operation_items
              (operation_id,resource_id,revision_before,state,reason_code)
            values (${inserted.id},${resourceId},${value.revision},
              ${value.state === "eligible" ? "pending" : value.state},
              ${value.reasonCode ?? null})`;
        }
        return inserted.id;
      });
      const view = await loadView(id);
      return view;
    },
    async commitImportApproval(
      actor: AuthenticatedActor,
      input: { approvalId: string; idempotencyKey: string },
    ): Promise<BulkOperationView> {
      if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 128)
        throw new Error("An idempotency key of 8 to 128 characters is required.");
      const id = await transaction(sql, async (tx) => {
        const current = await currentActor(tx, actor.authUserId);
        assertSameActor(current, actor);
        if (current.role !== "Admin")
          throw new Error("Forbidden: Admin import authority required.");
        const [approval] = await tx<
          {
            id: string;
            preview_id: string;
            batch_id: string;
            preview_hash: string;
            batch_revision: number;
            approved_by: string;
          }[]
        >`select * from nar_import_approvals where id = ${input.approvalId} for update`;
        if (!approval || approval.approved_by !== current.userId)
          throw new Error("Forbidden: import approval belongs to another actor.");
        const [source] = await tx<
          {
            id: string;
            rows: ImportPreviewRow[];
            semantic_key: string;
            preview_hash: string;
            created_by: string;
          }[]
        >`select * from nar_import_previews where id = ${approval.preview_id}`;
        const [batch] = await tx<
          {
            id: string;
            revision: number;
            semantic_key: string | null;
            status: string;
          }[]
        >`select * from nar_import_batches where id = ${approval.batch_id} for update`;
        if (
          !source ||
          !batch ||
          source.created_by !== current.userId ||
          source.preview_hash !== approval.preview_hash ||
          batch.revision !== approval.batch_revision ||
          batch.semantic_key !== source.semantic_key
        )
          throw new Error("Approved import changed; revalidate before applying.");
        const logicalKey = importLogicalKey(source.semantic_key, source.preview_hash);
        await tx`select pg_advisory_xact_lock(hashtextextended(${logicalKey},0))`;
        const [existingKey] = await tx<{ id: string; logical_key: string }[]>`
          select id,logical_key from bulk_operations
          where created_by_id = ${current.userId} and idempotency_key = ${input.idempotencyKey}`;
        if (existingKey && existingKey.logical_key !== logicalKey)
          throw new Error("Idempotency key belongs to another operation.");
        const [existing] = await tx<{ id: string }[]>`
          select id from bulk_operations where logical_key = ${logicalKey}`;
        if (existing) return existing.id;
        const [activeImport] = await tx<{ id: string }[]>`
          select o.id from bulk_operations o
          join bulk_previews p on p.id = o.preview_id
          join nar_import_approvals a on a.id = (p.parameters->>'approvalId')::uuid
          where a.batch_id = ${batch.id} and o.action = 'importApply'
            and o.state in ('queued','running') limit 1`;
        if (activeImport)
          throw new Error("An approved operation is already applying this import batch.");
        if (!["pending_review", "applying", "failed"].includes(batch.status))
          throw new Error("Approved import is no longer pending application.");
        if (!Array.isArray(source.rows) || source.rows.length < 1 || source.rows.length > MAX_ITEMS)
          throw new Error("Approved import must contain 1 to 1000 rows.");
        const snapshot: Record<string, Snapshot> = {};
        for (const row of source.rows) {
          if (snapshot[row.rowId]) throw new Error("Approved import contains duplicate rows.");
          snapshot[row.rowId] = {
            revision: row.rowRevision,
            state:
              row.matchedCompanyId &&
              !["invalid", "needsCompanyMapping", "conflict"].includes(row.disposition)
                ? "eligible"
                : "conflict",
            teamId: null,
            status: row.disposition,
            ownerId: null,
            reviewerId: null,
          };
        }
        const entries = Object.entries(snapshot);
        const eligible = entries.filter(([, value]) => value.state === "eligible").length;
        const [preview] = await tx<{ id: string }[]>`
          insert into bulk_previews
            (action,created_by_id,auth_user_id,scope_role,scope_team_id,parameters,selection,
              resource_snapshot,preview_hash,selection_count,eligible_count,skipped_count,conflict_count,expires_at)
          values ('importApply',${current.userId},${current.authUserId},${current.role},${current.teamId},
            ${tx.json({ approvalId: approval.id })},
            ${tx.json({ kind: "ids", ids: entries.map(([resourceId]) => resourceId) })},
            ${tx.json(snapshot)},${source.preview_hash},${entries.length},${eligible},0,
            ${entries.length - eligible},${new Date(Date.now() + 15 * 60_000).toISOString()}) returning id`;
        const [operation] = await tx<{ id: string }[]>`
          insert into bulk_operations
            (preview_id,action,created_by_id,auth_user_id,idempotency_key,logical_key)
          values (${preview.id},'importApply',${current.userId},${current.authUserId},
            ${input.idempotencyKey},${logicalKey}) returning id`;
        for (const [resourceId, value] of entries) {
          await tx`insert into bulk_operation_items
            (operation_id,resource_id,revision_before,state,reason_code)
          values (${operation.id},${resourceId},${value.revision},
            ${value.state === "eligible" ? "pending" : "conflict"},
            ${value.state === "conflict" ? "ROW_NOT_APPROVABLE" : null})`;
        }
        await tx`update nar_import_batches set status = 'applying',updated_at = now()
          where id = ${batch.id}`;
        return operation.id;
      });
      await updateOperationState(id);
      return loadView(id);
    },
    async get(actor: AuthenticatedActor, id: string): Promise<BulkOperationView> {
      const current = await currentActor(sql, actor.authUserId);
      assertSameActor(current, actor);
      const view = await loadView(id);
      if (current.role !== "Admin" && view.createdBy !== current.userId)
        throw new Error("Forbidden: operation belongs to another actor.");
      return view;
    },
    async cancel(actor: AuthenticatedActor, id: string): Promise<void> {
      const current = await currentActor(sql, actor.authUserId);
      assertSameActor(current, actor);
      await transaction(sql, async (tx) => {
        const [operation] = await tx<
          OperationRow[]
        >`select * from bulk_operations where id = ${id} for update`;
        if (!operation) throw new Error("Bulk operation not found.");
        if (current.role !== "Admin" && operation.created_by_id !== current.userId)
          throw new Error("Forbidden: operation belongs to another actor.");
        if (operation.state === "cancelled") return;
        if (operation.state === "completed" || operation.state === "completed-with-errors")
          throw new Error("A completed operation cannot be cancelled.");
        await tx`update bulk_operations set state = 'cancelled',updated_at = now() where id = ${id}`;
        await tx`update bulk_operation_items set state = 'cancelled',updated_at = now()
          where operation_id = ${id} and state in ('pending','failed')`;
        if (operation.action === "importApply") {
          await tx`update nar_import_batches b set status = 'failed',updated_at = now()
            from nar_import_approvals a,bulk_previews p
            where p.id = ${operation.preview_id}
              and a.id = (p.parameters->>'approvalId')::uuid and b.id = a.batch_id
              and b.revision = a.batch_revision and b.status = 'applying'`;
        }
      });
    },
    async listDueOperationIds(limit = 5): Promise<string[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error("Operation limit must be 1 to 20.");
      const rows = await sql<{ id: string }[]>`
        select o.id from bulk_operations o
        where o.state in ('queued','running') and exists (
          select 1 from bulk_operation_items i where i.operation_id = o.id
            and (i.state = 'pending' or (i.state = 'failed' and i.attempt_count < ${MAX_ATTEMPTS})
              or (i.state = 'running' and i.lease_until <= now()))
        ) order by o.created_at,o.id limit ${limit}`;
      return rows.map((row) => row.id);
    },
    async runBatch(
      id: string,
      options: { limit: number; afterDomainWrite?: () => void | Promise<void> },
    ): Promise<BulkOperationView> {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)
        throw new Error("Batch limit must be 1 to 100.");
      const seen: string[] = [];
      for (let index = 0; index < options.limit; index += 1) {
        const claimed = await transaction(sql, async (tx) => {
          const [operation] = await tx<
            OperationRow[]
          >`select * from bulk_operations where id = ${id} for update`;
          if (
            !operation ||
            operation.state === "cancelled" ||
            operation.state === "completed" ||
            operation.state === "completed-with-errors"
          )
            return null;
          const [item] = await tx<ItemRow[]>`
            select * from bulk_operation_items where operation_id = ${id}
              and not (id = any(${seen}::uuid[]))
              and (state = 'pending' or (state = 'failed' and attempt_count < ${MAX_ATTEMPTS})
                or (state = 'running' and lease_until <= now()))
            order by case when state = 'pending' then 0 when state = 'failed' then 1 else 2 end,resource_id
            for update skip locked limit 1`;
          if (!item) return null;
          const token = crypto.randomUUID();
          const [updated] = await tx<ItemRow[]>`update bulk_operation_items set state = 'running',
            lease_token = ${token},lease_until = ${new Date(Date.now() + RETRY_LEASE_MS).toISOString()},
            attempt_count = attempt_count + 1,updated_at = now() where id = ${item.id} returning *`;
          await tx`insert into bulk_operation_attempts (item_id,attempt_number,state)
            values (${item.id},${updated.attempt_count},'claimed')`;
          await tx`update bulk_operations set state = 'running',updated_at = now() where id = ${id}`;
          return { operation, item: updated, token };
        });
        if (!claimed) break;
        seen.push(claimed.item.id);
        try {
          await transaction(sql, async (tx) => {
            // Serialize a running domain write with cancellation. Once cancel returns,
            // no claimed item may still apply a case or assignment.
            const [live] = await tx<{ state: BulkOperation["state"] }[]>`
              select state from bulk_operations where id = ${id} for share`;
            if (!live || live.state === "cancelled") {
              await tx`update bulk_operation_items set state = 'cancelled',reason_code = 'OPERATION_CANCELLED',
                lease_token = null,lease_until = null,updated_at = now()
                where id = ${claimed.item.id} and lease_token = ${claimed.token} and state = 'running'`;
              await tx`update bulk_operation_attempts set state = 'failed',
                reason_code = 'OPERATION_CANCELLED',finished_at = now()
                where item_id = ${claimed.item.id} and attempt_number = ${claimed.item.attempt_count}`;
              return;
            }
            const [preview] = await tx<PreviewRow[]>`select p.* from bulk_previews p
              join bulk_operations o on o.preview_id = p.id where o.id = ${id}`;
            if (!preview) throw new BulkItemFailure("conflict", "PREVIEW_MISSING");
            let actor: AuthenticatedActor;
            try {
              actor = await currentActor(tx, claimed.operation.auth_user_id);
            } catch (error) {
              if (!(error instanceof Error) || !error.message.startsWith("Forbidden:")) throw error;
              throw new BulkItemFailure("forbidden", "ACTOR_INACTIVE");
            }
            if (
              preview.scope_role !== actor.role ||
              preview.scope_team_id !== actor.teamId ||
              preview.created_by_id !== actor.userId
            )
              throw new BulkItemFailure("forbidden", "SCOPE_CHANGED");
            if (claimed.operation.action === "importApply") {
              if (actor.role !== "Admin" || preview.action !== "importApply")
                throw new BulkItemFailure("forbidden", "ADMIN_REQUIRED");
              const approvalId = (preview.parameters as { approvalId?: string }).approvalId;
              if (!approvalId) throw new BulkItemFailure("conflict", "APPROVAL_MISSING");
              const imported = await createNarImportApplyRepository({ sql: tx }).applyRow(
                tx,
                actor,
                {
                  approvalId,
                  rowId: claimed.item.resource_id,
                  expectedRevision: claimed.item.revision_before,
                },
              );
              await options.afterDomainWrite?.();
              const [saved] = await tx<{ id: string }[]>`
                update bulk_operation_items set state = ${imported.state},
                  revision_after = ${imported.revisionAfter},audit_ref = ${imported.auditRef},
                  reason_code = ${imported.reasonCode},lease_token = null,lease_until = null,
                  updated_at = now() where id = ${claimed.item.id}
                  and lease_token = ${claimed.token} and state = 'running' returning id`;
              if (!saved) throw new Error("Bulk item lease changed during import commit.");
              await tx`update bulk_operation_attempts set state = 'succeeded',finished_at = now()
                where item_id = ${claimed.item.id} and attempt_number = ${claimed.item.attempt_count}`;
              return;
            }
            if (preview.action === "caseAssign") {
              if (claimed.operation.action !== "caseAssign")
                throw new BulkItemFailure("conflict", "ACTION_MISMATCH");
              const parameters = preview.parameters as { ownerId?: string };
              if (!parameters.ownerId) throw new BulkItemFailure("conflict", "TARGET_MISSING");
              let assigned: { caseId: string; revision: number };
              try {
                assigned = await applyOneCaseOwnerAssignmentForActor(
                  actor,
                  {
                    caseId: claimed.item.resource_id,
                    ownerId: parameters.ownerId,
                    expectedAssignmentRevision: claimed.item.revision_before,
                  },
                  { sql: tx },
                );
              } catch (error) {
                if (!(error instanceof Error)) throw error;
                if (/revision changed/i.test(error.message))
                  throw new BulkItemFailure("conflict", "REVISION_CHANGED");
                if (/locked|completed/i.test(error.message))
                  throw new BulkItemFailure("conflict", "CASE_LOCKED");
                if (/inactive|unprovisioned/i.test(error.message))
                  throw new BulkItemFailure("conflict", "TARGET_UNAVAILABLE");
                if (/forbidden|team/i.test(error.message))
                  throw new BulkItemFailure("forbidden", "ITEM_OUT_OF_SCOPE");
                throw error;
              }
              await options.afterDomainWrite?.();
              const [audit] = await tx<{ id: string }[]>`
                select id from timeline_events where case_id = ${assigned.caseId}
                  and event_type = 'annual_return_owner_assigned'
                  and actor_id = ${actor.userId}
                  and metadata->>'ownerId' = ${parameters.ownerId}
                order by created_at desc,id desc limit 1`;
              if (!audit) throw new Error("Case owner audit event is missing.");
              const [saved] = await tx<{ id: string }[]>`
                update bulk_operation_items set state = 'succeeded',
                  revision_after = ${assigned.revision},audit_ref = ${audit.id},
                  lease_token = null,lease_until = null,updated_at = now()
                where id = ${claimed.item.id} and lease_token = ${claimed.token}
                  and state = 'running' returning id`;
              if (!saved) throw new Error("Bulk item lease changed during case commit.");
              await tx`update bulk_operation_attempts set state = 'succeeded',finished_at = now()
                where item_id = ${claimed.item.id}
                  and attempt_number = ${claimed.item.attempt_count}`;
              return;
            }
            if (preview.action !== "assign" || claimed.operation.action !== "assign")
              throw new BulkItemFailure("conflict", "ACTION_MISMATCH");
            const assignment = preview.parameters as WorkAssignInput["parameters"];
            const work = createWorkItemRepository({ sql: tx });
            const current = await work.get(claimed.item.resource_id);
            if (!current) throw new BulkItemFailure("conflict", "RESOURCE_MISSING");
            try {
              assertActorCanAssignWorkItem(actor, current);
            } catch {
              throw new BulkItemFailure("forbidden", "ITEM_OUT_OF_SCOPE");
            }
            if (current.version !== claimed.item.revision_before)
              throw new BulkItemFailure("conflict", "REVISION_CHANGED");
            const alreadyAssigned =
              (assignment.assignmentTarget === "owner" ? current.ownerId : current.reviewerId) ===
              assignment.assigneeId;
            if (alreadyAssigned) {
              const rows = await tx<
                { id: string }[]
              >`update bulk_operation_items set state = 'skipped',
                reason_code = 'ALREADY_ASSIGNED',lease_token = null,lease_until = null,updated_at = now()
                where id = ${claimed.item.id} and lease_token = ${claimed.token} and state = 'running' returning id`;
              if (!rows[0]) throw new Error("Bulk item lease changed during commit.");
              await tx`update bulk_operation_attempts set state = 'succeeded',finished_at = now()
                where item_id = ${claimed.item.id} and attempt_number = ${claimed.item.attempt_count}`;
              return;
            }
            const assigned = await assignWorkItemForActor(work, actor, {
              workItemId: current.id,
              assigneeId: assignment.assigneeId,
              expectedVersion: claimed.item.revision_before,
              assignmentTarget: assignment.assignmentTarget,
              overrideReason: assignment.overrideReason,
            });
            await options.afterDomainWrite?.();
            const [audit] = await tx<{ id: string }[]>`
              select id from assignment_events where work_item_id = ${current.id}
                and expected_version = ${claimed.item.revision_before}
                and assigned_by_id = ${actor.userId} order by created_at desc limit 1`;
            if (!audit) throw new Error("Assignment audit event is missing.");
            const rows = await tx<
              { id: string }[]
            >`update bulk_operation_items set state = 'succeeded',
              revision_after = ${assigned.version},audit_ref = ${audit.id},
              lease_token = null,lease_until = null,updated_at = now()
              where id = ${claimed.item.id} and lease_token = ${claimed.token} and state = 'running' returning id`;
            if (!rows[0]) throw new Error("Bulk item lease changed during commit.");
            await tx`update bulk_operation_attempts set state = 'succeeded',finished_at = now()
              where item_id = ${claimed.item.id} and attempt_number = ${claimed.item.attempt_count}`;
          });
        } catch (error) {
          const staleDomainWrite =
            error instanceof Error && /assignment is stale/i.test(error.message);
          const state =
            error instanceof ImportApplyError
              ? error.state
              : error instanceof BulkItemFailure
                ? error.state
                : staleDomainWrite
                  ? "conflict"
                  : "failed";
          const reasonCode =
            error instanceof ImportApplyError
              ? error.reasonCode
              : error instanceof BulkItemFailure
                ? error.reasonCode
                : staleDomainWrite
                  ? "REVISION_CHANGED"
                  : "DOMAIN_WRITE_FAILED";
          await transaction(sql, async (tx) => {
            await tx`update bulk_operation_items set state = ${state},reason_code = ${reasonCode},
              lease_token = null,lease_until = null,updated_at = now()
              where id = ${claimed.item.id} and lease_token = ${claimed.token} and state = 'running'`;
            await tx`update bulk_operation_attempts set state = ${state},reason_code = ${reasonCode},
              finished_at = now() where item_id = ${claimed.item.id}
                and attempt_number = ${claimed.item.attempt_count} and state = 'claimed'`;
          });
        }
      }
      await updateOperationState(id);
      return loadView(id);
    },
    async close(): Promise<void> {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
