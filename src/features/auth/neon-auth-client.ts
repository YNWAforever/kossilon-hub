import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";

const NEON_AUTH_SESSION_VERIFIER = "neon_auth_session_verifier";

function getRequestUrl(url: string | URL): URL {
  return typeof url === "string" ? new URL(url) : url;
}

function isGetSessionRequest(url: string | URL): boolean {
  return getRequestUrl(url).pathname.endsWith("/get-session");
}

function currentSessionVerifier(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(NEON_AUTH_SESSION_VERIFIER);
}

function clearSessionVerifier(): void {
  if (typeof window === "undefined") return;

  const callbackUrl = new URL(window.location.href);
  if (!callbackUrl.searchParams.has(NEON_AUTH_SESSION_VERIFIER)) return;

  callbackUrl.searchParams.delete(NEON_AUTH_SESSION_VERIFIER);
  history.replaceState(history.state, "", callbackUrl.href);
}

export function createNeonAuthClient(url: string, appOrigin = window.location.origin) {
  const normalizedUrl = new URL(url);
  const normalizedOrigin = new URL(appOrigin);

  if (normalizedUrl.protocol !== "https:") {
    throw new Error("Neon Auth URL must use HTTPS.");
  }
  if (normalizedOrigin.protocol !== "https:") {
    throw new Error("Application origin must use HTTPS.");
  }

  return createAuthClient({
    baseURL: `${normalizedOrigin.toString().replace(/\/$/, "")}/api/auth`,
    fetchOptions: {
      onRequest(context) {
        if (!isGetSessionRequest(context.url)) return context;

        const verifier = currentSessionVerifier();
        if (!verifier) return context;

        const requestUrl = getRequestUrl(context.url);
        requestUrl.searchParams.set(NEON_AUTH_SESSION_VERIFIER, verifier);
        return { ...context, url: requestUrl };
      },
      onSuccess(context) {
        if (isGetSessionRequest(context.request.url)) clearSessionVerifier();
      },
    },
    plugins: [magicLinkClient()],
  });
}

export type NeonAuthClient = ReturnType<typeof createNeonAuthClient>;
