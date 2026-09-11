import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import {
  cronIntervalSeconds,
  defaultToleranceSeconds,
  dispatchCountLabel,
  maintenanceHealthOf,
  SCHEDULED_MAINTENANCE_CRON,
  staleAfterSeconds,
  type MaintenanceRunRecord,
} from "./health";

const NOW = "2026-09-11T10:00:00.000Z";
const FIVE_MINUTES = 300;
const TOLERANCE = staleAfterSeconds(FIVE_MINUTES);

function run(overrides: Partial<MaintenanceRunRecord> = {}): MaintenanceRunRecord {
  return {
    id: "run-1",
    scheduledFor: "2026-09-11T09:58:00.000Z",
    startedAt: "2026-09-11T09:58:00.000Z",
    finishedAt: "2026-09-11T09:58:04.000Z",
    durationMs: 4000,
    outcome: "succeeded",
    failedPasses: [],
    dispatch: null,
    triggerSource: "scheduled",
    ...overrides,
  };
}

describe("cronIntervalSeconds", () => {
  it("reads a step schedule", () => {
    expect(cronIntervalSeconds("*/5 * * * *")).toBe(300);
    expect(cronIntervalSeconds("*/1 * * * *")).toBe(60);
    expect(cronIntervalSeconds("* * * * *")).toBe(60);
  });

  /**
   * Null rather than a guess. A staleness threshold invented from a schedule
   * this cannot read would be wrong in exactly the situation it exists to
   * catch -- and a caller that gets null has to be given an explicit tolerance
   * instead of silently inheriting a default.
   */
  it("refuses to guess an interval it cannot read", () => {
    for (const expression of [
      "0 3 * * *", // daily, not an interval
      "*/5 * * * 1", // Mondays only
      "*/0 * * * *",
      "*/60 * * * *",
      "not a cron",
      "*/5 * * *",
    ]) {
      expect(cronIntervalSeconds(expression)).toBeNull();
    }
  });

  /**
   * The declared schedule has to be one this can read, or the staleness rule is
   * built on a number nobody derived. Changing the cron to a form this does not
   * parse should fail here rather than quietly disable the alarm.
   */
  it("can read the schedule this Worker actually declares", () => {
    const template = parse(
      readFileSync(new URL("../../../wrangler.template.jsonc", import.meta.url), "utf8"),
    ) as { triggers?: { crons?: string[] } };
    const declared = template.triggers?.crons ?? [];

    expect(declared.length).toBeGreaterThan(0);
    for (const expression of declared) {
      expect(cronIntervalSeconds(expression)).not.toBeNull();
    }
  });

  /**
   * The running Worker cannot read wrangler.template.jsonc, so the schedule is
   * copied into the source. Changing the cron without changing the copy would
   * leave the staleness rule measuring an interval nobody runs on -- and it
   * would fail quietly, in the direction of not alarming.
   */
  it("keeps its copy of the schedule equal to the declared one", () => {
    const template = parse(
      readFileSync(new URL("../../../wrangler.template.jsonc", import.meta.url), "utf8"),
    ) as { triggers?: { crons?: string[] } };

    expect(template.triggers?.crons).toContain(SCHEDULED_MAINTENANCE_CRON);
    expect(defaultToleranceSeconds()).toBe(600);
  });
});

