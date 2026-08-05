import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = new URL(request.url).pathname;
      const isAuthProxyRequest = pathname.startsWith("/api/auth/");
      const isMagicLinkWebhook = pathname === "/api/webhooks/neon-auth";
      const isMagicLinkConfirmation = pathname === "/auth/magic-link/confirm";

      // WOZTELL authenticates with an HMAC over the raw body rather than a session,
      // so inbound WhatsApp lands here instead of on a server function.
      if (pathname === WHATSAPP_WEBHOOK_PATH) {
        const [{ createWhatsAppWebhookHandler }, { getWhatsAppWebhookConfig }, { createWhatsAppRepository }] =
          await Promise.all([
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
