import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
// Statically imported where the rest of this file defers, and safe to be: cron.ts
// has only `import type` dependencies, so this pulls no database client into a
// cold start. It is a pure function over an already-returned result.
import { maintenanceResultOf } from "./server/cron";

// Duplicated from ./features/whatsapp/webhook rather than imported: every other
// branch here defers its imports so a cold start does not pull the database
// client in, and importing the constant would pull the module. The pairing is
// pinned by a test.
const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Cloudflare's owner-gated scheduled hook and Vercel's authenticated HTTP cron
 * both enter the per-job maintenance trigger. The trigger is imported lazily so
 * a normal page request does not load database clients during cold start.
 */
type MaintenanceRunner = (input: {
  now: string;
  triggerSource: "scheduled" | "manual";
}) => Promise<unknown>;

const defaultMaintenanceRunner: MaintenanceRunner = async (input) => {
  const { runMaintenanceTickOnServer, INITIAL_SCHEDULED_JOBS } =
    await import("./server/maintenance-trigger-runtime");
  return runMaintenanceTickOnServer({
    trigger: input.triggerSource,
    scheduledAt: input.now,
    runId: crypto.randomUUID(),
    allowedJobs: [...INITIAL_SCHEDULED_JOBS],
  });
};

/**
 * Injectable for the hook wiring test; the default opens the real maintenance
 * repositories and must never be executed against an ambient developer DB.
 */
export async function runScheduledMaintenanceForWorker(
  scheduledTime: number,
  run: MaintenanceRunner = defaultMaintenanceRunner,
): Promise<void> {
  try {
    // The only caller allowed to say `scheduled`. This is the cron hook itself,
    // so a row it writes is real evidence that the schedule fired -- which is
    // the one thing BLOCKED_INTEGRATION: deployment-runtime has never had.
    const result = await run({
      now: new Date(scheduledTime).toISOString(),
      triggerSource: "scheduled",
    });
    console.log("scheduled maintenance", JSON.stringify(result));
    if (
      result &&
      typeof result === "object" &&
      "outcome" in result &&
      result.outcome === "partial"
    ) {
      throw new Error("Scheduled maintenance completed with failed or unknown jobs.");
    }
  } catch (error) {
    // A run where one pass failed still learned everything the other passes
    // found, and that ride-along result is logged in the same shape as a clean
    // run. Isolating the passes would otherwise trade an aborted tick for a
    // blank one.
    const partial = maintenanceResultOf(error);
    if (partial) console.log("scheduled maintenance", JSON.stringify(partial));
    // Nothing watches a scheduled invocation the way a user watches a request, so
    // a failure has to announce itself or the next signal is a missed SLA.
    console.error("scheduled maintenance failed", error);
    throw error;
  }
}

// No `scheduled` export here. This module is the TanStack Start server entry, not
// the Worker entry — nitro generates that, and its `scheduled` only fires the
// `cloudflare:scheduled` hook. An export on this object would never be called.
// ./server/nitro-scheduled.ts registers the hook instead.
export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/cron/maintenance") {
        const { authorizeMaintenanceRequest } = await import("./server/maintenance-trigger");
        if (process.env.MAINTENANCE_SCHEDULER_OWNER !== "vercel") {
          return new Response("Scheduler owner is not Vercel.", { status: 503 });
        }
        if (!authorizeMaintenanceRequest(request, process.env.CRON_SECRET)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runMaintenanceTickOnServer, scheduledSlot, INITIAL_SCHEDULED_JOBS } =
          await import("./server/maintenance-trigger-runtime");
        const result = await runMaintenanceTickOnServer({
          trigger: "scheduled",
          scheduledAt: scheduledSlot(new Date()),
          runId: crypto.randomUUID(),
          allowedJobs: [...INITIAL_SCHEDULED_JOBS],
        });
        return Response.json(result, {
          status: result.outcome === "partial" ? 500 : 200,
          headers: { "cache-control": "no-store" },
        });
      }
      const isAuthProxyRequest = pathname.startsWith("/api/auth/");
      const isMagicLinkWebhook = pathname === "/api/webhooks/neon-auth";
      const isMagicLinkConfirmation = pathname === "/auth/magic-link/confirm";

      // WOZTELL authenticates with an HMAC over the raw body rather than a session,
      // so inbound WhatsApp lands here instead of on a server function.
      if (pathname === WHATSAPP_WEBHOOK_PATH) {
        const [
          { createWhatsAppWebhookHandler },
          { getWhatsAppWebhookConfig },
          { createWhatsAppRepository },
        ] = await Promise.all([
          import("./features/whatsapp/webhook"),
          import("./features/whatsapp/config"),
          import("./features/whatsapp/repository"),
        ]);
        const runtimeEnv = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
        const { webhookSecret } = getWhatsAppWebhookConfig({
          ...process.env,
          ...(Object.fromEntries(
            Object.entries(runtimeEnv).filter(([, value]) => typeof value === "string"),
          ) as Record<string, string>),
        });

        return createWhatsAppWebhookHandler({
          webhookSecret,
          createRepository: () => createWhatsAppRepository(),
        })(request);
      }

      if (isAuthProxyRequest || isMagicLinkWebhook || isMagicLinkConfirmation) {
        const { createNeonAuthProxy } = await import("./features/auth/neon-auth-proxy");
        const runtimeEnv = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
        const authUrl =
          (typeof runtimeEnv.NEON_AUTH_URL === "string"
            ? runtimeEnv.NEON_AUTH_URL
            : process.env.NEON_AUTH_URL) ?? "";
        const cookieSecret =
          (typeof runtimeEnv.NEON_AUTH_COOKIE_SECRET === "string"
            ? runtimeEnv.NEON_AUTH_COOKIE_SECRET
            : process.env.NEON_AUTH_COOKIE_SECRET) ?? "";

        if (!authUrl.trim()) throw new Error("NEON_AUTH_URL is required.");
        if (cookieSecret.trim().length < 32) {
          throw new Error("NEON_AUTH_COOKIE_SECRET must be at least 32 characters.");
        }

        if (isMagicLinkConfirmation) {
          const { createMagicLinkConfirmationHandler } =
            await import("./features/auth/neon-auth-magic-link");
          return createMagicLinkConfirmationHandler({
            neonAuthUrl: authUrl.trim(),
            cookieSecret: cookieSecret.trim(),
          })(request);
        }

        if (isMagicLinkWebhook) {
          const resendApiKey =
            (typeof runtimeEnv.RESEND_API_KEY === "string"
              ? runtimeEnv.RESEND_API_KEY
              : process.env.RESEND_API_KEY) ?? "";
          const resendFrom =
            (typeof runtimeEnv.RESEND_FROM === "string"
              ? runtimeEnv.RESEND_FROM
              : process.env.RESEND_FROM) ?? "Kossilon Hub <auth@fimmick.com>";
          if (!resendApiKey.trim()) throw new Error("RESEND_API_KEY is required.");

          const { createNeonMagicLinkWebhookHandler } =
            await import("./features/auth/neon-auth-magic-link");
          return createNeonMagicLinkWebhookHandler({
            neonAuthUrl: authUrl.trim(),
            cookieSecret: cookieSecret.trim(),
            resendApiKey: resendApiKey.trim(),
            resendFrom: resendFrom.trim(),
          })(request);
        }

        return createNeonAuthProxy({
          baseUrl: authUrl.trim(),
        })(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
