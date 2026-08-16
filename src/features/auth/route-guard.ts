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

export function isPublicRoute(pathname: string): boolean {
  return pathname === "/login";
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
    path === "/login" ||
    path.startsWith("/login?") ||
    path.startsWith("/login#")
  ) {
    return "/";
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

export function consumeRedirectPath(storage = browserStorage()): string {
  if (!storage) return "/";

  try {
    const path = getSafeRedirectPath(storage.getItem(AUTH_REDIRECT_STORAGE_KEY));
    storage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
    return path;
  } catch {
    return "/";
  }
}
