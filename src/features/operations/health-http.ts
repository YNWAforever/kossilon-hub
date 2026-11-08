import { defaultToleranceSeconds, maintenanceHealthOf, type MaintenanceRunRecord } from "./health";

export type HealthHttpDependencies = {
  now: () => Date;
  readMaintenance: () => Promise<{
    runs: readonly MaintenanceRunRecord[];
    candidateRuns: readonly MaintenanceRunRecord[];
    lastScheduledSuccessAt: string | null;
    database: { database: string; branchId: string | null };
  }>;
};

export type SchedulerFreshness = {
  state: "fresh" | "stale" | "never-observed";
  lastRunAt: string | null;
  lagSeconds: number | null;
  toleranceSeconds: number;
  /** True when the newest run was an unverified HTTP candidate. */
  unverified: boolean;
  /** True when the newest run recorded a failed outcome. */
  failing: boolean;
};

/**
 * Is the schedule firing right now?
 *
 * Deliberately different from `maintenanceHealthOf`: that rule asks whether a
 * *platform-verified* run is recent, so it reports `stale` while the cron is
 * demonstrably firing as unverified HTTP candidates. For an uptime alarm that
 * would be a false negative — a dead cron is the emergency, verification is a
 * separate fact. `maintenance` stays in the response so the gap is visible.
 */
export function schedulerCandidateFreshness(input: {
  runs: readonly MaintenanceRunRecord[];
  nowIso: string;
  toleranceSeconds: number;
}): SchedulerFreshness {
  const scheduled = input.runs.filter((run) => run.triggerSource === "scheduled");
  const latest = scheduled.reduce<MaintenanceRunRecord | null>(
    (newest, run) =>
      !newest || Date.parse(run.finishedAt) > Date.parse(newest.finishedAt) ? run : newest,
    null,
  );
  if (!latest) {
    return {
      state: "never-observed",
      lastRunAt: null,
      lagSeconds: null,
      toleranceSeconds: input.toleranceSeconds,
      unverified: false,
      failing: false,
    };
  }
  const lagSeconds = Math.round((Date.parse(input.nowIso) - Date.parse(latest.finishedAt)) / 1000);
  return {
    state: lagSeconds > input.toleranceSeconds ? "stale" : "fresh",
    lastRunAt: latest.finishedAt,
    lagSeconds,
    toleranceSeconds: input.toleranceSeconds,
    unverified: latest.platformTriggerVerified !== true,
    failing: latest.outcome === "failed",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Public, secret-free runtime health for uptime/cron alerting.
 *
 * It answers two questions that were previously only available to a signed-in
 * staff member reading `/operations`:
 *
 * - is the app up at all (`200` vs `503`), and
 * - is the five-minute maintenance tick still running (`maintenance.state`).
 *
 * A scheduler that never ran, went stale or failed returns `503` so a scheduled
 * smoke job alerts instead of the failure being discovered on a monthly screen
 * review. `degraded` stays `200`: some pass failed but the schedule is alive.
 */
export function createHealthHttpHandler(dependencies: HealthHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return json(405, { ok: false, error: "method-not-allowed" });
    }

    try {
      const [maintenance, now] = await Promise.all([
        dependencies.readMaintenance(),
        Promise.resolve(dependencies.now()),
      ]);
      const health = maintenanceHealthOf({
        runs: maintenance.runs,
        now: now.toISOString(),
        toleranceSeconds: defaultToleranceSeconds(),
        lastScheduledSuccessAt: maintenance.lastScheduledSuccessAt,
      });
      const scheduler = schedulerCandidateFreshness({
        runs: maintenance.candidateRuns,
        nowIso: now.toISOString(),
        toleranceSeconds: defaultToleranceSeconds(),
      });
      const ok = scheduler.state === "fresh" && !scheduler.failing;

      return json(ok ? 200 : 503, {
        ok,
        checkedAt: now.toISOString(),
        database: maintenance.database,
        scheduler: {
          running: scheduler.state === "fresh",
          failing: scheduler.failing,
          lastRunAt: scheduler.lastRunAt,
          lagSeconds: scheduler.lagSeconds,
          toleranceSeconds: scheduler.toleranceSeconds,
          evidence: scheduler.unverified ? "http-candidate" : "platform-verified",
        },
        // Kept for parity with `/operations`: this is the strict
        // platform-verified view, which may still say stale while the schedule
        // is alive.
        maintenance: health,
      });
    } catch {
      // No database, no repository, a timeout: the endpoint is unhealthy, but it
      // must not print the error, which can carry connection details.
      return json(503, { ok: false, error: "health-unavailable" });
    }
  };
}
