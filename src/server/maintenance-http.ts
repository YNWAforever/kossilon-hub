import { SCHEDULED_MAINTENANCE_CRON } from "@/features/operations/health";

import { authorizeMaintenanceRequest, type MaintenanceTickInput } from "./maintenance-trigger";
export type SchedulerOwner = "vercel" | "cloudflare" | "paused";
export function schedulerOwner(env: Record<string, unknown>): SchedulerOwner {
  const value = env.MAINTENANCE_SCHEDULER_OWNER;
  return value === "vercel" || value === "cloudflare" ? value : "paused";
}
export function scheduledSlot(now: Date): string {
  return new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
}

/**
 * How this invocation was triggered, and whether the platform itself vouched
 * for it.
 *
 * Vercel Cron sends two things our handler can rely on: the `Authorization`
 * header carrying the deployment's `CRON_SECRET` (checked before this runs) and
 * an `x-vercel-cron-schedule` header containing the expression from
 * `vercel.json`. Matching that expression to the schedule this deployment
 * declares is platform evidence, not a guess — a request without the secret
 * never reaches here.
 */
export function classifyMaintenanceRequest(request: Request): {
  trigger: "scheduled" | "manual";
  evidence: "platform-header" | "http-candidate" | "manual";
  verified: boolean;
} {
  const schedule = request.headers.get("x-vercel-cron-schedule")?.trim();
  const userAgent = request.headers.get("user-agent");
  const explicitSchedule = schedule === SCHEDULED_MAINTENANCE_CRON;
  const cronUserAgent = userAgent === "vercel-cron/1.0";

  if (explicitSchedule) {
    return { trigger: "scheduled", evidence: "platform-header", verified: true };
  }
  if (cronUserAgent) {
    return { trigger: "scheduled", evidence: "http-candidate", verified: false };
  }
  return { trigger: "manual", evidence: "manual", verified: false };
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
    const classification = classifyMaintenanceRequest(request);
    const data: MaintenanceTickInput = {
      // Neither header is a credential on its own; both are read only after the
      // bearer secret above succeeded.
      trigger: classification.trigger,
      triggerEvidence: classification.evidence,
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
    try {
      const result = await input.run(data);
      return new Response(
        JSON.stringify({
          runId,
          result,
          executionScope: "safe-maintenance-only",
          providerTriggerVerified: classification.verified,
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
