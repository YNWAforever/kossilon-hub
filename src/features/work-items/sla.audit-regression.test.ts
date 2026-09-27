import { describe, expect, it } from "vitest";
import { rankAssignmentCandidates } from "./assignment";
import { deriveSlaDisplay, snapshotSla } from "./sla";
import { workQueuePersonLabel } from "./types";
import type { BusinessCalendar, StaffCandidate } from "./types";

const now = "2026-07-07T04:00:00.000Z";
const base = {
  status: "open" as const,
  escalationState: "none" as const,
  workDueAt: "2026-07-03T09:00:00.000Z",
  slaPolicyVersionId: null,
  slaStartedAt: null,
  slaWarningAt: null,
  slaDueAt: null,
  slaBreachedAt: null,
  evaluatedAt: null,
};

describe("T05 work queue audit regressions", () => {
  it("t05_scenario_1 distinguishes equal UUID prefixes and equal names by team; inactive staff cannot be assigned", () => {
    const alice = {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Alice Chan",
      role: "Staff" as const,
      teamName: "Company Secretarial",
      active: true,
    };
    const bob = {
      id: "20000000-0000-4000-8000-000000000002",
      name: "Bob Lee",
      role: "Staff" as const,
      teamName: "Accounts",
      active: true,
    };
    expect(workQueuePersonLabel(alice)).not.toBe(workQueuePersonLabel(bob));
    expect(workQueuePersonLabel(alice)).toContain("Alice Chan");
    expect(workQueuePersonLabel({ ...alice, id: bob.id, teamName: "Accounts" })).not.toBe(
      workQueuePersonLabel(alice),
    );

    const candidate: StaffCandidate = {
      staffId: "staff-1",
      userId: alice.id,
      role: "Staff",
      teamIds: ["team-1"],
      active: false,
      available: true,
      capacityPoints: 100,
      skills: [{ key: "filing", proficiency: 5 }],
      activeWork: [],
      caseIds: [],
    };
    expect(
      rankAssignmentCandidates({
        assignmentTarget: "owner",
        requiredRole: "Staff",
        requiredSkillKey: "filing",
        teamId: "team-1",
        caseId: null,
        ownerId: null,
        reviewerId: null,
        separationOfDuties: true,
        candidates: [candidate],
      }),
    ).toEqual([]);
  });

  it("t05_scenario_2 keeps overdue work distinct from missing or breached SLA policy", () => {
    const noPolicy = deriveSlaDisplay(base, now);
    expect(noPolicy.state).toBe("not-configured");
    expect(noPolicy.workOverdue).toBe(true);
    expect(noPolicy.slaDueAt).toBeNull();
    const activePolicy = deriveSlaDisplay(
      {
        ...base,
        slaPolicyVersionId: "policy-1",
        slaStartedAt: "2026-07-02T01:00:00.000Z",
        slaWarningAt: "2026-07-02T02:00:00.000Z",
        slaDueAt: "2026-07-02T03:00:00.000Z",
      },
      now,
    );
    expect(activePolicy.state).toBe("breached");
    expect(activePolicy.workOverdue).toBe(true);
  });

  it("t05_scenario_3 uses Hong Kong business holidays and exposes scheduler evaluation time", () => {
    const hours = [{ start: "09:00", end: "18:00" }];
    const calendar: BusinessCalendar = {
      id: "hk",
      timezone: "Asia/Hong_Kong",
      weeklySchedule: {
        monday: hours,
        tuesday: hours,
        wednesday: hours,
        thursday: hours,
        friday: hours,
        saturday: [],
        sunday: [],
      },
      holidays: [{ date: "2026-07-13", closed: true }],
    };
    const snapshot = snapshotSla(
      { id: "policy-2", warningMinutes: 60, dueMinutes: 180 },
      "2026-07-10T08:00:00.000Z",
      calendar,
    );
    expect(snapshot.dueAt).toBe("2026-07-14T02:00:00.000Z");
    const display = deriveSlaDisplay(
      {
        ...base,
        workDueAt: null,
        slaPolicyVersionId: snapshot.policyVersionId,
        slaStartedAt: snapshot.startedAt,
        slaWarningAt: snapshot.warningAt,
        slaDueAt: snapshot.dueAt,
        escalationState: "acknowledged",
        evaluatedAt: "2026-07-10T09:00:00.000Z",
      },
      "2026-07-10T09:30:00.000Z",
    );
    expect(display.state).toBe("acknowledged");
    expect(display.evaluatedAt).toBe("2026-07-10T09:00:00.000Z");
    expect(deriveSlaDisplay({ ...base, evaluatedAt: null }, now).evaluatedAt).toBeNull();
  });
});
