# Google Sign-In Setup Runbook

> Written for whoever administers the Neon Auth and Google Cloud dashboards.
> **No developer access required.** Steps 1–3 are one-time; step 4 recurs on
> credential rotation.

## Prerequisites

- Access to the Neon Auth project dashboard for this deployment.
- Access to (or the ability to create) a Google Cloud project.
- The production origin(s) this app is served from — you will need each one's
  exact `https://<origin>/api/auth/callback/google` for the redirect URI list.

## One-time setup

**Step 1 — Create the Google OAuth client.** In Google Cloud Console, under
APIs & Services → Credentials, create an OAuth 2.0 Client ID of type
**Web application**. Add every environment's callback URL to *Authorized
redirect URIs* — production, and any preview/demo origin that needs Google
sign-in:

```
https://<production-origin>/api/auth/callback/google
```

Record the Client ID and Client Secret. Treat the secret as a password.

**Step 2 — Configure the provider in Neon Auth.** In the Neon Auth project
dashboard, find the social/OAuth provider configuration and add Google, using
the Client ID and Secret from Step 1. Do not enter these values anywhere in
this repository, in Worker `vars`, or in `wrangler.template.jsonc` — they live
only in the Neon Auth dashboard, exactly like the WhatsApp channel secret lives
only in the WOZTELL dashboard (see `docs/runbooks/`).

**Step 3 — Confirm the round trip once, by hand.** Before relying on this in
production, complete a real Google sign-in against the deployed app using an
account that already has a `users` row and a `staff_profiles` row (invite-only
enforcement refuses everything else — this is intentional, not a bug to work
around here). Confirm you land signed in. If the callback fails with a
state/CSRF-shaped error instead, see the "Before you start" section of
`docs/superpowers/plans/2026-08-16-login-magic-link-google-auth.md` for the
two most likely causes and their fixes.

## Recurring operations

**Rotating the Google client secret.** Generate a new secret in Google Cloud
Console, update it in the Neon Auth dashboard, confirm a sign-in succeeds, then
delete the old secret in Google Cloud Console. Do this promptly if the secret
is believed to be leaked — unlike the WOZTELL channel secret, Google secrets
can be rotated without recreating the OAuth client or changing the redirect
URIs.

**Adding a new origin (a preview deployment, a new production domain).** Add
its `/api/auth/callback/google` to the Google Cloud OAuth client's authorised
redirect URIs (Step 1). Nothing on the Neon Auth side needs to change — the
provider configuration is not origin-specific.

## Configuring Resend for production magic link

Magic link delivery uses Resend, configured as:

- `RESEND_API_KEY` — a Worker **secret**, set via:
  ```bash
  wrangler secret put RESEND_API_KEY
  ```
  Not a plain `vars` entry, and not templated in `wrangler.template.jsonc` —
  same pattern as `NEON_AUTH_COOKIE_SECRET` and the WOZTELL access token.
- `RESEND_FROM` — a plain sender address, templated in
  `wrangler.template.jsonc`'s `vars` alongside `EMAIL_FROM`.

**Neither is checked as strictly as the other bindings this app depends on —
know the actual guarantee before relying on it:**

- Running `npm run verify:firm -- --dry-run` before a deploy prints both names
  in its report, as a reminder of what a live deployment needs. This is
  informational only; the dry run does not read real values and does not fail
  the check if either is unset.
- `RESEND_API_KEY` genuinely fails loudly, but only lazily — `src/server.ts`
  throws the first time a Neon Auth magic-link webhook actually arrives with no
  key configured, not at deploy time.
- `RESEND_FROM` does **not** fail at all if unset. `src/server.ts` silently
  falls back to a hardcoded sender address. If you want a different sender,
  you must set this explicitly; nothing will tell you if you forget.

An earlier draft of this work routed both through `getFirmRuntimeEnv()`, the
same all-or-nothing readiness check every other binding above goes through.
Code review caught that this would have broken WhatsApp dispatch and document
storage for any firm not yet holding Resend credentials — those features read
`getFirmRuntimeEnv()` too, for entirely unrelated fields, and would have failed
alongside it. The fix was to keep Resend's presence out of that shared gate
entirely, which is why the checks above are weaker than the rest of this
runbook's bindings. Do not silently "fix" this weaker guarantee by
re-coupling Resend to `getFirmRuntimeEnv()` — see the comments in
`src/server/runtime-env.ts` and `scripts/verify-firm-deployment.ts` for why.

## Open risks to record here

- **Account linking.** If a `users` row already exists for an email and someone
  signs in with Google using that same address, better-auth links the sign-in
  to the existing account. Under invite-only enforcement this is intended — it
  is the same person, and Google has verified the email — but it was not
  independently re-confirmed against this specific Neon Auth project's exact
  linking behaviour; do so if account-confusion reports ever surface.
- **No self-service access request flow exists.** An account with no `users`
  row is refused outright with an on-screen message. Provisioning access is an
  administrator action performed directly against the database, as it is for
  every other sign-in method today.
