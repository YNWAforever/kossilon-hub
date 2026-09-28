/**
 * Whether the scheduled maintenance tick is actually running.
 *
 * Pure, and clock-injected. Everything this decides comes from `maintenance_runs`
 * rows plus a `now`; nothing here reads a database or a binding.
 *
 * The owner-gated tick currently evaluates SLA escalations and runs bounded
 * non-send maintenance passes. Provider sends and document scans require
 * separate activation gates. It is also the only subsystem with no user watching
 * it: every screen reads tables a human writes to, so a cron that stopped firing
 * leaves every screen looking completely normal until a statutory deadline is
 * missed.
 *
 * BLOCKED_INTEGRATION: deployment-runtime. Nobody has ever observed the schedule
 * fire. This module does not clear that -- only a real invocation on a real
 * deployment can -- but it is what makes the first one observable, and what makes
 * the millionth missing one loud.
 */

export type MaintenanceRunOutcome = "succeeded" | "partial" | "failed";

export type MaintenanceRunRecord = {
  id: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: MaintenanceRunOutcome;
  failedPasses: readonly string[];
  /**
   * What the dispatch pass did on this run.
   *
   * Null when the run recorded no `passes` at all, when the dispatch pass
   * itself threw, or when `passes.dispatch` had only one of `sent` and
   * `suppressedFixtureOrigin` -- `mapRun` treats either count being absent as
   * the whole fact being unavailable, rather than reporting half a summary as
   * complete. Null is not zero: "nothing was sent" and "nobody knows what was
   * sent" are different facts and only one of them is reassuring.
   */
  dispatch: { sent: number; suppressedFixtureOrigin: number } | null;
  triggerSource: "scheduled" | "manual";
  deploymentRef?: string | null;
};

export type MaintenanceHealthState =
  /**
   * No run has ever been recorded. **Not healthy**, and deliberately its own
   * state rather than an empty `healthy`.
   *
   * It is what a deployment whose cron never registered looks like, it is what a
   * deployment nobody has ever deployed looks like, and it is this repository's
   * actual state. A green tick over an empty table would be a positive claim
   * made out of no evidence, about the one subsystem nobody watches.
   */
  | "never-observed"
  /** Runs exist; the most recent is older than the tolerance. A cron that stopped. */
  | "stale"
  /** Recent, and the most recent run did not complete. */
  | "failing"
  /** Recent, completed, but named passes threw. */
  | "degraded"
  | "healthy";

export type MaintenanceHealth = {
  state: MaintenanceHealthState;
  /** Null only when nothing has ever run. */
  lastRunAt: string | null;
  /**
   * The last run with no failed pass. Null when every recorded run failed, which
   * is a different fact from never having run.
   */
  lastSuccessAt: string | null;
  /** Seconds since `lastRunAt`. Null when nothing has ever run. */
  lagSeconds: number | null;
  /** Seconds a run may be late before it counts as stale. */
  toleranceSeconds: number;
  /** The passes that threw in the most recent run. */
  failedPasses: readonly string[];
  /** Said in words. A colour is not a sentence, and this row is what staff read. */
  summary: string;
};

/**
 * Seconds between ticks, from the declared cron expression.
 *
 * Returns null for any expression this cannot read, and callers must then be
 * given an explicit tolerance rather than falling back to a guess. A staleness
 * threshold invented from an unparsed schedule would be wrong in exactly the
 * situation it exists to catch.
 */
export function cronIntervalSeconds(expression: string): number | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (hour !== "*" || dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return null;

  if (minute === "*") return 60;

  const step = /^\*\/(\d{1,2})$/.exec(minute);
  if (!step) return null;

  const minutes = Number(step[1]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 59) return null;
  return minutes * 60;
}

/**
 * How late a tick may be before it means something.
 *
 * Two intervals. One missed tick is a slow cold start, a clock skew or a
 * deployment rolling; two consecutive missed ticks is a pattern, and this alarm
 * has to be worth believing the day it fires.
 */
export const MISSED_TICKS_BEFORE_STALE = 2;

export function staleAfterSeconds(intervalSeconds: number): number {
  return intervalSeconds * MISSED_TICKS_BEFORE_STALE;
}

/**
 * The schedule this Worker declares.
 *
 * A copy, because `wrangler.template.jsonc` is a build-time file and the running
 * Worker cannot read it. `health.test.ts` asserts the two agree, so changing the
 * cron without changing this fails the suite rather than silently leaving the
 * staleness rule measuring the old interval.
 */
export const SCHEDULED_MAINTENANCE_CRON = "*/5 * * * *";

/**
 * Throws rather than falling back if the declared schedule becomes unreadable.
 *
 * A default invented here would be a staleness threshold nobody derived, and it
 * would be wrong in exactly the situation this alarm exists for.
 */
