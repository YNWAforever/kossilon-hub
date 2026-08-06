/**
 * The one place that decides which cookies may leave this Worker for the Neon
 * Auth origin.
 *
 * The proxy has always filtered by prefix, but `createNeonSessionAdapter` forwarded
 * `request.headers.get("cookie")` wholesale — so every cookie the app holds,
 * auth-related or not, was sent to an external host on every session lookup. Both
 * paths share this now, so the allowlist cannot drift between them.
 */
export const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";

export function neonAuthCookies(cookieHeader: string | null): string {
  if (!cookieHeader) return "";

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(NEON_AUTH_COOKIE_PREFIX))
    .join("; ");
}
