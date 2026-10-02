import { authorizeMaintenanceRequest, type MaintenanceTickInput } from "./maintenance-trigger";
export type SchedulerOwner = "vercel" | "cloudflare" | "paused";
export function schedulerOwner(env: Record<string, unknown>): SchedulerOwner {
  const value = env.MAINTENANCE_SCHEDULER_OWNER;
  return value === "vercel" || value === "cloudflare" ? value : "paused";
}
export function scheduledSlot(now: Date): string {
  return new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
}
export function createMaintenanceHttpHandler(input: {
  env: Record<string, unknown>;
  run: (data: MaintenanceTickInput) => Promise<unknown>;
  clock?: () => Date;
}) {
  return async (request: Request): Promise<Response> => {
    const headers = { "cache-control": "no-store", "content-type": "application/json" };
    if (
      !authorizeMaintenanceRequest(
        request,
        typeof input.env.CRON_SECRET === "string" ? input.env.CRON_SECRET : undefined,
      )
    )
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
    if (schedulerOwner(input.env) !== "vercel")
      return new Response(JSON.stringify({ error: "scheduler_paused_or_other_owner" }), {
        status: 503,
        headers,
      });
    const runId = crypto.randomUUID();
    const data: MaintenanceTickInput = {
      // The user agent only classifies an already authenticated request. It is
      // not a credential or proof of a platform invocation; release acceptance
      // must also correlate these candidate runs with Vercel's invocation logs.
      trigger: request.headers.get("user-agent") === "vercel-cron/1.0" ? "scheduled" : "manual",
      triggerEvidence:
        request.headers.get("user-agent") === "vercel-cron/1.0" ? "http-candidate" : "manual",
      scheduledAt: scheduledSlot((input.clock ?? (() => new Date()))()),
      runId,
      allowedJobs: [
        "evaluateEscalations",
        "settleNotificationAttempts",
        "redactNotifications",
        "escalateStalledQuarantine",
        "runBulkAssignments",
      ],
    };
    // The endpoint is an authenticated schedule candidate. Platform logs are
    // still required to prove 3 real ticks; a hand-crafted GET cannot pass UAT.
    try {
      const result = await input.run(data);
      return new Response(
        JSON.stringify({
          runId,
          result,
          executionScope: "safe-maintenance-only",
          providerTriggerVerified: false,
        }),
        { headers },
      );
    } catch {
      console.error("maintenance invocation failed", { runId, phase: "start_or_record" });
      return new Response(JSON.stringify({ error: "maintenance_unavailable", runId }), {
        status: 503,
        headers,
      });
    }
  };
}
