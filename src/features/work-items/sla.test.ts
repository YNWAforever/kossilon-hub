import { describe, expect, it } from "vitest";
import { snapshotSla, thresholdFor } from "./sla";
import type { BusinessCalendar, SlaPolicyVersion, WorkItem } from "./types";

const calendar: BusinessCalendar = {
  id: "hk-v1",
  timezone: "Asia/Hong_Kong",
  weeklySchedule: {
    monday: [{ start: "09:00", end: "18:00" }],
    tuesday: [{ start: "09:00", end: "18:00" }],
    wednesday: [{ start: "09:00", end: "18:00" }],
    thursday: [{ start: "09:00", end: "18:00" }],
    friday: [{ start: "09:00", end: "18:00" }],
    saturday: [],
    sunday: [],
  },
  holidays: [],
};

const policy: SlaPolicyVersion = {
  id: "policy-v3",
  warningMinutes: 60,
  dueMinutes: 180,
};

const workItem: WorkItem = {
  id: "work-1",
  status: "open",
  priority: 50,
  ownerId: null,
  reviewerId: null,
  slaWarningAt: "2026-07-10T09:00:00.000Z",
  slaDueAt: "2026-07-10T10:00:00.000Z",
  slaBreachedAt: null,
};

describe("SLA domain logic", () => {
  it("snapshots policy version and business-time thresholds", () => {
    const startedAt = "2026-07-10T08:00:00.000Z";

    expect(snapshotSla(policy, startedAt, calendar)).toEqual({
      policyVersionId: "policy-v3",
      startedAt,
      warningAt: "2026-07-10T09:00:00.000Z",
      dueAt: "2026-07-13T02:00:00.000Z",
    });
  });

  it.each([
    ["2026-07-10T08:59:59.000Z", "none"],
    ["2026-07-10T09:00:00.000Z", "warning"],
    ["2026-07-10T10:00:00.000Z", "breach"],
  ] as const)("returns %s threshold deterministically", (now, expected) => {
    expect(thresholdFor(workItem, now)).toBe(expected);
  });

  it("keeps completed and cancelled work out of escalation", () => {
    expect(thresholdFor({ ...workItem, status: "completed" }, "2026-07-11T10:00:00.000Z")).toBe(
      "none",
    );
    expect(thresholdFor({ ...workItem, status: "cancelled" }, "2026-07-11T10:00:00.000Z")).toBe(
      "none",
    );
  });

  it("treats a recorded breach as breached", () => {
    expect(
      thresholdFor(
        { ...workItem, slaBreachedAt: "2026-07-10T10:01:00.000Z" },
        "2026-07-10T09:30:00.000Z",
      ),
    ).toBe("breach");
  });
});
