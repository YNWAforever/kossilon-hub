import { resolveDataMode } from "../runtime/data-mode";

export const AUTH_REDIRECT_STORAGE_KEY = "kossilon.auth.redirect.v1";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isDemoAuthEnabled(
  value = import.meta.env.VITE_ENABLE_DEMO_AUTH,
  isProductionBuild = import.meta.env.PROD,
): boolean {
  return (
    resolveDataMode({
      demoEnabled: value === "true",
      isProductionBuild,
    }) === "demo"
  );
}

export function isMarketingRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/en";
}

export function isPublicRoute(pathname: string): boolean {
  return isMarketingRoute(pathname) || pathname === "/login" || pathname === "/en/login";
}

/**
 * Routes that can render on the server: public marketing documents and the login
 * shell. Every other route keeps the client-only staff/auth lifecycle.
 */
export function isServerRenderable(pathname: string): boolean {
  return isMarketingRoute(pathname) || isPublicRoute(pathname);
}

/**
 * The routes a Client actor can actually use. /portal is theirs; /documents
 * authorises Client actors explicitly through requireClientCompanyAccess. Every
 * other screen resolves a staff actor and would refuse them on every query.
 */
const CLIENT_ROUTES = ["/portal", "/documents"] as const;

export function isClientRoute(pathname: string): boolean {
  return CLIENT_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * requireActor throws a `Forbidden:`-prefixed error for a session that
 * authenticates but has no staff_profiles/client_company_memberships row, and
 * `Unauthorized:` for no session at all. beforeLoad needs to tell them apart —
 * bouncing both to the same "sign in again" redirect meant a provisioned-nowhere
 * account got no explanation and would fail identically on every retry.
 */
export function isForbiddenAuthError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Forbidden:");
}

/**
 * Backslashes and control characters. Browsers normalise "\\" to "/" when parsing
 * a URL and strip control characters before parsing, so "/\\evil.com" and
 * "/\tevil.com" both reassemble into the protocol-relative "//evil.com" that the
 * startsWith("//") check rejects.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_REDIRECT_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

export function getSafeRedirectPath(path: string | null): string {
  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    UNSAFE_REDIRECT_CHARACTERS.test(path) ||
    isPublicRoute(path.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/")
  ) {
    return "/dashboard";
  }

  return path;
}

export function rememberRedirectPath(path: string, storage = browserStorage()): void {
  if (!storage) return;

  try {
    storage.setItem(AUTH_REDIRECT_STORAGE_KEY, getSafeRedirectPath(path));
  } catch {
    // Redirect memory is optional; navigation should continue if storage is unavailable.
  }
}

export function consumeRedirectPath(storage = browserStorage(), fallback = "/dashboard"): string {
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(AUTH_REDIRECT_STORAGE_KEY);
    const path = raw && getSafeRedirectPath(raw) === raw ? raw : fallback;
    storage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
    return path;
  } catch {
    return fallback;
  }
}

/**
 * Read the remembered target without consuming it.
 *
 * Safe to call before sign-in: the redirect effect still owns consumption and
 * the role-based fallback. Used to carry a deep link into the magic-link
 * callback, where the email opens a new tab and sessionStorage is empty.
 */
export function peekRedirectPath(storage = browserStorage()): string | undefined {
  if (!storage) return undefined;

  try {
    const raw = storage.getItem(AUTH_REDIRECT_STORAGE_KEY);
    if (!raw) return undefined;
    const path = getSafeRedirectPath(raw);
    return path === "/" ? undefined : path;
  } catch {
    return undefined;
  }
}

/**
 * Callback URL for a magic-link request.
 *
 * Neon Auth returns the browser here after the one-time verification. Carrying
 * the target in the query keeps a deep link across the new tab the email
 * normally opens; unsafe or absent targets fall back to the plain `/login`.
 */
export function magicLinkCallback(origin: string, redirect?: string | null): string {
  const target =
    redirect && getSafeRedirectPath(redirect) === redirect && redirect !== "/"
      ? redirect
      : undefined;
  return `${origin}/login${target ? `?redirect=${encodeURIComponent(target)}` : ""}`;
}
