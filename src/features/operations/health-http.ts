import { defaultToleranceSeconds, maintenanceHealthOf, type MaintenanceRunRecord } from "./health";

export type HealthHttpDependencies = {
  now: () => Date;
  readMaintenance: () => Promise<{
    runs: readonly MaintenanceRunRecord[];
    lastScheduledSuccessAt: string | null;
    database: { database: string; branchId: string | null };
  }>;
};

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
      const ok = health.state === "healthy" || health.state === "degraded";

      return json(ok ? 200 : 503, {
        ok,
        checkedAt: now.toISOString(),
        database: maintenance.database,
        maintenance: health,
      });
    } catch {
      // No database, no repository, a timeout: the endpoint is unhealthy, but it
      // must not print the error, which can carry connection details.
      return json(503, { ok: false, error: "health-unavailable" });
    }
  };
}
