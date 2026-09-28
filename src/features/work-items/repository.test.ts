import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import {
  assignmentDecisionFor,
  createWorkItemRepository,
  ensureWorkItemForEvent,
  escalationTransitionsFor,
  sortWorkItemQueue,
  type PersistedWorkItem,
} from "./repository";

function item(id: string, input: Partial<PersistedWorkItem> = {}): PersistedWorkItem {
  return {
    id,
    companyId: "company-1",
    companyName: "Acme Company Limited",
    ownerName: null,
    caseType: "annual_return",
    annualReturnCaseId: "case-1",
    corporateChangeRequestId: null,
    sourceEventKey: `event:${id}`,
    sourceEventType: "status_changed",
    workType: "annual_return_status",
    requiredSkillKey: "annual_returns",
    title: id,
    status: "open",
    escalationState: "none",
    priority: 50,
    ownerId: null,
    reviewerId: null,
    teamId: "team-1",
    slaPolicyVersionId: "policy-1",
    slaStartedAt: "2026-07-01T01:00:00.000Z",
    slaWarningAt: "2026-07-01T02:00:00.000Z",
    slaDueAt: "2026-07-01T03:00:00.000Z",
    slaBreachedAt: null,
    version: 1,
    completedAt: null,
    ...input,
  };
}

