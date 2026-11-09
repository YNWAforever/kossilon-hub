import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { PRODUCT_NAME } from "./lib/brand";
import { renderErrorPage } from "./lib/error-page";
import {
  createMemoryRateLimiter,
  isRateLimitedAuthRequest,
  rateLimitKey,
  rateLimitResponse,
} from "./features/auth/rate-limit";
import { applySecurityHeaders, resolveSecurityHeaderMode } from "./server/security-headers";

// Per-instance speed bump for auth POSTs (see rate-limit.ts for the limits of
// that guarantee). 30 requests per five minutes per client IP.
const authRateLimiter = createMemoryRateLimiter({ limit: 30, windowMs: 5 * 60_000 });

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

function securityInput(): {
  mode: ReturnType<typeof resolveSecurityHeaderMode>;
  isProduction: boolean;
} {
  return {
    mode: resolveSecurityHeaderMode(process.env.SECURITY_HEADERS),
    isProduction: process.env.VERCEL_ENV === "production",
  };
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
 * The other half of the five-minute cron trigger in `wrangler.template.jsonc`.
 *
 * Without this export the Worker only ever answered `fetch`, so the 5-minute
 * trigger had nothing to invoke: SLA escalations were never evaluated, the
 * notification outbox was only dispatched as a side effect of a staff member
 * sending a follow-up, and expired upload intents were never reclaimed.
 *
 * `runFirmMaintenance` is actor-free by design — a scheduler has no request to
 * derive an actor from — and is imported lazily so a `fetch` cold start does not
 * pull the database client in.
 */
type MaintenanceRunner = (input: {
  now: string;
  triggerSource: "scheduled" | "manual";
  runId: string;
}) => Promise<unknown>;

const defaultMaintenanceRunner: MaintenanceRunner = async (input) => {
  const { runRuntimeMaintenanceTick, SAFE_SCHEDULED_JOBS } =
    await import("./server/maintenance-trigger-runtime");
  return runRuntimeMaintenanceTick({
    trigger: input.triggerSource ?? "manual",
    triggerEvidence: input.triggerSource === "scheduled" ? "native-hook" : "manual",
    scheduledAt: input.now,
    runId: input.runId,
    allowedJobs: [...SAFE_SCHEDULED_JOBS],
  });
};

/**
 * `run` is injectable so a test can assert the wiring without executing it. That
 * matters more than it sounds: this function dispatches notifications, deletes R2
 * objects and rewrites outbox rows, and it resolves its own bindings from the
 * environment. A test that called it for real would do all of that against
 * whatever DATABASE_URL happened to be in scope — a developer's .env, or CI's.
 */
export async function runScheduledMaintenanceForWorker(
  scheduledTime: number,
  run: MaintenanceRunner = defaultMaintenanceRunner,
  owner: unknown = process.env.MAINTENANCE_SCHEDULER_OWNER,
): Promise<void> {
  if (owner !== "cloudflare") {
    console.log("scheduled maintenance skipped", {
      owner: owner === "vercel" ? "vercel" : "paused",
      source: "cloudflare",
    });
    return;
  }
  const runId = crypto.randomUUID();
  try {
    // This caller is reached by Nitro's platform scheduled hook. Acceptance
    // still correlates its durable evidence with the platform invocation logs.
    const result = await run({
      now: new Date(scheduledTime).toISOString(),
      triggerSource: "scheduled",
      runId,
    });
    console.log("scheduled maintenance", { runId, recorded: result != null });
  } catch (error) {
    // Per-job evidence remains in the durable registry. Logging a thrown value
    // here could expose a provider payload or database URL.
    console.error("scheduled maintenance failed", { runId, phase: "start_or_record" });
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

      if (isRateLimitedAuthRequest(request)) {
        const decision = authRateLimiter.consume(rateLimitKey(request));
        if (!decision.allowed) return rateLimitResponse(decision.retryAfterSeconds);
      }

      // Public SEO documents: generated per request from the request origin so a
      // preview, the demo host and production each advertise themselves rather
      // than a hardcoded canonical URL.
      if (request.method === "GET" && (pathname === "/robots.txt" || pathname === "/sitemap.xml")) {
        const { robotsTxt, sitemapXml } = await import("./features/marketing/seo");
        const origin = new URL(request.url).origin;
        const isSitemap = pathname === "/sitemap.xml";
        return new Response(isSitemap ? sitemapXml(origin) : robotsTxt(origin), {
          headers: {
            "content-type": isSitemap
              ? "application/xml; charset=utf-8"
              : "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }

      // Public deployment identity: which commit is live and in which data mode.
      // Used by the post-deploy smoke job and by anyone answering "what is live?".
      if (request.method === "GET" && pathname === "/api/version") {
        const [{ buildDeploymentVersion }, { currentDataMode }] = await Promise.all([
          import("./server/version"),
          import("./features/runtime/data-mode"),
        ]);
        const runtimeEnv = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
        const merged = { ...process.env, ...runtimeEnv };
        const version = buildDeploymentVersion({
          env: Object.fromEntries(
            Object.entries(merged).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          dataMode: currentDataMode(),
        });
        return new Response(JSON.stringify(version), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      // Secret-free runtime health: app up + maintenance tick alive. A 503 here
      // is what the scheduled smoke job alerts on.
      if (pathname === "/api/health") {
        const [{ createHealthHttpHandler }, { createMaintenanceRunRepository }] = await Promise.all(
          [import("./features/operations/health-http"), import("./features/operations/repository")],
        );
        return createHealthHttpHandler({
          now: () => new Date(),
          readMaintenance: async () => {
            const repository = createMaintenanceRunRepository();
            try {
              const [runs, candidateRuns, lastScheduledSuccessAt, database] = await Promise.all([
                repository.listRecentScheduledRuns(),
                repository.listRecentScheduledCandidates(),
                repository.lastScheduledSuccessAt(),
                repository.databaseIdentity(),
              ]);
              return { runs, candidateRuns, lastScheduledSuccessAt, database };
            } finally {
              await repository.close();
            }
          },
        })(request);
      }

      // Honest, secret-free capability status: which integrations this deployment
      // is actually provisioned for. Anything false here must not look enabled.
      if (request.method === "GET" && pathname === "/api/capabilities") {
        const { runtimeCapabilities } = await import("./server/capabilities-http");
        const runtimeEnv = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
        const merged = { ...process.env, ...runtimeEnv };
        const payload = runtimeCapabilities(
          Object.fromEntries(
            Object.entries(merged).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
        );
        return new Response(JSON.stringify(payload), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (pathname === "/api/handoffs/export") {
        const [{ createHandoffExportHttpHandler }, { buildHandoffExportForRequest }] =
          await Promise.all([
            import("./server/handoff-export-http"),
            import("./features/annual-return/handoff-server-fns"),
          ]);
        return createHandoffExportHttpHandler(buildHandoffExportForRequest)(request);
      }
      if (pathname === "/api/cron/maintenance") {
        const [{ createMaintenanceHttpHandler }, { runRuntimeMaintenanceTick }] = await Promise.all(
          [import("./server/maintenance-http"), import("./server/maintenance-trigger-runtime")],
        );
        const runtimeEnv = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
        return createMaintenanceHttpHandler({
          env: { ...process.env, ...runtimeEnv },
          run: runRuntimeMaintenanceTick,
        })(request);
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
              : process.env.RESEND_FROM) ?? `${PRODUCT_NAME} <auth@fimmick.com>`;
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
      return applySecurityHeaders(
        await normalizeCatastrophicSsrResponse(response),
        securityInput(),
      );
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        securityInput(),
      );
    }
  },
};
