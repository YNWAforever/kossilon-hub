# Login: production magic link and Google sign-in — design

**Date:** 16 August 2026
**Status:** approved, ready for an implementation plan
**Scope:** `/login` gains two additional sign-in methods. Authorisation is unchanged.

---

## 1. What this is

`/login` currently offers email + password to everyone, and an email magic link only in demo mode. This design adds Google sign-in and makes magic link available in production, on the same single login page, for every user.

**Nothing about authorisation changes.** `staff_profiles` and `client_company_memberships` remain the only source of access. A new sign-in method proves *who you are*; it never decides *what you may see*.

### Findings that shaped this design

Three things were established by reading the code, and they make the work smaller than the request implies:

1. **Magic link is already built.** `src/features/auth/neon-auth-magic-link.ts` (with tests), the `/auth/magic-link/confirm` branch in `src/server.ts:102`, the `magicLinkClient()` plugin in `neon-auth-client.ts:57`, Resend as the sender, and working UI in `src/routes/login.tsx`. It is hidden in production by a demo-only gate, nothing more.

2. **The `Forbidden` / `Unauthorized` distinction already exists on the server.** `requireActor` throws `"Unauthorized: a verified Neon Auth session is required."` when there is no session, and `"Forbidden: user is not provisioned with an active company membership."` when there is a session but no profile. No new server-side error handling is needed — only a caller that reads the difference.

3. **Google does not exist in any form.** An early grep appeared to find OAuth references; they were false positives matching the substring in `isDem`**`oAuth`**`Enabled`. The better-auth client registers only `magicLinkClient()`.

### Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Magic link in production? | Yes — enable for real sign-in |
| How does a Google identity map to a person? | **Invite-only.** Sign-in succeeds only if a `users` row and profile already exist |
| Who sees the new methods? | Everyone on `/login` — one page, no new routes |
| Keep password? | Yes. Adding methods, not replacing them |
| Google implementation? | better-auth social sign-in through the existing auth proxy |

---

## 2. Magic link — production enablement

`src/routes/login.tsx:24-29` currently gates the feature:

```ts
function isDemoMagicLinkEnabled(): boolean {
  return (
    import.meta.env.VITE_ENABLE_NEON_AUTH_DEMO === "true" &&
    import.meta.env.VITE_PROVIDER_MODE === "simulated"
  );
}
```

This is replaced by a check meaning *"is a real Neon Auth backend in play"* — that is, the inverse of demo auth. `isDemoAuthEnabled()` already exists in `src/features/auth/route-guard.ts:17` and is the same predicate `AuthProvider` uses at `auth-context-neon.tsx:44` to choose between the demo and Neon providers, so the login page should read from it rather than re-deriving the condition from `import.meta.env`. Magic link is offered whenever auth is **not** in demo mode; the existing demo-simulated path keeps its current behaviour so demo sign-in is unaffected.

The send-and-confirm flow itself does not change: it is already implemented and tested.

**The production dependency is configuration, not code.** Magic link sends through Resend, and `RESEND_API_KEY` / `RESEND_FROM` are **absent from `REQUIRED_BINDINGS`** in `src/server/runtime-env.ts:27-40` and from `wrangler.template.jsonc`. Only `EMAIL_FROM` is required, and the roadmap records that it is consumed by nothing. Enabling magic link without adding those two bindings produces the same silent-failure class as the SLA escalation emails in roadmap P0-6: the app starts, the button appears, and no email is ever delivered.

The implementation plan must therefore add `RESEND_API_KEY` and `RESEND_FROM` to `REQUIRED_BINDINGS` and to `wrangler.template.jsonc`, so a misconfigured deployment fails loudly at startup rather than quietly at send time.

---

## 3. Google sign-in

### Flow

1. User clicks **Continue with Google** on `/login`.
2. Client calls better-auth's `signIn.social({ provider: "google", callbackURL })`. Social sign-in is core to better-auth, not a plugin — no new dependency and no change to `neon-auth-client.ts`'s plugin list.
3. The redirect to Google, and the callback at `/api/auth/callback/google`, both travel through the existing proxy in `src/features/auth/neon-auth-proxy.ts`. **No proxy change is required** — it already permits `GET`, forwards the `location` response header, and uses `redirect: "manual"`, which is exactly what an OAuth round trip needs.
4. Neon Auth completes the exchange and issues a session.
5. The app resolves an actor. Invite-only enforcement happens here — see §4.

### Where the secrets live

Google's client ID and secret are configured **on the Neon Auth backend**, exactly as the magic-link sender is. They do not enter this repository, `REQUIRED_BINDINGS`, or `wrangler.template.jsonc`. This follows the codebase's existing rule that validators report binding *names* only and perform no network calls.