describe("maintenanceHealthOf", () => {
  /**
   * The most important case in this file, and this repository's actual state.
   *
   * An empty table is not a healthy system. It is what a deployment whose cron
   * never registered looks like, and a green tick over it would be a positive
   * claim made out of no evidence.
   */
  it("does not call an empty history healthy", () => {
    const health = maintenanceHealthOf({ runs: [], now: NOW, toleranceSeconds: TOLERANCE });

    expect(health.state).toBe("never-observed");
    expect(health.lastRunAt).toBeNull();
    expect(health.lagSeconds).toBeNull();
    // Silence must not read as reassurance, so the sentence says so in words.
    expect(health.summary).toContain("不代表系統正常");
  });

  it("is healthy when a clean run finished within the tolerance", () => {
    const health = maintenanceHealthOf({ runs: [run()], now: NOW, toleranceSeconds: TOLERANCE });

    expect(health.state).toBe("healthy");
    expect(health.lagSeconds).toBe(116);
    expect(health.lastSuccessAt).toBe("2026-09-11T09:58:04.000Z");
  });

  // One missed tick is a cold start or a clock skew. This alarm has to be worth
  // believing on the day it fires.
  it("tolerates a single missed tick and reports two as stale", () => {
    const oneMissed = maintenanceHealthOf({
      runs: [run({ finishedAt: "2026-09-11T09:52:00.000Z" })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });
    expect(oneMissed.state).toBe("healthy");

    const twoMissed = maintenanceHealthOf({
      runs: [run({ finishedAt: "2026-09-11T09:49:00.000Z" })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });
    expect(twoMissed.state).toBe("stale");
    expect(twoMissed.lagSeconds).toBe(660);
  });

  /**
   * Staleness outranks the last run's outcome. A cron that stopped after a clean
   * tick and one that stopped after a failed tick are the same emergency:
   * nothing is running now.
   */
  it("reports a long-stopped cron as stale rather than by its last outcome", () => {
    const health = maintenanceHealthOf({
      runs: [run({ finishedAt: "2026-09-11T04:00:00.000Z", outcome: "failed" })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("stale");
    expect(health.summary).toContain("6 小時前");
  });

  it("reports a recent run that did not complete as failing", () => {
    const health = maintenanceHealthOf({
      runs: [run({ outcome: "failed" })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("failing");
  });

  it("names the passes that threw in a partial run", () => {
    const health = maintenanceHealthOf({
      runs: [run({ outcome: "partial", failedPasses: ["dispatchDue", "redactNotifications"] })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("degraded");
    expect(health.summary).toContain("dispatchDue");
    expect(health.summary).toContain("redactNotifications");
    expect(health.failedPasses).toEqual(["dispatchDue", "redactNotifications"]);
  });

  /**
   * "Every run we have failed" and "nothing has ever run" are different facts,
   * and a screen that showed a blank last-success for both would merge them.
   */
  it("distinguishes no successful run from no run at all", () => {
    const health = maintenanceHealthOf({
      runs: [
        run({ id: "r1", outcome: "failed" }),
        run({ id: "r2", finishedAt: "2026-09-11T09:53:04.000Z", outcome: "failed" }),
      ],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("failing");
    expect(health.lastSuccessAt).toBeNull();
    expect(health.lastRunAt).not.toBeNull();
  });

  it("reports the last success from an earlier run when the latest one failed", () => {
    const health = maintenanceHealthOf({
      runs: [
        run({ id: "r1", outcome: "failed" }),
        run({ id: "r2", finishedAt: "2026-09-11T09:53:04.000Z" }),
      ],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.lastSuccessAt).toBe("2026-09-11T09:53:04.000Z");
  });

  /**
   * An operator running the entrypoint by hand -- during a deployment, from a
   * runbook step -- must not be able to make a dead cron look alive. This is the
   * whole reason `trigger_source` is a column.
   */
  it("does not let a manual run stand in for the schedule", () => {
    const health = maintenanceHealthOf({
      runs: [run({ triggerSource: "manual" })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("never-observed");
  });

  it("ignores a recent manual run when judging whether the schedule stopped", () => {
    const health = maintenanceHealthOf({
      runs: [
        run({ id: "manual", triggerSource: "manual" }),
        run({ id: "cron", finishedAt: "2026-09-11T04:00:00.000Z" }),
      ],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("stale");
    expect(health.lastRunAt).toBe("2026-09-11T04:00:00.000Z");
  });

  /**
   * A run whose passes reported `not-configured` is not degraded. Under six
   * BLOCKED_INTEGRATIONs the scan and analysis passes say that on every single
   * tick, permanently -- and a screen painted red forever trains staff to ignore
   * it, so the day something actually broke the colour would not change.
   */
  it("does not treat a tick with no scanner configured as a failure", () => {
    const health = maintenanceHealthOf({
      runs: [run({ outcome: "succeeded", failedPasses: [] })],
      now: NOW,
      toleranceSeconds: TOLERANCE,
    });

    expect(health.state).toBe("healthy");
  });
});

describe("dispatchCountLabel", () => {
  /**
   * A run with no recorded dispatch and a run that dispatched nothing are
   * different facts. Rendering both as "0" would say "no messages went out"
   * about a run where nobody knows what went out.
   */
  it("does not render an unknown count as zero", () => {
    expect(dispatchCountLabel(null)).toBe("無法判斷");
    expect(dispatchCountLabel(0)).toBe("0");
    expect(dispatchCountLabel(null)).not.toBe(dispatchCountLabel(0));
  });

  it("renders a real count", () => {
    expect(dispatchCountLabel(7)).toBe("7");
  });
});
