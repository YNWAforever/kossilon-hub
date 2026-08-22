import { describe, expect, it } from "vitest";
import { dueMilestone } from "./reminder-cadence";

describe("dueMilestone", () => {
  it("returns null when no milestone has come due yet", () => {
    expect(dueMilestone("2026-09-12", "2026-08-01", [])).toBeNull();
  });

  it("fires 1_month exactly 30 days out", () => {
    expect(dueMilestone("2026-09-12", "2026-08-13", [])).toBe("1_month");
  });

  it("fires 2_week exactly 14 days out, unaffected by an unrelated milestone already on record", () => {
    // Pins the 14-day boundary. The "1_month" entry in firedMilestones does not
    // drive this result: 2_week is the first (most urgent) applicable milestone
    // in the walk, so 1_month's fired status is never even consulted.
    expect(dueMilestone("2026-09-12", "2026-08-29", ["1_month"])).toBe("2_week");
  });

  it("fires 1_week exactly 7 days out, unaffected by unrelated milestones already on record", () => {
    // Pins the 7-day boundary, same point as above: 1_week is the first
    // applicable milestone, so 1_month/2_week's fired status is irrelevant here.
    expect(dueMilestone("2026-09-12", "2026-09-05", ["1_month", "2_week"])).toBe("1_week");
  });

  it("does not re-fire a milestone that has already fired", () => {
    expect(dueMilestone("2026-09-12", "2026-08-13", ["1_month"])).toBeNull();
  });

  it("skips straight to the most urgent applicable milestone for a late-created case", () => {
    // 5 days before the deadline: only 1_week's 7-day window applies. 2_week (14d)
    // and 1_month (30d) are both already "in range" numerically, but the loop
    // returns on the first (most urgent) match, so neither is ever considered.
    expect(dueMilestone("2026-09-12", "2026-09-07", [])).toBe("1_week");
  });

  it("still fires 1_week for an overdue case with nothing recorded yet", () => {
    expect(dueMilestone("2026-09-12", "2026-09-20", [])).toBe("1_week");
  });

  it("returns null once every milestone has fired, even if overdue", () => {
    expect(dueMilestone("2026-09-12", "2026-09-20", ["1_month", "2_week", "1_week"])).toBeNull();
  });

  it("does not cascade into firing every remaining milestone across consecutive cron ticks", () => {
    // Regression test: the loop used to fall through to the next (less urgent)
    // milestone when it found one that was due but already fired, instead of
    // stopping. For a case that becomes eligible 5 days before its deadline,
    // that meant 1_week fired on tick 1, then 2_week ~5 minutes later on tick 2,
    // then 1_month on tick 3 — three reminders to a real client within about 15
    // minutes. Each call below simulates one cron tick, feeding back the
    // milestones recorded as fired by the previous tick.
    expect(dueMilestone("2026-09-12", "2026-09-07", [])).toBe("1_week");
    expect(dueMilestone("2026-09-12", "2026-09-07", ["1_week"])).toBeNull();
    expect(dueMilestone("2026-09-12", "2026-09-07", ["1_week", "2_week"])).toBeNull();
  });
});