### Dashboard configuration

One-time, non-developer work, to be captured in a runbook alongside the WOZTELL one:

- Enable the Google provider on the Neon Auth project.
- Create a Google Cloud OAuth client (Web application).
- Set the authorised redirect URI to the app's `/api/auth/callback/google` on each origin that needs it (production, and preview if wanted).
- Record which Google Cloud project owns the credentials, and who can rotate them.

---

## 4. Invite-only enforcement and the rejection path

### The problem

`src/routes/__root.tsx:126-131` catches **every** actor-resolution failure identically:

```ts
try {
  actor = await getAuthenticatedActor();
} catch {
  const redirectPath = getSafeRedirectPath(location.href);
  rememberRedirectPath(redirectPath);
  throw redirect({ /* to /login */ });
}
```

A bare `catch` cannot tell "you are not signed in" from "you are signed in but have no access". With invite-only Google, the second case becomes common — and today it renders as a silent loop: the user signs in with Google, it genuinely succeeds, they are redirected into the app, no actor resolves, and they are bounced back to `/login` with **no message and no indication anything happened**. They will try again, and it will fail the same way.

### The fix

Branch on the prefix the server already throws:

| Server throws | Meaning | Client behaviour |
|---|---|---|
| `Unauthorized: …` | No valid session | Redirect to `/login` — unchanged from today |
| `Forbidden: …` | Valid session, no profile | Sign the session out, return to `/login` in an explicit **denied** state |

The denied state tells the user plainly that the account authenticated but has no access, and that an administrator must grant it. Signing the session out matters: leaving a valid-but-useless session in place is what produces the loop.

This also correctly covers cases that have nothing to do with Google — a **deactivated** staff member, or a client whose membership was revoked, both currently get the same silent bounce.

### What is deliberately not built

No self-service request-access flow, no invitation emails, no auto-provisioning. An administrator creates the `users` row and profile out of band, as today. YAGNI until there is evidence it is needed.

---

## 5. Testing

| Area | Test | Runs without a DB |
|---|---|---|
| Magic-link gate | Shows in production config; hidden when the auth backend is unconfigured; still shows in demo-simulated | yes |
| Error classification | `Forbidden:` and `Unauthorized:` route to different outcomes; an unrecognised error is treated as `Unauthorized` (fail closed) | yes |
| Login page render | All three methods present; Google button present and labelled | yes |
| Denied state | Renders the no-access message and offers sign-out; does not loop | yes |
| Required bindings | `RESEND_API_KEY` / `RESEND_FROM` are required and reported by name when missing | yes |

Existing patterns to follow: `src/routes/-login.interaction.test.tsx` for interaction, `src/features/auth/neon-auth-server.test.ts` for actor resolution, and `src/server/runtime-env.ts`'s existing binding tests.

**The OAuth round trip itself cannot be meaningfully unit-tested** — it depends on Google and on Neon Auth. It is covered by the acceptance checks in §7, not by the suite. Do not write a mock that asserts our own mock's behaviour and call it coverage; that is precisely the failure mode that let the WOZTELL wire contract ship broken with 87 passing tests.

---

## 6. Risks

**The Neon Auth dependency is unverified.** Everything in §3 assumes the Neon Auth project can be configured with a Google provider. This could not be confirmed from the repository — the app is only a proxy to `NEON_AUTH_URL`. If that backend has no social-provider support, no application code fixes it, and the options become hand-rolling OAuth in the Worker (significant security-critical code) or shipping the magic-link half alone.

**The implementation plan must front-load this as its first task**, before any client code is written, so it fails fast rather than after the UI is built.

**Account linking.** If a `users` row exists for an email and someone signs in with Google using that same email, better-auth links them. Under invite-only that is the intended behaviour — it is the same person — and Google always verifies email ownership. Worth confirming Neon Auth's linking behaviour during the verification task rather than assuming it.

---

## 7. Acceptance

Unit tests prove the wiring. They cannot prove Google works. Before this is trusted:

1. A staff member with an existing `users` row signs in with Google and lands in the app with the correct role.
2. A Google account with **no** `users` row is refused with the explicit no-access message — not a silent bounce, and not a session left signed in.
3. A **deactivated** staff member is refused the same way.
4. A magic link sent in production is received and signs the user in.
5. A client-portal user signs in with Google and sees only their own companies — proving the new method grants no additional access.

---

## 8. Out of scope

Self-service access requests, invitation emails, auto-provisioning, additional providers (Microsoft, Apple), MFA, session-length changes, and the `users.role` vocabulary inconsistency recorded as roadmap P3-9.
