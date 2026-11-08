/**
 * Which sign-in methods a build exposes.
 *
 * `login.tsx` used to derive magic-link visibility from `!isDemoAuthEnabled()`,
 * which is true in every production build — so the documented "production is
 * password-only" contract could not be honoured and Google/invite were
 * unconditional. An explicit, comma-separated `VITE_AUTH_METHODS` makes the
 * choice a deployment decision while keeping today's UI when it is unset.
 *
 * Default (unset/empty): password + magic link + Google. Password stays always
 * enabled because a build with no password form has no working login at all;
 * `password` in the list is accepted for readability but does not disable it.
 */
export type AuthMethods = {
  password: boolean;
  magicLink: boolean;
  google: boolean;
};

const DEFAULT_METHODS: AuthMethods = { password: true, magicLink: true, google: true };

export function authMethodsFor(raw: string | undefined): AuthMethods {
  if (raw == null || raw.trim() === "") return DEFAULT_METHODS;

  const enabled = new Set(
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );

  // A list with no recognised token is a configuration typo, not "disable
  // everything": keep the default set rather than locking the firm out.
  if (!["password", "magic-link", "google"].some((method) => enabled.has(method))) {
    return DEFAULT_METHODS;
  }

  return {
    password: true,
    magicLink: enabled.has("magic-link"),
    google: enabled.has("google"),
  };
}
