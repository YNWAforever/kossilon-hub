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

  it("t22 queue all-matching preview stores a server-owned filter and excludes one displayed row", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    const laterId = crypto.randomUUID();
    try {
      const preview = await repo.preview(fx.manager, {
        ...assignment(fx.ids, fx.assigneeId),
        selection: {
          kind: "filter",
          resource: "work-items",
          filters: {
            view: "team",
            owner: "all",
            workType: "all",
            sla: "all",
            priority: "all",
            status: "all",
            q: "Bulk test",
          },
          excludedIds: [fx.ids[1]],
        },
      });
      expect(preview.itemsPreview.some((item) => item.resourceId === fx.ids[0])).toBe(true);
      expect(preview.itemsPreview.some((item) => item.resourceId === fx.ids[1])).toBe(false);
      const [saved] = await sql<{ selection: { kind: string; filters: { view: string } } }[]>`
        select selection from bulk_previews where id = ${preview.id}`;
      expect(saved.selection.kind).toBe("filter");
      expect(saved.selection.filters.view).toBe("team");
      await sql`
        insert into work_items (
          id, company_id, case_type, annual_return_case_id, corporate_change_request_id,
          source_event_key, source_event_type, work_type, required_skill_key, title,
          status, team_id, sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at
        ) select ${laterId}, company_id, case_type, annual_return_case_id, corporate_change_request_id,
          ${`bulk-test:${crypto.randomUUID()}`}, source_event_type, work_type, required_skill_key,
          'Bulk test added after preview', 'open', team_id, sla_policy_version_id,
          sla_started_at, sla_warning_at, sla_due_at
        from work_items where id = ${fx.ids[0]}`;
      const operation = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      const view = await repo.get(fx.manager, operation.id);
      expect(view.items.some((item) => item.resourceId === laterId)).toBe(false);
    } finally {
      await sql`delete from work_items where id = ${laterId}`;
      await fx.cleanup();
      await repo.close();
    }
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
  it("does not approve importApply previews through the generic assignment commit", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    const hash = "a".repeat(64);
    let previewId: string | null = null;
    try {
      const [preview] = await sql<{ id: string }[]>`
        insert into bulk_previews (
          action,created_by_id,auth_user_id,scope_role,scope_team_id,
          parameters,selection,resource_snapshot,preview_hash,selection_count,
          eligible_count,skipped_count,conflict_count,expires_at
        ) values (
          'importApply',${fx.manager.userId},${fx.manager.authUserId},'Manager',
          ${fx.manager.teamId},${sql.json({ approvalId: crypto.randomUUID() })},
          ${sql.json({ kind: "ids", ids: [fx.ids[0]] })},
          ${sql.json({
            [fx.ids[0]]: {
              revision: 1,
              state: "eligible",
              teamId: fx.manager.teamId,
              status: "open",
              ownerId: null,
              reviewerId: null,
            },
          })},
          ${hash},1,1,0,0,now()+interval '15 minutes'
        ) returning id`;
      previewId = preview.id;
      await expect(
        repo.commit(fx.manager, {
          previewId,
          previewHash: hash,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/unsupported|import/i);
    } finally {
      if (previewId) {
        await sql`delete from bulk_operations where preview_id=${previewId}`;
        await sql`delete from bulk_previews where id=${previewId}`;
      }
      await fx.cleanup();
      await repo.close();
    }
  });

  it("t22_scenario_2 durably applies only eligible case owners and resumes without duplicate linked audits", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const repo = createBulkOperationRepository({ sql });
    const caseIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const companyIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const teamB = "10000000-0000-0000-0000-000000000002";
    try {
      for (const [index, caseId] of caseIds.entries()) {
        const companyId = companyIds[index]!;
        const teamId = index === 1 ? teamB : fx.manager.teamId!;
        await sql`insert into companies(id,company_name,cr_number,br_number,
          incorporation_date,annual_return_basis_date,registered_office,
          company_secretary,assigned_owner_id,assigned_team_id,data_origin)
          values (${companyId},${`T22 durable ${caseIds[0]} ${caseId}`},${`CR-${companyId}`},
            ${`BR-${companyId}`},'2020-01-01','2026-01-01','Test address',
            'Test secretary',${fx.manager.userId},${teamId},'fixture')`;
        await sql`insert into annual_return_cases(id,company_id,return_year,made_up_date,
          filing_due_date,current_status,owner_id,locked_at)
          values (${caseId},${companyId},2026,'2026-01-01','2026-02-11',
            'Upcoming',${fx.manager.userId},
            ${index === 2 ? new Date().toISOString() : null})`;
      }
      await sql`update work_items set company_id=${companyIds[0]},
        annual_return_case_id=${caseIds[0]},owner_id=${fx.manager.userId}
        where id=${fx.ids[0]}`;
      const filtered = await repo.preview(fx.manager, {
        action: "caseAssign",
        selection: {
          kind: "filter",
          resource: "annual-return-cases",
          filters: { q: `T22 durable ${caseIds[0]}`, status: "Upcoming" },
          excludedIds: [caseIds[3]!],
        },
        parameters: { ownerId: fx.assigneeId },
      });
      expect(filtered.selectionCount).toBe(2);
      expect(filtered.itemsPreview.map((item) => item.resourceId).sort()).toEqual(
        [caseIds[0], caseIds[2]].sort(),
      );
      expect(filtered.itemsPreview[0]).toMatchObject({
        oldOwnerId: fx.manager.userId,
        oldTeamId: fx.manager.teamId,
        newOwnerId: fx.assigneeId,
        newTeamId: fx.manager.teamId,
      });
      const input = {
        action: "caseAssign" as const,
        selection: { kind: "ids" as const, ids: caseIds.slice(0, 3) },
        parameters: { ownerId: fx.assigneeId },
      };
      const preview = await repo.preview(fx.manager, input);
      expect(preview).toMatchObject({
        selectionCount: 3,
        eligibleCount: 1,
        conflictCount: 2,
      });
      const decisions = new Map(preview.itemsPreview.map((item) => [item.resourceId, item]));
      expect(decisions.get(caseIds[0]!)).toMatchObject({ state: "eligible", reasonCode: null });
      expect(decisions.get(caseIds[1]!)).toMatchObject({
        state: "forbidden",
        reasonCode: "CASE_OUT_OF_SCOPE",
        revision: null,
        oldOwnerId: null,
        oldTeamId: null,
      });
      expect(decisions.get(caseIds[2]!)).toMatchObject({
        state: "conflict",
        reasonCode: "CASE_LOCKED",
      });
      const key = crypto.randomUUID();
      const operation = await repo.commit(fx.manager, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: key,
      });
      expect(
        (
          await repo.commit(fx.manager, {
            previewId: preview.id,
            previewHash: preview.previewHash,
            idempotencyKey: key,
          })
        ).id,
      ).toBe(operation.id);
      await repo.runBatch(operation.id, { limit: 3 });
      const view = await repo.get(fx.manager, operation.id);
      expect(view.counts).toMatchObject({ succeeded: 1, forbidden: 1, conflict: 1 });
      expect(view.items.find((item) => item.resourceId === caseIds[0])).toMatchObject({
        state: "succeeded",
        revisionBefore: 1,
        revisionAfter: 2,
      });
      expect(view.items.find((item) => item.resourceId === caseIds[0])?.auditRef).toBeTruthy();
      expect(view.items.find((item) => item.resourceId === caseIds[1])).toMatchObject({
        state: "forbidden",
        reasonCode: "CASE_OUT_OF_SCOPE",
        revisionBefore: null,
      });
      const [owner] = await sql<{ owner_id: string; assignment_revision: number }[]>`
        select owner_id,assignment_revision from annual_return_cases where id=${caseIds[0]}`;
      expect(owner).toMatchObject({ owner_id: fx.assigneeId, assignment_revision: 2 });
      const [linked] = await sql<{ owner_id: string; version: number }[]>`
        select owner_id,version from work_items where id=${fx.ids[0]}`;
      expect(linked).toMatchObject({ owner_id: fx.assigneeId, version: 2 });
      const [linkedAudit] = await sql<{ count: number }[]>`
        select count(*)::int count from assignment_events where work_item_id=${fx.ids[0]}`;
      expect(linkedAudit.count).toBe(1);
      for (const caseId of caseIds.slice(1, 3)) {
        const [untouched] = await sql<{ owner_id: string; assignment_revision: number }[]>`
          select owner_id,assignment_revision from annual_return_cases where id=${caseId}`;
        expect(untouched).toMatchObject({ owner_id: fx.manager.userId, assignment_revision: 1 });
      }

      const crashPreview = await repo.preview(fx.manager, {
        action: "caseAssign",
        selection: { kind: "ids", ids: [caseIds[3]!] },
        parameters: { ownerId: fx.assigneeId },
      });
      const crashOperation = await repo.commit(fx.manager, {
        previewId: crashPreview.id,
        previewHash: crashPreview.previewHash,
        idempotencyKey: crypto.randomUUID(),
      });
      await repo.runBatch(crashOperation.id, {
        limit: 1,
        afterDomainWrite: () => {
          throw new Error("simulated crash after case owner write");
        },
      });
      expect((await repo.get(fx.manager, crashOperation.id)).items[0]?.state).toBe("failed");
      await repo.runBatch(crashOperation.id, { limit: 1 });
      const resumed = await repo.get(fx.manager, crashOperation.id);
      expect(resumed.items[0]).toMatchObject({ state: "succeeded", revisionAfter: 2 });
      const [audit] = await sql<{ count: number }[]>`
        select count(*)::int count from timeline_events
        where case_id=${caseIds[3]} and event_type='annual_return_owner_assigned'`;
      expect(audit.count).toBe(1);
    } finally {
      await sql`delete from bulk_operations where preview_id in (
        select id from bulk_previews where resource_snapshot ?| ${caseIds})`;
      await sql`delete from bulk_previews where resource_snapshot ?| ${caseIds}`;
      await sql`delete from annual_return_audit_events where case_id=any(${caseIds}::uuid[])`;
      await sql`delete from timeline_events where case_id=any(${caseIds}::uuid[])`;
      await fx.cleanup();
      await sql`delete from annual_return_cases where id=any(${caseIds}::uuid[])`;
      await sql`delete from companies where id=any(${companyIds}::uuid[])`;
      await repo.close();
    }
  }, 60_000);

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