export function defaultToleranceSeconds(): number {
  const interval = cronIntervalSeconds(SCHEDULED_MAINTENANCE_CRON);
  if (interval === null) {
    throw new Error(`Cannot derive a maintenance interval from "${SCHEDULED_MAINTENANCE_CRON}".`);
  }
  return staleAfterSeconds(interval);
}

function secondsBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 1000);
}

function describeLag(lagSeconds: number): string {
  if (lagSeconds < 120) return `${Math.max(lagSeconds, 0)} 秒前`;
  if (lagSeconds < 7200) return `${Math.round(lagSeconds / 60)} 分鐘前`;
  return `${Math.round(lagSeconds / 3600)} 小時前`;
}

export function maintenanceHealthOf(input: {
  /** Most recent first. Manual runs may be included; they are filtered out below. */
  runs: readonly MaintenanceRunRecord[];
  now: string;
  toleranceSeconds: number;
  /**
   * The last clean scheduled run in all of history, supplied by the caller.
   *
   * `runs` is a window -- the most recent handful -- and a window can answer
   * "is it running now" but not "when did it last work". Deriving the second
   * from the first meant an hour of partial ticks pushed the last success out
   * of view and the screen reported that the schedule had never succeeded.
   *
   * Optional so the pure rule stays callable with a window alone; when omitted
   * it falls back to the window, which is right for a caller that has no more
   * than that.
   */
  lastScheduledSuccessAt?: string | null;
}): MaintenanceHealth {
  // Scheduled runs only. The question this answers is "is the schedule
  // running", and an operator invoking the entrypoint by hand -- during a
  // deployment, while debugging, from a runbook step -- must not be able to
  // make a dead cron look alive. Manual runs are still recorded and still shown
  // in the run list; they just do not vote here.
  const scheduled = input.runs.filter((run) => run.triggerSource === "scheduled");
  const [latest] = scheduled;

  if (!latest) {
    return {
      state: "never-observed",
      lastRunAt: null,
      lastSuccessAt: null,
      lagSeconds: null,
      toleranceSeconds: input.toleranceSeconds,
      failedPasses: [],
      // Never "一切正常". Nothing here has been observed, and the sentence has
      // to say that rather than leave a blank panel to be read as reassurance.
      summary:
        "從未記錄過任何排程執行。這不代表系統正常，而是代表沒有任何證據顯示排程有運行過：" +
        "逾期升級與已啟用的維護工作需要真實排程證據。",
    };
  }

  const lagSeconds = secondsBetween(latest.finishedAt, input.now);
  // History first, window second. The window is a fallback, not the source.
  const lastSuccessAt =
    input.lastScheduledSuccessAt !== undefined
      ? input.lastScheduledSuccessAt
      : (scheduled.find((run) => run.outcome === "succeeded")?.finishedAt ?? null);
  const shared = {
    lastRunAt: latest.finishedAt,
    lastSuccessAt,
    lagSeconds,
    toleranceSeconds: input.toleranceSeconds,
    failedPasses: latest.failedPasses,
  };

  // Staleness outranks the last run's outcome. A cron that stopped after a clean
  // tick and one that stopped after a failed tick are the same emergency:
  // nothing is running now, and that matters more than how the last one ended.
  if (lagSeconds > input.toleranceSeconds) {
    return {
      ...shared,
      state: "stale",
      summary:
        `排程最後一次執行是 ${describeLag(lagSeconds)}，已超過容許的 ` +
        `${Math.round(input.toleranceSeconds / 60)} 分鐘。期間已啟用的維護工作沒有執行。`,
    };
  }

  if (latest.outcome === "failed") {
    return {
      ...shared,
      state: "failing",
      summary: "最近一次排程執行未能完成，沒有任何一個環節的結果。",
    };
  }

  if (latest.outcome === "partial" || latest.failedPasses.length > 0) {
    return {
      ...shared,
      state: "degraded",
      summary: `最近一次排程執行完成，但以下環節失敗：${latest.failedPasses.join("、")}。`,
    };
  }

  return {
    ...shared,
    state: "healthy",
    summary: `資料庫最近一筆排程紀錄完成於 ${describeLag(lagSeconds)}；請核對它是否來自目前部署。`,
  };
}

/**
 * A count from a run's dispatch summary, or the fact that there is none.
 *
 * Separated from the JSX for the same reason `earliestMissingLabel` was: the
 * distinction between "zero" and "unknown" is the whole point, and it is
 * exactly the kind of thing a `?? 0` quietly destroys at the last moment.
 */
export function dispatchCountLabel(count: number | null): string {
  return count === null ? "無法判斷" : String(count);
}
