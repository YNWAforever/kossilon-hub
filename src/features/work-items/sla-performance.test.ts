import { setImmediate } from "node:timers/promises";
import { expect, it, onTestFinished } from "vitest";
import { snapshotSla } from "./sla";
import type { BusinessCalendar } from "./types";

const calendar: BusinessCalendar = {
  id: "synthetic-weekend-sla",
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

it("calculates 100 independent weekend SLA snapshots within the ordinary test lifetime", (context) => {
  const pending = (async () => {
    for (let index = 0; index < 100; index++) {
      context.signal.throwIfAborted();
      const policyVersionId = `synthetic-weekend-policy-${index}`;
      expect(
        snapshotSla(
          { id: policyVersionId, warningMinutes: 60, dueMinutes: 180 },
          "2026-10-03T04:00:00.000Z",
          calendar,
        ),
      ).toEqual({
        policyVersionId,
        startedAt: "2026-10-03T04:00:00.000Z",
        warningAt: "2026-10-05T02:00:00.000Z",
        dueAt: "2026-10-05T04:00:00.000Z",
      });
      await setImmediate();
    }
  })();
  onTestFinished(async () => {
    try {
      await pending;
    } catch (error) {
      if (!context.signal.aborted || error !== context.signal.reason) throw error;
    }
  });
  return pending;
});
