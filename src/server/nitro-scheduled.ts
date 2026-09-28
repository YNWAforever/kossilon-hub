import { definePlugin } from "nitro";

import { runScheduledMaintenanceForWorker } from "../server";

/**
 * The owner-gated bridge between Cloudflare's five-minute cron and the safe per-job trigger.
 *
 * `src/server.ts` is the TanStack Start server entry, not the Worker entry. Nitro
 * wraps it: the generated `.output/server/index.mjs` exports its own `scheduled`,
 * which does nothing but `nitroHooks.callHook("cloudflare:scheduled", ...)`. A
 * `scheduled` method exported from the server entry is therefore never called —
 * an earlier version of this work added one and it was dead on arrival, which
 * turned "a cron with no handler" into "a handler the platform never invokes".
 *
 * Registering the hook is the documented mechanism, and the comment in
 * ./maintenance.ts named it from the start.
 *
 * `waitUntil` keeps the invocation alive for the whole pass rather than only
 * until the hook callback returns; the hook signature is synchronous.
 */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", ({ controller, context, env }) => {
    const bindings = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
    if (bindings.MAINTENANCE_SCHEDULER_OWNER !== "cloudflare") return;
    context.waitUntil(runScheduledMaintenanceForWorker(controller.scheduledTime));
  });
});