describe("work-item repository contracts", () => {
  it("sorts breached work first, then due time, priority, and ID", () => {
    const sorted = sortWorkItemQueue([
      item("d", { slaDueAt: "2026-07-01T02:00:00.000Z", priority: 90 }),
      item("c", {
        slaDueAt: "2026-07-01T04:00:00.000Z",
        slaBreachedAt: "2026-07-01T04:01:00.000Z",
      }),
      item("b", { slaDueAt: "2026-07-01T02:00:00.000Z", priority: 90 }),
      item("a", {
        slaDueAt: "2026-07-01T03:00:00.000Z",
        slaBreachedAt: "2026-07-01T03:01:00.000Z",
      }),
    ]);

    expect(sorted.map(({ id }) => id)).toEqual(["a", "c", "b", "d"]);
  });

  it("t05_no_policy keeps unconfigured work visible without an SLA escalation", () => {
    const unconfigured = item("unconfigured", {
      slaPolicyVersionId: null,
      slaStartedAt: null,
      slaWarningAt: null,
      slaDueAt: null,
    });
    expect(sortWorkItemQueue([unconfigured, item("configured")]).map(({ id }) => id)).toEqual([
      "configured",
      "unconfigured",
    ]);
    expect(escalationTransitionsFor(unconfigured, "2030-01-01T00:00:00.000Z", [])).toEqual([]);
  });

  it("requires an override reason when a non-top recommendation is chosen", () => {
    expect(() =>
      assignmentDecisionFor({
        selectedUserId: "user-2",
        recommendations: [
          {
            rank: 1,
            staffId: "staff-1",
            userId: "user-1",
            score: 300,
            factors: {
              skillProficiency: 4,
              workloadPoints: 20,
              capacityUtilization: 50,
              continuityBonus: 0,
            },
          },
          {
            rank: 2,
            staffId: "staff-2",
            userId: "user-2",
            score: 250,
            factors: {
              skillProficiency: 4,
              workloadPoints: 30,
              capacityUtilization: 70,
              continuityBonus: 0,
            },
          },
        ],
        overrideReason: " ",
      }),
    ).toThrow("override reason");

    expect(
      assignmentDecisionFor({
        selectedUserId: "user-2",
        recommendations: [
          {
            rank: 1,
            staffId: "staff-1",
            userId: "user-1",
            score: 300,
            factors: {
              skillProficiency: 4,
              workloadPoints: 20,
              capacityUtilization: 50,
              continuityBonus: 0,
            },
          },
          {
            rank: 2,
            staffId: "staff-2",
            userId: "user-2",
            score: 250,
            factors: {
              skillProficiency: 4,
              workloadPoints: 30,
              capacityUtilization: 70,
              continuityBonus: 0,
            },
          },
        ],
        overrideReason: "Continuity with the client",
      }).decision,
    ).toBe("override");

    const overloaded = {
      rank: 1,
      staffId: "staff-overloaded",
      userId: "user-overloaded",
      score: 200,
      factors: {
        skillProficiency: 5,
        workloadPoints: 100,
        capacityUtilization: 100,
        continuityBonus: 0,
      },
    };
    expect(() =>
      assignmentDecisionFor({
        selectedUserId: overloaded.userId,
        recommendations: [overloaded],
      }),
    ).toThrow("overloaded");
    expect(
      assignmentDecisionFor({
        selectedUserId: overloaded.userId,
        recommendations: [overloaded],
        overrideReason: "Temporary capacity exception approved",
      }),
    ).toMatchObject({
      decision: "override",
      overrideReason: "Temporary capacity exception approved",
    });
  });

  it("emits warning and breach once as time advances", () => {
    const workItem = item("item-1");

    expect(escalationTransitionsFor(workItem, "2026-07-01T01:30:00.000Z", [])).toEqual([]);
    expect(escalationTransitionsFor(workItem, "2026-07-01T02:30:00.000Z", [])).toEqual(["warning"]);
    expect(escalationTransitionsFor(workItem, "2026-07-01T04:00:00.000Z", [])).toEqual([
      "warning",
      "breach",
    ]);
    expect(escalationTransitionsFor(workItem, "2026-07-01T04:00:00.000Z", ["warning"])).toEqual([
      "breach",
    ]);
    expect(
      escalationTransitionsFor(workItem, "2026-07-01T04:00:00.000Z", ["warning", "breach"]),
    ).toEqual([]);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("work-item repository integration", () => {
  it("orders the queue, rejects stale assignment, and records escalation thresholds once", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    const rollbackMessage = "rollback work-item repository integration fixture";

    try {
      await expect(
        sql.begin(async (tx) => {
          const fixtures = await tx<
            {
              company_id: string;
              case_id: string;
              team_id: string;
              skill_key: string;
              policy_id: string;
            }[]
          >`
            select arc.company_id, arc.id case_id, sp.team_id, ss.skill_key, p.id policy_id
            from annual_return_cases arc
            cross join staff_profiles sp
            join staff_skills ss on ss.staff_profile_id = sp.id and ss.active = true
            join sla_policies p on p.work_type = 'annual_return_case' and p.active = true
            where sp.active = true and sp.role = 'Staff' and sp.team_id is not null
            order by arc.id, sp.id, p.version desc
            limit 1
          `;
          const fixture = fixtures[0];
          expect(fixture).toBeDefined();
          const token = crypto.randomUUID();
          const warningId = crypto.randomUUID();
          const breachId = crypto.randomUUID();

          await tx`
            insert into work_items (
              id, company_id, case_type, annual_return_case_id, source_event_key,
              source_event_type, work_type, required_skill_key, title, priority, team_id,
              sla_policy_version_id, sla_started_at, sla_warning_at, sla_due_at, sla_breached_at
            ) values
              (${warningId}, ${fixture.company_id}, 'annual_return', ${fixture.case_id},
                ${`test:${token}:warning`}, 'test_event', 'annual_return_case',
                ${fixture.skill_key}, 'Warning fixture', 80, ${fixture.team_id},
                ${fixture.policy_id}, '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z',
                '2026-07-01T03:00:00.000Z', null),
              (${breachId}, ${fixture.company_id}, 'annual_return', ${fixture.case_id},
                ${`test:${token}:breach`}, 'test_event', 'annual_return_case',
                ${fixture.skill_key}, 'Breach fixture', 20, ${fixture.team_id},
                ${fixture.policy_id}, '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z',
                '2026-07-01T05:00:00.000Z', '2026-07-01T01:30:00.000Z')
          `;

          const repository = createWorkItemRepository({ sql: tx });
          await tx`
            insert into maintenance_runs (
              scheduled_for, started_at, finished_at, duration_ms, outcome, passes, trigger_source
            ) values (
              '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z',
              '2099-01-01T00:00:01.000Z', 1000, 'succeeded',
              ${tx.json({ escalations: { warnings: 0, breaches: 0 } })}, 'scheduled'
            ), (
              '2099-01-02T00:00:00.000Z', '2099-01-02T00:00:00.000Z',
              '2099-01-02T00:00:01.000Z', 1000, 'succeeded',
              ${tx.json({ escalations: null })}, 'scheduled'
            ), (
              '2099-01-03T00:00:00.000Z', '2099-01-03T00:00:00.000Z',
              '2099-01-03T00:00:01.000Z', 1000, 'succeeded',
              ${tx.json({ jobs: [{ job: "evaluateEscalations", state: "succeeded" }] })}, 'scheduled'
            ), (
              '2099-01-04T00:00:00.000Z', '2099-01-04T00:00:00.000Z',
              '2099-01-04T00:00:01.000Z', 1000, 'failed',
              ${tx.json({ jobs: [{ job: "evaluateEscalations", state: "failed" }] })}, 'scheduled'
            )
          `;
          expect(await repository.lastSlaEvaluationAt()).toBe("2099-01-03T00:00:01.000Z");
          const queue = await repository.listQueue({ teamId: fixture.team_id });
          expect(
            queue
              .filter((entry) => entry.id === warningId || entry.id === breachId)
              .map((entry) => entry.id),
          ).toEqual([breachId, warningId]);

          const mismatchedTeamId = crypto.randomUUID();
          await expect(
            repository.recommendAssignees(warningId, { expectedTeamId: mismatchedTeamId }),
          ).rejects.toThrow("outside the actor's team");
          await expect(
            repository.assign({
              workItemId: warningId,
              selectedUserId: crypto.randomUUID(),
              assignedById: crypto.randomUUID(),
              expectedVersion: 1,
              expectedTeamId: mismatchedTeamId,
            }),
          ).rejects.toThrow("outside the actor's team");
          await expect(
            repository.acknowledgeEscalation({
              workItemId: warningId,
              actorId: crypto.randomUUID(),
              note: "Reviewed",
              expectedTeamId: mismatchedTeamId,
            }),
          ).rejects.toThrow("outside the actor's team");

          const recommendations = await repository.recommendAssignees(warningId);
          expect(recommendations.length).toBeGreaterThan(0);
          expect(recommendations[0].person?.name).toBeTruthy();
          expect(recommendations[0].person?.teamName).toBeTruthy();
          const assigned = await repository.assign({
            workItemId: warningId,
            selectedUserId: recommendations[0].userId,
            assignedById: recommendations[0].userId,
            expectedVersion: 1,
            overrideReason: "Integration fixture capacity exception",
          });
          expect(assigned.version).toBe(2);
          const assignedQueueItem = (await repository.listQueue({ teamId: fixture.team_id })).find(
            (entry) => entry.id === warningId,
          );
          expect(assignedQueueItem?.ownerPerson?.name).toBe(recommendations[0].person?.name);
          expect(assignedQueueItem?.ownerPerson?.teamName).toBe(
            recommendations[0].person?.teamName,
          );
          const assignmentEvents = await tx<
            {
              recommendation_factors: {
                selected: unknown;
                recommendations: unknown[];
              };
            }[]
          >`
            select recommendation_factors from assignment_events
            where work_item_id = ${warningId}
          `;
          expect(assignmentEvents[0].recommendation_factors.selected).toBeDefined();
          expect(assignmentEvents[0].recommendation_factors.recommendations).toHaveLength(
            recommendations.length,
          );
          await expect(
            repository.assign({
              workItemId: warningId,
              selectedUserId: recommendations[0].userId,
              assignedById: recommendations[0].userId,
              expectedVersion: 1,
            }),
          ).rejects.toThrow("stale");

          await repository.evaluateEscalations("2026-07-01T02:00:00.000Z", 1);
          await repository.evaluateEscalations("2026-07-01T02:00:00.000Z", 1);
          let events = await tx<{ work_item_id: string; threshold: string }[]>`
            select work_item_id, threshold from escalation_events
            where work_item_id in (${warningId}, ${breachId})
            order by work_item_id, threshold
          `;
          expect(events).toHaveLength(3);
          expect(events.map((event) => event.threshold).sort()).toEqual([
            "breach",
            "warning",
            "warning",
          ]);

          await repository.evaluateEscalations("2026-07-01T04:00:00.000Z");
          events = await tx<{ work_item_id: string; threshold: string }[]>`
            select work_item_id, threshold from escalation_events
            where work_item_id in (${warningId}, ${breachId})
            order by work_item_id, threshold
          `;
          expect(events).toHaveLength(4);
          expect(
            events
              .filter((event) => event.work_item_id === warningId)
              .map((event) => event.threshold)
              .sort(),
          ).toEqual(["breach", "warning"]);

          // An SLA breach is an internal alert: it goes to staff by email, never to
          // the client by WhatsApp. These fixtures have no owner_id, so this also
          // pins the fallback to the owning team's manager.
          const [manager] = await tx<{ email: string }[]>`
            select u.email from teams t
            join users u on u.id = t.manager_id
            where t.id = ${fixture.team_id}
          `;
          const notifications = await tx<{ channel: string; recipient: string | null }[]>`
            select channel, recipient from notification_outbox
            where work_item_id in (${warningId}, ${breachId})
          `;
          // Every escalation goes to a staff email. Nothing is addressed to a phone,
          // which is what sending these over WhatsApp would have meant.
          expect(notifications.length).toBeGreaterThan(0);
          expect(notifications.every((row) => row.channel === "email")).toBe(true);
          expect(notifications.every((row) => row.recipient?.includes("@"))).toBe(true);

          // The item is unassigned when it first breaches and assigned later in this
          // test, so both branches of the recipient fallback are exercised here.
          expect(notifications.map((row) => row.recipient)).toContain(manager.email);

          throw new Error(rollbackMessage);
        }),
      ).rejects.toThrow(rollbackMessage);
    } finally {
      await sql.end();
    }
  }, 20_000);
});

describe.skipIf(!databaseUrl)("ensureWorkItemForEvent", () => {
  it("t05_no_policy persists an assignable work item without inventing SLA dates", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    const rollbackMessage = "rollback no-policy work item fixture";
    try {
      await expect(
        sql.begin(async (tx) => {
          const [caseRow] = await tx<
            { id: string; company_id: string; owner_id: string }[]
          >`select id, company_id, owner_id from annual_return_cases limit 1`;
          if (!caseRow) throw new Error("T05 fixture needs a seeded annual return case.");
          const item = await ensureWorkItemForEvent(tx, {
            companyId: caseRow.company_id,
            caseType: "annual_return",
            annualReturnCaseId: caseRow.id,
            sourceEventKey: "t05-unconfigured:" + crypto.randomUUID(),
            sourceEventType: "sla_policy_configuration_required",
            workType: "t05_unconfigured_policy_fixture",
            title: "Configure SLA policy for this work type",
            ownerId: caseRow.owner_id,
          });
          expect(item).toMatchObject({
            status: "open",
            slaPolicyVersionId: null,
            slaStartedAt: null,
            slaWarningAt: null,
            slaDueAt: null,
            slaBreachedAt: null,
          });
          const repository = createWorkItemRepository({ sql: tx });
          expect((await repository.listQueue()).some((queued) => queued.id === item.id)).toBe(true);
          await expect(
            tx.savepoint(
              async (savepoint) =>
                savepoint`insert into work_items
                (company_id, case_type, annual_return_case_id, source_event_key,
                 source_event_type, work_type, title, sla_started_at)
                values (${caseRow.company_id}, 'annual_return', ${caseRow.id},
                  ${"t05-partial:" + crypto.randomUUID()}, 'sla_policy_configuration_required',
                  't05_unconfigured_policy_fixture', 'Invalid partial SLA', now())`,
            ),
          ).rejects.toThrow(/work_items_sla_snapshot_check/);
          expect(
            await tx<{ id: string }[]>`select id from work_items where id=${item.id}`,
          ).toHaveLength(1);
          throw new Error(rollbackMessage);
        }),
      ).rejects.toThrow(rollbackMessage);
    } finally {
      await sql.end();
    }
  }, 20_000);

  it("t05_no_policy assigns a same-team active Staff without creating an SLA deadline", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    const rollbackMessage = "rollback no-policy assignment fixture";
    try {
      await expect(
        sql.begin(async (tx) => {
          const [fixture] = await tx<
            {
              case_id: string;
              company_id: string;
              team_id: string;
              skill_key: string;
              candidate_id: string;
            }[]
          >`
            select arc.id case_id, arc.company_id, c.assigned_team_id team_id,
              ss.skill_key, sp.user_id candidate_id
            from annual_return_cases arc
            join companies c on c.id = arc.company_id
            join staff_profiles sp on sp.team_id = c.assigned_team_id
              and sp.role = 'Staff' and sp.active = true
            join users u on u.id = sp.user_id and u.active = true
            join staff_skills ss on ss.staff_profile_id = sp.id and ss.active = true
            limit 1
          `;
          const [admin] = await tx<{ user_id: string }[]>`
            select sp.user_id from staff_profiles sp
            join users u on u.id = sp.user_id and u.active = true
            where sp.role = 'Admin' and sp.active = true limit 1
          `;
          if (!fixture || !admin)
            throw new Error("T05 fixture needs same-team Staff skill and Admin.");
          const item = await ensureWorkItemForEvent(tx, {
            companyId: fixture.company_id,
            caseType: "annual_return",
            annualReturnCaseId: fixture.case_id,
            sourceEventKey: "t05-assign-unconfigured:" + crypto.randomUUID(),
            sourceEventType: "sla_policy_configuration_required",
            workType: "t05_unconfigured_policy_fixture",
            requiredSkillKey: fixture.skill_key,
            title: "Configure SLA policy for this work type",
            teamId: fixture.team_id,
          });
          const repository = createWorkItemRepository({ sql: tx });
          const recommendations = await repository.recommendAssignees(item.id);
          expect(
            recommendations.some((candidate) => candidate.userId === fixture.candidate_id),
          ).toBe(true);
          const assigned = await repository.assign({
            workItemId: item.id,
            selectedUserId: fixture.candidate_id,
            assignedById: admin.user_id,
            expectedVersion: item.version,
            overrideReason: "Policy setup assignment",
            expectedTeamId: fixture.team_id,
          });
          expect(assigned).toMatchObject({
            ownerId: fixture.candidate_id,
            status: "in_progress",
            slaPolicyVersionId: null,
            slaDueAt: null,
          });
          throw new Error(rollbackMessage);
        }),
      ).rejects.toThrow(rollbackMessage);
    } finally {
      await sql.end();
    }
  }, 30_000);

  it("t05_policy_attach previews without writes and commits one selected policy once", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    const rollbackMessage = "rollback selected-policy attachment fixture";
    try {
      await expect(
        sql.begin(async (tx) => {
          const [fixture] = await tx<
            { case_id: string; company_id: string; admin_id: string; calendar_id: string }[]
          >`
            select arc.id case_id, arc.company_id, sp.user_id admin_id,
              p.business_calendar_id calendar_id
            from annual_return_cases arc
            cross join staff_profiles sp
            cross join sla_policies p
            where sp.role = 'Admin' and sp.active = true and p.active = true
            limit 1
          `;
          if (!fixture) throw new Error("T05 fixture needs case, Admin, and calendar.");
          const workType = `t05_policy_attach_${crypto.randomUUID()}`;
          const item = await ensureWorkItemForEvent(tx, {
            companyId: fixture.company_id,
            caseType: "annual_return",
            annualReturnCaseId: fixture.case_id,
            sourceEventKey: `t05-attach:${crypto.randomUUID()}`,
            sourceEventType: "policy_configuration_required",
            workType,
            title: "Attach selected policy",
          });
          expect(item.slaPolicyVersionId).toBeNull();
          const [policy] = await tx<{ id: string }[]>`
            insert into sla_policies (
              policy_key, version, name, work_type, business_calendar_id,
              warning_minutes, due_minutes, effective_from, active, created_by
            ) values (
              ${workType}, 1, 'T05 selected policy', ${workType}, ${fixture.calendar_id},
              60, 120, '2026-01-01T00:00:00.000Z', true, ${fixture.admin_id}
            ) returning id
          `;
          const repository = createWorkItemRepository({ sql: tx });
          const choices = await repository.listAttachablePolicies({
            workItemId: item.id,
            expectedVersion: item.version,
          });
          expect(choices).toEqual([
            expect.objectContaining({
              id: policy.id,
              name: "T05 selected policy",
              version: 1,
            }),
          ]);
          await expect(
            repository.previewPolicyAttachment({
              workItemId: item.id,
              policyVersionId: crypto.randomUUID(),
              expectedVersion: item.version,
            }),
          ).rejects.toThrow(/policy/i);
          const preview = await repository.previewPolicyAttachment({
            workItemId: item.id,
            policyVersionId: policy.id,
            expectedVersion: item.version,
          });
          expect(preview).toMatchObject({
            workItemId: item.id,
            policyVersionId: policy.id,
            expectedVersion: item.version,
          });
          expect(Date.parse(preview.warningAt)).toBeGreaterThan(Date.parse(preview.startedAt));
          expect(Date.parse(preview.dueAt)).toBeGreaterThan(Date.parse(preview.warningAt));
          expect(await repository.get(item.id)).toMatchObject({
            version: item.version,
            slaPolicyVersionId: null,
          });
          expect(
            await tx<{ work_item_id: string }[]>`
            select work_item_id from work_item_sla_attachments where work_item_id = ${item.id}
          `,
          ).toHaveLength(0);
          await expect(
            tx.savepoint(
              async (savepoint) => savepoint`
            update work_items set
              sla_policy_version_id = ${policy.id},
              sla_started_at = ${preview.startedAt},
              sla_warning_at = ${preview.warningAt},
              sla_due_at = ${preview.dueAt}
            where id = ${item.id}
          `,
            ),
          ).rejects.toThrow(/immutable/i);
          await expect(
            repository.attachPolicy({
              ...preview,
              previewHash: "0".repeat(64),
              actorId: fixture.admin_id,
            }),
          ).rejects.toThrow(/preview/i);
          await expect(
            repository.attachPolicy({
              ...preview,
              expectedVersion: item.version + 1,
              actorId: fixture.admin_id,
            }),
          ).rejects.toThrow(/stale/i);
          await tx`update staff_profiles set active = false where user_id = ${fixture.admin_id}`;
          await expect(
            repository.attachPolicy({
              ...preview,
              actorId: fixture.admin_id,
            }),
          ).rejects.toThrow(/Admin/i);
          await tx`update staff_profiles set active = true where user_id = ${fixture.admin_id}`;
          await tx`update sla_policies set active = false where id = ${policy.id}`;
          await expect(
            repository.attachPolicy({
              ...preview,
              actorId: fixture.admin_id,
            }),
          ).rejects.toThrow(/policy/i);
          await tx`update sla_policies set active = true where id = ${policy.id}`;
          const expiredRepository = createWorkItemRepository({
            sql: tx,
            now: new Date(Date.parse(preview.startedAt) + 16 * 60_000).toISOString(),
          });
          await expect(
            expiredRepository.attachPolicy({
              ...preview,
              actorId: fixture.admin_id,
            }),
          ).rejects.toThrow(/expired/i);
          const attached = await repository.attachPolicy({
            ...preview,
            actorId: fixture.admin_id,
          });
          expect(attached).toMatchObject({
            slaPolicyVersionId: policy.id,
            slaStartedAt: preview.startedAt,
            slaWarningAt: preview.warningAt,
            slaDueAt: preview.dueAt,
            version: item.version + 1,
          });
          const audit = await tx<{ actor_id: string; policy_version_id: string }[]>`
            select actor_id, policy_version_id from work_item_sla_attachments
            where work_item_id = ${item.id}
          `;
          expect(audit).toEqual([{ actor_id: fixture.admin_id, policy_version_id: policy.id }]);
          await expect(
            tx.savepoint(
              async (savepoint) => savepoint`
            update work_item_sla_attachments set preview_hash = ${"b".repeat(64)}
            where work_item_id = ${item.id}
          `,
            ),
          ).rejects.toThrow(/immutable/i);
          await expect(
            tx.savepoint(
              async (savepoint) => savepoint`
            update work_items set sla_due_at = ${new Date(Date.parse(preview.dueAt) + 60_000).toISOString()}
            where id = ${item.id}
          `,
            ),
          ).rejects.toThrow(/immutable/i);
          await expect(
            repository.attachPolicy({
              ...preview,
              actorId: fixture.admin_id,
            }),
          ).rejects.toThrow(/stale|already/i);
          throw new Error(rollbackMessage);
        }),
      ).rejects.toThrow(rollbackMessage);
    } finally {
      await sql.end();
    }
  }, 30_000);

  it("creates a work item for a corporate_change_request case using its own FK column", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    const rollbackMessage = "rollback corporate change request work item fixture";

    try {
      await expect(
        sql.begin(async (tx) => {
          // Reuse the calendar backing the seeded annual_return_case SLA policy so
          // this test doesn't need to seed its own business_calendars fixture.
          const [calendar] = await tx<{ business_calendar_id: string }[]>`
            select business_calendar_id from sla_policies
            where work_type = 'annual_return_case' and active = true
            order by version desc limit 1
          `;
          expect(calendar).toBeDefined();

          const [team] = await tx<{ id: string }[]>`select id from teams limit 1`;
          expect(team).toBeDefined();
          const [user] = await tx<{ id: string }[]>`
            select id from users where active = true limit 1
          `;
          expect(user).toBeDefined();
          const ownerId = user.id;

          const companyId = crypto.randomUUID();
          await tx`
            insert into companies (
              id, company_name, cr_number, br_number, incorporation_date,
              annual_return_basis_date, registered_office, company_secretary,
              status, assigned_owner_id, assigned_team_id
            ) values (
              ${companyId}, 'Task 8 Test Company Ltd', ${`T8CR${companyId.slice(0, 8)}`},
              ${`T8BR${companyId.slice(0, 8)}`}, '2021-07-01', '2026-07-01',
              'Unit 8, Test Tower, Hong Kong', 'Kossilon Corporate Services Limited',
              'active', ${ownerId}, ${team.id}
            )
          `;

          const requestId = crypto.randomUUID();
          await tx`
            insert into corporate_change_requests (
              id, company_id, change_type, owner_id, quoted_fee, new_registered_office
            ) values (
              ${requestId}, ${companyId}, 'address_change', ${ownerId}, 1500,
              'Unit 9, New Tower, Hong Kong'
            )
          `;

          await tx`
            insert into sla_policies (
              policy_key, version, name, work_type, business_calendar_id,
              warning_minutes, due_minutes, effective_from, active, created_by
            ) values (
              'corporate_change_request', 1, 'Corporate change request SLA', 'corporate_change_request',
              ${calendar.business_calendar_id}, 2880, 5760, now(), true, ${ownerId}
            )
          `;

          const workItem = await ensureWorkItemForEvent(tx, {
            companyId,
            caseType: "corporate_change_request",
            corporateChangeRequestId: requestId,
            sourceEventKey: `corporate-change:${requestId}:created`,
            sourceEventType: "corporate_change_request_created",
            workType: "corporate_change_request",
            title: "Process corporate change request",
            ownerId,
            teamId: team.id,
          });

          expect(workItem.caseType).toBe("corporate_change_request");
          expect(workItem.corporateChangeRequestId).toBe(requestId);
          expect(workItem.annualReturnCaseId).toBeNull();

          throw new Error(rollbackMessage);
        }),
      ).rejects.toThrow(rollbackMessage);
    } finally {
      await sql.end();
    }
  }, 20_000);
});
