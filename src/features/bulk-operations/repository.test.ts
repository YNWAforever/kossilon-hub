import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createBulkOperationRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 3 }) : null;

type Fixture = {
  manager: AuthenticatedActor;
  admin: AuthenticatedActor;
  assigneeId: string;
  ids: string[];
  cleanup: () => Promise<void>;
};
async function fixture(): Promise<Fixture> {
  if (!sql) throw new Error("TEST_DATABASE_URL is required");
  const [manager] = await sql<{ auth_user_id: string; user_id: string; team_id: string }[]>`
    select sp.auth_user_id, sp.user_id, sp.team_id from staff_profiles sp
    join users u on u.id = sp.user_id and u.active
    where sp.role = 'Manager' and sp.active and sp.team_id = '10000000-0000-0000-0000-000000000001'
    limit 1`;
  const [admin] = await sql<{ auth_user_id: string; user_id: string; team_id: string }[]>`
    select sp.auth_user_id, sp.user_id, sp.team_id from staff_profiles sp
    join users u on u.id = sp.user_id and u.active
    where sp.role = 'Admin' and sp.active limit 1`;
  const [staff] = await sql<{ user_id: string }[]>`
    select sp.user_id from staff_profiles sp join users u on u.id = sp.user_id and u.active
    where sp.role = 'Staff' and sp.active and sp.team_id = ${manager.team_id} limit 1`;
  const [source] = await sql<{ id: string }[]>`
    select id from work_items where team_id = ${manager.team_id} limit 1`;
  const ids: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    await sql`
      insert into work_items (
        id, company_id, case_type, annual_return_case_id, corporate_change_request_id,
        source_event_key, source_event_type, work_type, required_skill_key, title,
        status, team_id, sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
      ) select ${id}, company_id, case_type, annual_return_case_id, corporate_change_request_id,
        ${`bulk-test:${token}`}, source_event_type, work_type, required_skill_key,
        ${`Bulk test ${index}`}, 'open', team_id, sla_policy_version_id,
        sla_started_at, sla_warning_at, sla_due_at
      from work_items where id = ${source.id}`;
    ids.push(id);
  }
  return {
    manager: {
      authUserId: manager.auth_user_id,
      userId: manager.user_id,
      role: "Manager",
      teamId: manager.team_id,
      active: true,
    },
    admin: {
      authUserId: admin.auth_user_id,
      userId: admin.user_id,
      role: "Admin",
      teamId: admin.team_id,
      active: true,
    },
    assigneeId: staff.user_id,
    ids,
    cleanup: async () => {
      await sql`delete from bulk_operations where created_by_id in (${manager.user_id}, ${admin.user_id}) and preview_id in (select id from bulk_previews where resource_snapshot ? ${ids[0]})`;
      await sql`delete from bulk_previews where resource_snapshot ? ${ids[0]}`;
      await sql`delete from assignment_events where work_item_id in (${ids[0]}, ${ids[1]})`;
      await sql`delete from timeline_events where metadata->>'workItemId' in (${ids[0]}, ${ids[1]})`;
      await sql`delete from work_items where id in (${ids[0]}, ${ids[1]})`;
    },
  };
}

const assignment = (ids: string[], assigneeId: string) => ({
  action: "assign" as const,
  selection: { kind: "ids" as const, ids },
  parameters: {
    assigneeId,
    assignmentTarget: "owner" as const,
    overrideReason: "Approved bulk assignment test",
  },
});

