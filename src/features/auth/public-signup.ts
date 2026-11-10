/**
 * Invite-only pilot guard.
 *
 * Neon Auth exposes Better Auth's public sign-up endpoints. The product contract is
 * request access -> admin invite, so an account must never be creatable by calling
 * the auth proxy directly. Sign-in, magic-link sign-in, password reset and admin
 * endpoints are deliberately not matched here.
 */
const PUBLIC_SIGNUP_PREFIX = "/api/auth/sign-up";

export function isPublicSignupPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized === PUBLIC_SIGNUP_PREFIX || normalized.startsWith(PUBLIC_SIGNUP_PREFIX + "/");
}

export function publicSignupDisabledResponse(): Response {
  return new Response(
    JSON.stringify({
      code: "SIGNUP_DISABLED",
      message: "This workspace is invite-only. Ask the firm to invite you.",
    }),
    {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
