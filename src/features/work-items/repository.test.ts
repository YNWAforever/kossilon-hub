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
            )
          `;
          expect(await repository.lastSlaEvaluationAt()).toBe("2099-01-01T00:00:01.000Z");
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

          await repository.evaluateEscalations("2026-07-01T02:00:00.000Z");
          await repository.evaluateEscalations("2026-07-01T02:00:00.000Z");
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