describe.skipIf(!databaseUrl)("T09 durable bulk operations", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it("t09_scenario_1 rejects a stale second actor instead of overwriting", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    try {
      const preview = await repo.preview(fx.manager, assignment([fx.ids[0]], fx.assigneeId));
      const competingPreview = await repo.preview(
        fx.manager,
        assignment([fx.ids[0]], fx.assigneeId),
      );
      const operation = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const { createWorkItemRepository } = await import("@/features/work-items/repository");
      const { assignWorkItemForActor } = await import("@/features/work-items/server-fns");
      const work = createWorkItemRepository({ sql });
      await assignWorkItemForActor(work, fx.admin, {
        workItemId: fx.ids[0],
        assigneeId: fx.assigneeId,
        expectedVersion: 1,
        assignmentTarget: "owner",
        overrideReason: "Concurrent actor",
      });
      await expect(
        repo.commit(fx.manager, {
          previewId: competingPreview.id,
          previewHash: competingPreview.previewHash,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/stale/i);
      await repo.runBatch(operation.id, { limit: 1 });
      const view = await repo.get(fx.manager, operation.id);
      expect(view.items[0].state).toBe("conflict");
      const [current] = await sql<
        { version: number }[]
      >`select version from work_items where id = ${fx.ids[0]}`;
      expect(current.version).toBe(2);
    } finally {
      await fx.cleanup();
      await repo.close();
    }
  });

  it("t09_scenario_2 resumes after a post-business-write crash without duplicate audit", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    try {
      const preview = await repo.preview(fx.manager, assignment(fx.ids, fx.assigneeId));
      const operation = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const replay = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(replay.id).toBe(operation.id);
      let injected = false;
      await repo.runBatch(operation.id, {
        limit: 2,
        afterDomainWrite: () => {
          if (!injected) {
            injected = true;
            throw new Error("simulated crash after business write");
          }
        },
      });
      let view = await repo.get(fx.manager, operation.id);
      expect(view.items.map((item) => item.state).sort()).toEqual(["failed", "succeeded"]);
      await repo.runBatch(operation.id, { limit: 2 });
      view = await repo.get(fx.manager, operation.id);
      expect(view.items.every((item) => item.state === "succeeded")).toBe(true);
      expect(view.items.every((item) => Boolean(item.auditRef))).toBe(true);
      const [audit] = await sql<{ count: number }[]>`
        select count(*)::int count from assignment_events where work_item_id in (${fx.ids[0]}, ${fx.ids[1]})`;
      expect(audit.count).toBe(2);
    } finally {
      await fx.cleanup();
      await repo.close();
    }
  });

  it("t09_scenario_3 rechecks disabled scope and freezes an all-matching selection", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    const originalTeam = fx.manager.teamId;
    const laterId = crypto.randomUUID();
    try {
      const preview = await repo.preview(fx.manager, {
        ...assignment(fx.ids, fx.assigneeId),
        selection: {
          kind: "filter",
          resource: "work-items",
          filters: { teamId: fx.manager.teamId! },
          excludedIds: [],
        },
      });
      expect(preview.selectionCount).toBeGreaterThanOrEqual(2);
      await sql`
        insert into work_items (
          id, company_id, case_type, annual_return_case_id, corporate_change_request_id,
          source_event_key, source_event_type, work_type, required_skill_key, title,
          status, team_id, sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
        ) select ${laterId}, company_id, case_type, annual_return_case_id, corporate_change_request_id,
          ${`bulk-test:${crypto.randomUUID()}`}, source_event_type, work_type, required_skill_key,
          'Added after preview', 'open', team_id, sla_policy_version_id,
          sla_started_at, sla_warning_at, sla_due_at
        from work_items where id = ${fx.ids[0]}`;
      await sql`update staff_profiles set active = false where auth_user_id = ${fx.manager.authUserId}`;
      await expect(
        repo.commit(fx.manager, {
          previewId: preview.id,
          previewHash: preview.previewHash,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/forbidden/i);
      await sql`update staff_profiles set active = true where auth_user_id = ${fx.manager.authUserId}`;
      const operation = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      await sql`update staff_profiles set team_id = '10000000-0000-0000-0000-000000000002' where auth_user_id = ${fx.manager.authUserId}`;
      await repo.runBatch(operation.id, { limit: 100 });
      const view = await repo.get(fx.admin, operation.id);
      expect(
        view.items
          .filter((item) => fx.ids.includes(item.resourceId))
          .every((item) => item.state === "forbidden"),
      ).toBe(true);
      expect(view.items.length).toBe(preview.selectionCount);
      expect(view.items.map((item) => item.resourceId)).not.toContain(laterId);
    } finally {
      await sql`update staff_profiles set active = true, team_id = ${originalTeam} where auth_user_id = ${fx.manager.authUserId}`;
      await sql`delete from work_items where id = ${laterId}`;
      await fx.cleanup();
      await repo.close();
    }
  });
  it("keeps started items intact on cancel and drains only a bounded batch", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    try {
      const preview = await repo.preview(fx.manager, assignment(fx.ids, fx.assigneeId));
      const operation = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const { runDueBulkOperations } = await import("./runner");
      const first = await runDueBulkOperations({
        repository: repo,
        maxOperations: 1,
        maxItemsPerOperation: 1,
      });
      expect(first.operations).toBe(1);
      let view = await repo.get(fx.manager, operation.id);
      expect(view.counts.succeeded).toBe(1);
      expect(view.counts.pending).toBe(1);
      const [pending] = view.items.filter((item) => item.state === "pending");
      await sql`update bulk_operation_items set state = 'running', lease_token = gen_random_uuid(),
        lease_until = now() + interval '15 minutes' where id = ${pending.itemId}`;
      await repo.cancel(fx.manager, operation.id);
      view = await repo.get(fx.manager, operation.id);
      expect(view.state).toBe("cancelled");
      expect(view.items.find((item) => item.itemId === pending.itemId)?.state).toBe("running");
      expect(await repo.listDueOperationIds(5)).not.toContain(operation.id);
    } finally {
      await fx.cleanup();
      await repo.close();
    }
  });
  it("reads and exports durable progress for 1000 items", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    try {
      const snapshot = {
        [fx.ids[0]]: {
          revision: 1,
          state: "eligible",
          teamId: fx.manager.teamId,
          status: "open",
          ownerId: null,
          reviewerId: null,
        },
      };
      const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
      const [preview] = await sql<{ id: string }[]>`
        insert into bulk_previews (
          action, created_by_id, auth_user_id, scope_role, scope_team_id,
          parameters, selection, resource_snapshot, preview_hash, selection_count,
          eligible_count, skipped_count, conflict_count, expires_at
        ) values ('assign', ${fx.manager.userId}, ${fx.manager.authUserId}, 'Manager',
          ${fx.manager.teamId}, ${sql.json({ assigneeId: fx.assigneeId, assignmentTarget: "owner" })},
          ${sql.json({ kind: "ids", ids: [fx.ids[0]] })}, ${sql.json(snapshot)},
          ${hash}, 1, 1, 0, 0, now() + interval '15 minutes') returning id`;
      const [operation] = await sql<{ id: string }[]>`
        insert into bulk_operations (
          preview_id, action, created_by_id, auth_user_id, idempotency_key, logical_key, state
        ) values (${preview.id}, 'assign', ${fx.manager.userId}, ${fx.manager.authUserId},
          ${crypto.randomUUID()}, ${hash}, 'running') returning id`;
      await sql`insert into bulk_operation_items (operation_id, resource_id, revision_before, state)
        select ${operation.id}, gen_random_uuid(), 1,
          case when n <= 100 then 'pending' else 'succeeded' end
        from generate_series(1, 1000) n`;
      const view = await repo.get(fx.manager, operation.id);
      expect(view.items).toHaveLength(1000);
      expect(view.counts.pending).toBe(100);
      expect(view.counts.succeeded).toBe(900);
      const { bulkOperationCsv } = await import("./server-fns");
      expect(bulkOperationCsv(view).trimEnd().split("\r\n")).toHaveLength(1001);
    } finally {
      await fx.cleanup();
      await repo.close();
    }
  });
});
