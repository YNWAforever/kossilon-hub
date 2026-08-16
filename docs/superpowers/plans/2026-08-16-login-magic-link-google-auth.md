# Login: Production Magic Link and Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google sign-in and enable magic link in production on the existing `/login` page, with authorisation unchanged — an account not already provisioned in `staff_profiles`/`client_company_memberships` is refused with an explicit message instead of a silent bounce.

**Architecture:** Google sign-in uses better-auth's core `signIn.social` (not a plugin) through the existing `/api/auth/*` same-origin proxy — no new dependency, no proxy routing change. Magic link's demo-only gate is replaced with the same "is this a real Neon Auth backend" check `AuthProvider` already uses to choose its provider. Invite-only enforcement needs no new server code — `requireActor` already throws a `Forbidden:`-prefixed error for an authenticated-but-unprovisioned account — the gap is that `__root.tsx`'s `beforeLoad` catches it identically to "not signed in at all" and bounces to `/login` with no explanation. This plan makes that distinction visible and adds the two sign-in methods.

**Tech Stack:** better-auth 1.6.23 (`createAuthClient`, core `signIn.social`/`signIn.email`, `magicLinkClient()` plugin), TanStack Start/Router, React 19, Vitest, jsdom.

---

## Before you start: one unresolved external risk

Everything in Task 1 depends on facts about the *deployed* Neon Auth backend that cannot be determined by reading this repository. Task 1 is a **live verification task**, not a coding task, and it must be completed — with a clear pass or fail outcome — before Task 5 (the Google client code) is started. If Task 1 fails, its two contingency fixes are written out in full below; apply the one that matches what you observe, then continue.

### Why this is the load-bearing risk

`src/features/auth/neon-auth-cookies.ts` defines the **only** allowlist used in both directions between this Worker and the Neon Auth backend:

```typescript
export const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";

export function neonAuthCookies(cookieHeader: string | null): string {
  if (!cookieHeader) return "";
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(NEON_AUTH_COOKIE_PREFIX))
    .join("; ");
}
```

This is called from `upstreamHeaders()` in `neon-auth-proxy.ts` (browser → Worker → Neon Auth) and from `requestHeaders()` in `neon-auth-server.ts` (server-side session checks). **Any cookie Neon Auth's OAuth implementation might set under a different name — a `state` or PKCE-verifier cookie, for instance — is silently dropped before it ever reaches Neon Auth again on the callback request.** Separately, `neon-auth-proxy.ts`'s `firstPartyCookie()` rewrites every `Set-Cookie` it forwards to force `SameSite=Strict`:

```typescript
function firstPartyCookie(cookieHeader: string): string {
  const attributes = cookieHeader
    .split(";")
    .map((attribute) => attribute.trim())
    .filter(
      (attribute) =>
        !/^domain=/i.test(attribute) &&
        !/^samesite=/i.test(attribute) &&
        !/^partitioned$/i.test(attribute),
    );
  attributes.push("SameSite=Strict");
  return attributes.join("; ");
}
```

Google's redirect back to `/api/auth/callback/google` is a **cross-site top-level navigation** (initiated by accounts.google.com). A `SameSite=Strict` cookie is not sent on that request; `SameSite=Lax` is. If Neon Auth's OAuth callback needs to read back a state/verifier cookie, this rewrite would break it independently of the prefix-allowlist problem above.

Magic link cannot be used as reassurance here — read closely, its cross-site hop (the user clicking the link in their email client) is architected entirely separately in `src/features/auth/neon-auth-magic-link.ts` and never touches `/api/auth/*` or this cookie logic at all. It sets its own bespoke `__Host-kossilon.magic_link_ticket` cookie directly in `server.ts`, and every cross-site leg in that flow is a same-site redirect issued by *this* app to itself, not an inbound cross-site landing from a third party. The two flows share no code path that would make one flow's success predict the other's.

### Contingency fixes, ready to apply if Task 1 finds a problem

**If the callback fails with something like "invalid state", "state not found", or a generic 400** — the prefix allowlist is dropping a cookie Neon Auth needs. Confirm by inspecting the `Set-Cookie` header on the response to `POST /api/auth/sign-in/social` (browser DevTools → Network, before the redirect to Google) for a cookie name that does **not** start with `__Secure-neon-auth`. If you find one, note its exact name and widen the allowlist:

```typescript
// src/features/auth/neon-auth-cookies.ts
export const NEON_AUTH_COOKIE_PREFIXES = ["__Secure-neon-auth", "<observed-prefix>"] as const;

export function neonAuthCookies(cookieHeader: string | null): string {
  if (!cookieHeader) return "";
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => NEON_AUTH_COOKIE_PREFIXES.some((prefix) => cookie.startsWith(prefix)))
    .join("; ");
}
```

Update both call sites' imports if the exported name changes, and update `neon-auth-proxy.test.ts` / `neon-auth-server.test.ts` fixtures accordingly.

**If the callback fails and the state cookie *is* present in the request but still gets rejected** — or if you cannot tell which of the two causes applies — relax the forced encoding in `firstPartyCookie()` from `Strict` to `Lax`:

```typescript
// src/features/auth/neon-auth-proxy.ts — inside firstPartyCookie
attributes.push("SameSite=Lax");
```

`Lax` still blocks the cookie from being sent on cross-site subresource requests and on cross-site POSTs — the two things that matter for CSRF — while permitting it on a top-level GET redirect, which is exactly the OAuth callback case and is the standard justification for `Lax` existing at all. This is not a meaningful weakening of the session cookie's security for a same-site SPA. Update `neon-auth-proxy.test.ts`'s assertion `expect(response.headers.get("set-cookie")).toContain("SameSite=Strict")` to `"SameSite=Lax"` if you make this change.

**If Neon Auth has no Google/social provider configuration surface at all** — stop. Do not proceed to Task 5 or Task 6. Report back; the options at that point are hand-rolling OAuth in the Worker (a much larger, security-critical undertaking) or shipping magic link alone. Do not attempt that redesign as part of this plan.

---

## File structure

| File | Change |
|---|---|
| `src/features/auth/route-guard.ts` | Add `isForbiddenAuthError` |
| `src/features/auth/route-guard.test.ts` | Test it |
| `src/routes/__root.tsx` | Branch `beforeLoad`'s catch on `isForbiddenAuthError` |
| `src/features/auth/auth-context-neon.tsx` | Add `loginWithGoogle` to the context; wire `client.signIn.social` |
| `src/features/auth/auth-context-neon.test.tsx` | Test it |
| `src/routes/login.tsx` | Un-gate magic link; add the Google button; render the denied state |
| `src/routes/-login.interaction.test.tsx` | Rewrite the gating tests; add denied-state and Google tests |
| `src/server/runtime-env.ts` | Add `RESEND_API_KEY`/`RESEND_FROM` to the binding contract |
| `src/server/runtime-env.test.ts` | Test it |
| `scripts/verify-firm-deployment.ts` | Add the same two names to its own binding list |
| `scripts/verify-firm-deployment.test.ts` | Test it |
| `wrangler.template.jsonc` | Add `RESEND_FROM` (not the secret) to `vars` |
| `docs/runbooks/google-signin-setup.md` | **Create.** Dashboard steps for a non-developer |

---

## Task 1: Verify the Google/Neon Auth round trip (live check, no code)

**Files:** none — this is a manual verification against a real deployment, not a code change.

This must run against an actual Neon Auth project with a Google provider configured, in a browser, before Task 5's client code exists. If your organisation has a staging or demo Neon Auth project already (see `docs/runbooks/neon-auth-demo.md`), use that; otherwise this blocks on dashboard access outside this plan's scope.

The account you sign in with in Step 4 must already have a `users` row and an active `staff_profiles` row — invite-only enforcement (`requireActor` in `src/features/auth/neon-auth-server.ts`) refuses everything else by design, including during this check. Use an existing staff member's real email, or insert a test row directly if none is available; do not weaken or bypass `requireActor` to make this check pass.

- [ ] **Step 1: Confirm Neon Auth exposes Google provider configuration**

In the Neon Auth project dashboard, look for a social/OAuth provider section. If Google is not configurable here at all, stop — see "If Neon Auth has no Google/social provider configuration surface at all" above.

- [ ] **Step 2: Configure a test Google OAuth client**

Create a Google Cloud OAuth 2.0 Web application client. Set its authorised redirect URI to `https://<your-test-origin>/api/auth/callback/google`. Enter the client ID and secret into Neon Auth's Google provider configuration.

- [ ] **Step 3: Drive the flow by hand with `curl` and a browser, watching cookies**

From a browser with DevTools Network open, against your test origin:

```bash
curl -i -X POST "https://<your-test-origin>/api/auth/sign-in/social" \
  -H "content-type: application/json" \
  -H "origin: https://<your-test-origin>" \
  -d '{"provider":"google","callbackURL":"/login"}'
```

Expected: `200` with a JSON body `{"url":"https://accounts.google.com/...","redirect":true}`. Inspect the response headers for any `set-cookie` whose name does not start with `__Secure-neon-auth`. Record it if present.

- [ ] **Step 4: Complete a real sign-in in the browser**

Visit your test origin's `/login` (once Task 5's button exists you would click it; for this pre-check, navigate directly to the `url` returned in Step 3). Sign in with Google, using the account described above. Confirm the browser lands back on your app with a valid session (`GET /api/auth/get-session` through the proxy returns your user).

- [ ] **Step 5: Record the outcome**

If Step 4 completes with a valid session: the round trip works as-is. No changes to `neon-auth-cookies.ts` or `neon-auth-proxy.ts` are needed. Proceed to Task 2.

If Step 4 fails with a state/CSRF-shaped error: apply the relevant contingency fix above, then repeat Steps 3–4 to confirm the fix resolves it, before proceeding.

---

## Task 2: Add RESEND bindings to the deployment-readiness contract

**Files:**
- Modify: `src/server/runtime-env.ts:9-38,152-172`
- Modify: `src/server/runtime-env.test.ts`
- Modify: `scripts/verify-firm-deployment.ts:20-31`
- Modify: `scripts/verify-firm-deployment.test.ts`
- Modify: `wrangler.template.jsonc`

### Context

`src/server.ts`'s magic-link-webhook branch already reads `RESEND_API_KEY`/`RESEND_FROM` and throws if `RESEND_API_KEY` is empty — so a live deployment does not silently swallow a missing key; it 500s the moment Neon Auth's first magic-link webhook arrives. What is actually missing is *pre-deploy visibility*: `npm run verify:firm -- --dry-run` (the gate `CLAUDE.md` documents) has no way to tell an operator these two bindings are needed, because `getRuntimeReadiness()`'s `REQUIRED_BINDINGS` array in `runtime-env.ts` doesn't list them, and `scripts/verify-firm-deployment.ts` keeps its own separate copy of that same array (used only to populate the dry-run report's `blockedBindings` field — an audit list of binding *names*, per the existing rule that "validators and verifiers report binding names only, never values"). Both copies need the same two names or they drift.

`docs/runbooks/neon-auth-demo.md` already lists `RESEND_API_KEY` and `RESEND_FROM` among the demo environment's required variables, confirming these are the correct names.

**Do not** route `server.ts`'s existing inline `RESEND_API_KEY`/`RESEND_FROM` reads through `getFirmRuntimeEnv()`. That function throws if *any* required binding is missing, and would wrongly couple the magic-link webhook's readiness to unrelated bindings like `WOZTELL_ACCESS_TOKEN` — the opposite of how `server.ts` already scopes each webhook branch's validation to only what that branch needs (see the WhatsApp branch's `getWhatsAppWebhookConfig()` call, which validates only WOZTELL's webhook secret, not the whole per-firm env). Leave `server.ts` exactly as it is.

`RESEND_API_KEY` is a secret and follows the same pattern as `NEON_AUTH_COOKIE_SECRET`/`WOZTELL_ACCESS_TOKEN`/`WOZTELL_WEBHOOK_SECRET` — all three are **absent** from `wrangler.template.jsonc`'s `vars` block, provisioned instead via `wrangler secret put <NAME>`. `RESEND_FROM` is a plain address string like `EMAIL_FROM`/`WOZTELL_CHANNEL_ID`, which **are** in `vars`. Only `RESEND_FROM` goes in the template.

### Step 1: Write the failing tests

In `src/server/runtime-env.test.ts`, extend `validEnv` (after line 27, the `EMAIL_FROM` entry):

```typescript
    EMAIL_FROM: "operations@example.test",
    RESEND_API_KEY: "test-resend-key",
    RESEND_FROM: "auth@example.test",
```

Extend the "requires one fixed firm id and every production binding" test's expected `missing` array (currently ending `"EMAIL_FROM",`) to:

```typescript
      missing: [
        "NEON_AUTH_URL",
        "NEON_AUTH_COOKIE_SECRET",
        "DATABASE_URL",
        "DOCUMENTS_BUCKET",
        "WOZTELL_API_BASE_URL",
        "WOZTELL_ACCESS_TOKEN",
        "WOZTELL_CHANNEL_ID",
        "WOZTELL_WEBHOOK_SECRET",
        "EMAIL_FROM",
        "RESEND_API_KEY",
        "RESEND_FROM",
      ],
```

Extend the "returns a ready, normalized per-firm runtime" test's `toMatchObject`:

```typescript
    expect(getFirmRuntimeEnv(validEnv)).toMatchObject({
      firmId: "firm-a",
      documentsBucket: fakeR2Bucket,
      emailFrom: "operations@example.test",
      resendApiKey: "test-resend-key",
      resendFrom: "auth@example.test",
    });
```

Extend the "rejects malformed production bindings" test — add `RESEND_FROM: "not-an-email"` to the spread override and `"RESEND_FROM"` to the expected `missing` array (after `"EMAIL_FROM"`):

```typescript
  it("rejects malformed production bindings", () => {
    expect(
      getRuntimeReadiness({
        ...validEnv,
        FIRM_ID: "Firm A!",
        NEON_AUTH_URL: "not-a-url",
        NEON_AUTH_COOKIE_SECRET: "short",
        DOCUMENTS_BUCKET: {},
        EMAIL_FROM: "not-an-email",
        RESEND_FROM: "not-an-email",
      }).missing,
    ).toEqual([
      "FIRM_ID",
      "NEON_AUTH_URL",
      "NEON_AUTH_COOKIE_SECRET",
      "DOCUMENTS_BUCKET",
      "EMAIL_FROM",
      "RESEND_FROM",
    ]);
  });
```

In `scripts/verify-firm-deployment.test.ts`, find the "reports binding names but never values" test (it currently asserts `expect(result.blockedBindings).toContain("WOZTELL_ACCESS_TOKEN")`) and add:

```typescript
    expect(result.blockedBindings).toContain("RESEND_API_KEY");
    expect(result.blockedBindings).toContain("RESEND_FROM");
```

### Step 2: Run the tests to verify they fail

Run: `npm run test -- src/server/runtime-env.test.ts scripts/verify-firm-deployment.test.ts`
Expected: FAIL — `RESEND_API_KEY`/`RESEND_FROM` are not yet in either `REQUIRED_BINDINGS` array, so `missing` won't contain them and `blockedBindings` won't either.

### Step 3: Update `runtime-env.ts`

Add to the `FirmRuntimeEnv` type (after `emailFrom: string;`):

```typescript
  resendApiKey: string;
  resendFrom: string;
```

Add to `REQUIRED_BINDINGS` (after `"EMAIL_FROM",`):

```typescript
  "RESEND_API_KEY",
  "RESEND_FROM",
```

Add a case to `hasBinding`'s switch, alongside the existing `EMAIL_FROM` case:

```typescript
    case "RESEND_FROM":
      return isEmail(env[name]);
```

`RESEND_API_KEY` needs no explicit case — it falls through to the existing `default: return hasText(env[name]);` branch, the same as every other opaque secret with no extra format check.

Add to `getFirmRuntimeEnv`'s return object (after `emailFrom: (env.EMAIL_FROM as string).trim(),`):

```typescript
    resendApiKey: env.RESEND_API_KEY as string,
    resendFrom: (env.RESEND_FROM as string).trim(),
```

### Step 4: Update `scripts/verify-firm-deployment.ts`

Add the same two names to its `REQUIRED_BINDINGS` array (after `"EMAIL_FROM",`, line 30):

```typescript
  "RESEND_API_KEY",
  "RESEND_FROM",
```

### Step 5: Update `wrangler.template.jsonc`

Add `RESEND_FROM` to `vars`, after `EMAIL_FROM`:

```jsonc
    "EMAIL_FROM": "${EMAIL_FROM}",
    "RESEND_FROM": "${RESEND_FROM}",
```

Do **not** add `RESEND_API_KEY` here — it is provisioned via `wrangler secret put RESEND_API_KEY`, documented in Task 7's runbook.

### Step 6: Run the tests

Run: `npm run test -- src/server/runtime-env.test.ts scripts/verify-firm-deployment.test.ts`
Expected: PASS.

### Step 7: Run the wider suite and typecheck

Run: `npm run test -- src/server/ scripts/`
Expected: PASS, no regressions.

Run: `npx tsc --noEmit`
Expected: clean.

### Step 8: Commit

```bash
git add src/server/runtime-env.ts src/server/runtime-env.test.ts scripts/verify-firm-deployment.ts scripts/verify-firm-deployment.test.ts wrangler.template.jsonc
git commit -m "feat(auth): surface RESEND bindings in the pre-deploy readiness gate"
```

---

## Task 3: Distinguish "not signed in" from "signed in but no access"

**Files:**
- Modify: `src/features/auth/route-guard.ts`
- Modify: `src/features/auth/route-guard.test.ts`
- Modify: `src/routes/__root.tsx:119-148`

### Context

`requireActor` in `src/features/auth/neon-auth-server.ts` already throws two distinct, prefixed errors:

- `"Unauthorized: a verified Neon Auth session is required."` — no session at all
- `"Forbidden: user is not provisioned with an active company membership."` — a valid session, but no `staff_profiles`/`client_company_memberships` row

`__root.tsx`'s `beforeLoad` catches both identically today and redirects to `/login` with a `redirect=` query param that will bounce the user right back once they sign in again — which, for the `Forbidden` case, they can do indefinitely, since Google/magic-link sign-in itself will keep succeeding; only the *authorisation* step fails, silently, every time.

There is no existing test harness for `beforeLoad` in this codebase (no `__root`-focused test file). Rather than build a brittle router mock that doesn't verify real behaviour, this task unit-tests the pure classifier function and leaves the `beforeLoad` wiring itself to be exercised by the Task 4 login-page test (which drives the denied state the redirect leads to) and the live acceptance checks in this plan's final task.

### Step 1: Write the failing test

Add to `src/features/auth/route-guard.test.ts`:

```typescript
describe("isForbiddenAuthError", () => {
  it("recognizes a Forbidden-prefixed error", () => {
    expect(isForbiddenAuthError(new Error("Forbidden: user is not provisioned."))).toBe(true);
  });

  it("does not treat Unauthorized as Forbidden", () => {
    expect(isForbiddenAuthError(new Error("Unauthorized: a session is required."))).toBe(false);
  });

  it("fails closed on anything that is not an Error with the prefix", () => {
    expect(isForbiddenAuthError("Forbidden: not an Error instance")).toBe(false);
    expect(isForbiddenAuthError(null)).toBe(false);
    expect(isForbiddenAuthError(undefined)).toBe(false);
    expect(isForbiddenAuthError(new Error("some other failure"))).toBe(false);
  });
});
```

Add `isForbiddenAuthError` to the import list at the top of the file (it currently imports `isClientRoute, AUTH_REDIRECT_STORAGE_KEY, consumeRedirectPath, isPublicRoute, rememberRedirectPath, isDemoAuthEnabled, getSafeRedirectPath` from `"./route-guard"`).

### Step 2: Run the test to verify it fails

Run: `npm run test -- src/features/auth/route-guard.test.ts -t "isForbiddenAuthError"`
Expected: FAIL — `isForbiddenAuthError is not a function`.

### Step 3: Implement it

Add to `src/features/auth/route-guard.ts`, after `isClientRoute`:

```typescript
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
```

### Step 4: Run the test to verify it passes

Run: `npm run test -- src/features/auth/route-guard.test.ts`
Expected: PASS, all cases including the pre-existing ones in the file.

### Step 5: Wire it into `beforeLoad`

In `src/routes/__root.tsx`, add `isForbiddenAuthError` to the existing import from `"@/features/auth/route-guard"` (currently `getSafeRedirectPath, isClientRoute, isPublicRoute, rememberRedirectPath`).

Replace the `catch` block inside `beforeLoad` (currently lines 128-135):

```typescript
      } catch {
        const redirectPath = getSafeRedirectPath(location.href);
        rememberRedirectPath(redirectPath);
        throw redirect({
          href: `/login?redirect=${encodeURIComponent(redirectPath)}`,
          replace: true,
        });
      }
```

with:

```typescript
      } catch (error) {
        // A Forbidden account is not "not signed in" — sending it through the
        // same redirect=... path would bounce it back here after every future
        // sign-in, identically and silently, since the sign-in step itself keeps
        // succeeding. Only the authorisation check fails.
        if (isForbiddenAuthError(error)) {
          throw redirect({ href: "/login?denied=1", replace: true });
        }

        const redirectPath = getSafeRedirectPath(location.href);
        rememberRedirectPath(redirectPath);
        throw redirect({
          href: `/login?redirect=${encodeURIComponent(redirectPath)}`,
          replace: true,
        });
      }
```

### Step 6: Verify

Run: `npm run test -- src/features/auth/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

### Step 7: Commit

```bash
git add src/features/auth/route-guard.ts src/features/auth/route-guard.test.ts src/routes/__root.tsx
git commit -m "fix(auth): distinguish an unprovisioned account from no session at all"
```

---

## Task 4: Render the denied state and un-gate magic link on `/login`

**Files:**
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/-login.interaction.test.tsx`

### Context

Two independent things change on this page, done together because both touch the same gating logic and the same test file.

**Denied state.** Task 3 redirects a `Forbidden` rejection to `/login?denied=1`. Nothing reads that param yet. `AuthProvider` wraps `/login` too (see `__root.tsx`'s `RootComponent`: `<AuthProvider>{isPublicRoute(pathname) ? <Outlet /> : <ProtectedAppShell />}</AuthProvider>`), so `useAuth()`'s `signOut` is available on this page. On mount with `denied=1` present, the page must sign the stale session out — leaving it in place is what would make the loop possible — and show an explicit message. This must run once, not on every render.

**Magic link gating.** The current check is:

```typescript
function isDemoMagicLinkEnabled(): boolean {
  return (
    import.meta.env.VITE_ENABLE_NEON_AUTH_DEMO === "true" &&
    import.meta.env.VITE_PROVIDER_MODE === "simulated"
  );
}
```

`VITE_ENABLE_NEON_AUTH_DEMO`/`VITE_PROVIDER_MODE` are a narrow pair specific to the *isolated Neon Auth demo stack* described in `docs/runbooks/neon-auth-demo.md` — a real Neon Auth backend, just a separate demo project. They are unrelated to `VITE_ENABLE_DEMO_AUTH`, which is what `isDemoAuthEnabled()` in `route-guard.ts` reads to choose between the fixture-based `DemoAuthProvider` (in-memory users, no real backend, no magic link possible at all) and the real `NeonAuthProvider`. The correct condition for "can this page actually attempt magic link" is simply "is `NeonAuthProvider` the one rendering" — `!isDemoAuthEnabled()`. That runbook already states `VITE_ENABLE_DEMO_AUTH` "must be false" whenever the isolated-demo flags are set, so this is a strict generalisation: everywhere the old check was `true`, the new one is too, and the new one is *also* `true` in real production, which is the point.

The Google button is gated on the same condition — `DemoAuthProvider` has no OAuth capability either.

### Step 1: Write the failing tests

Replace the two flag-dependent tests in `src/routes/-login.interaction.test.tsx`. The existing `beforeEach` stubs `VITE_ENABLE_NEON_AUTH_DEMO`/`VITE_PROVIDER_MODE` — change it to stub the flag the new logic actually reads:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "false");
  login.mockResolvedValue({ ok: true });
  loginWithMagicLink.mockResolvedValue({
    ok: true,
    message: "Check your email for a magic link.",
  });
  loginDemo.mockResolvedValue({ ok: true });
  loginWithGoogle.mockResolvedValue({ ok: true });
});
```

Add `loginWithGoogle` to the top-level mock declarations (alongside `navigate`, `login`, `loginWithMagicLink`, `loginDemo`):

```typescript
const loginWithGoogle = vi.fn();
```

and to the `vi.mock("@/features/auth/auth-context-neon", ...)` factory's returned object:

```typescript
vi.mock("@/features/auth/auth-context-neon", () => ({
  useAuth: () => ({
    session: null,
    isHydrated: true,
    demoUsers: [],
    login,
    loginWithMagicLink,
    loginDemo,
    loginWithGoogle,
    signOut,
  }),
}));
```

Add a `signOut` mock alongside the others:

```typescript
const signOut = vi.fn().mockResolvedValue(undefined);
```

Replace the "hides magic-link mode outside the demo provider" test with two tests reflecting the corrected logic:

```typescript
  it("shows magic link and Google by default (a real Neon Auth backend)", () => {
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Magic link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("hides magic link and Google under the fixture demo-auth provider", () => {
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "true");
    render(<LoginPage />);

    expect(screen.queryByRole("button", { name: "Magic link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Request an invitation" })).toBeNull();
  });
```

Add tests for the denied state:

```typescript
describe("LoginPage denied state", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "false");
  });

  it("signs out and explains the account has no access", async () => {
    const originalLocation = window.location;
    // @ts-expect-error -- test-only reassignment to control window.location.search
    delete window.location;
    window.location = { ...originalLocation, search: "?denied=1" } as Location;

    render(<LoginPage />);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(/does not have access/i, { selector: '[role="status"], [role="alert"]' }),
    ).toBeTruthy();

    window.location = originalLocation;
  });

  it("does not show the denied message without the query param", () => {
    render(<LoginPage />);
    expect(screen.queryByText(/does not have access/i)).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run the tests to verify they fail

Run: `npm run test -- src/routes/-login.interaction.test.tsx`
Expected: FAIL — `loginWithGoogle`/`signOut` are not yet part of the mocked context shape used by the component, "Continue with Google" doesn't exist, and the denied message isn't rendered.

### Step 3: Implement in `login.tsx`

Replace the `isDemoMagicLinkEnabled` function and its call site. Remove:

```typescript
function isDemoMagicLinkEnabled(): boolean {
  return (
    import.meta.env.VITE_ENABLE_NEON_AUTH_DEMO === "true" &&
    import.meta.env.VITE_PROVIDER_MODE === "simulated"
  );
}
```

Add the import (alongside the existing `consumeRedirectPath, getSafeRedirectPath` import from `"@/features/auth/route-guard"`):

```typescript
import { consumeRedirectPath, getSafeRedirectPath, isDemoAuthEnabled } from "@/features/auth/route-guard";
```

Inside `LoginPage`, replace:

```typescript
  const magicLinkEnabled = isDemoMagicLinkEnabled();
  const { session, isHydrated, login, loginWithMagicLink, loginDemo, demoUsers } = useAuth();
```

with:

```typescript
  const magicLinkEnabled = !isDemoAuthEnabled();
  const { session, isHydrated, login, loginWithMagicLink, loginWithGoogle, loginDemo, demoUsers, signOut } =
    useAuth();
  const [denied, setDenied] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
```

Add a denial effect, alongside the existing redirect effect:

```typescript
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("denied") !== "1") return;

    setDenied(true);
    void signOut();
  }, [signOut]);
```

Add a Google submit handler, alongside `submitDemoLogin`:

```typescript
  async function submitGoogleLogin() {
    setGoogleSubmitting(true);
    setError(null);
    const result = await loginWithGoogle();
    if (!result.ok) {
      setError(result.error);
      setGoogleSubmitting(false);
    }
    // On success the browser is navigating to Google already; no further state
    // update is meaningful before the page unloads.
  }
```

Render the denied banner, placed just above the existing mode-toggle block (`{magicLinkEnabled && ( <div ... role="group" ...`):

```typescript
          {denied && (
            <div
              className="mt-6 rounded-md border border-status-red/30 bg-status-red-soft px-3 py-2 text-xs text-status-red"
              role="alert"
            >
              This account does not have access to Kossilon Hub. Ask an administrator to grant
              access, or sign in with a different account below.
            </div>
          )}
```

Render the Google button, placed after the closing `</form>` and before the existing magic-link invitation paragraph:

```typescript
          {magicLinkEnabled && (
            <button
              type="button"
              onClick={() => void submitGoogleLogin()}
              disabled={!isHydrated || googleSubmitting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              Continue with Google
            </button>
          )}
```

(Reusing the already-imported `ShieldCheck` icon — no new icon import needed.)

### Step 4: Run the tests

Run: `npm run test -- src/routes/-login.interaction.test.tsx`
Expected: PASS, all cases including the pre-existing password/magic-link/invitation tests.

### Step 5: Verify the wider suite and typecheck

Run: `npm run test -- src/routes/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: FAIL, because `loginWithGoogle` does not yet exist on `AuthContextValue` — Task 5 adds it. (`signOut` is unaffected; it is already part of the real type today, only newly *mocked* in this task's test file.) This failure is expected at this point in the plan; do not attempt to fix it here.

### Step 6: Commit

```bash
git add src/routes/login.tsx src/routes/-login.interaction.test.tsx
git commit -m "feat(auth): render the denied state and enable magic link/Google gating on /login"
```

---

## Task 5: Add `loginWithGoogle` and `signOut` context surface

**Files:**
- Modify: `src/features/auth/auth-context-neon.tsx`
- Modify: `src/features/auth/auth-context-neon.test.tsx`

### Context

`signOut` already exists on `AuthContextValue` and on both providers — Task 4's test file only needed it *mocked*, nothing here changes. What's missing is `loginWithGoogle`.

`signInSocial` is core to better-auth (`node_modules/better-auth/dist/api/routes/sign-in.d.mts` exports it alongside `signInEmail` — it is not a plugin), and its handler returns `{url, redirect}` on success. The client's default fetch plugin set includes a `redirectPlugin` (`node_modules/better-auth/dist/client/config.mjs:50`, active unless `disableDefaultFetchPlugins` is passed, which `createNeonAuthClient` does not do) that automatically does `window.location.href = data.url` whenever a response carries `{url, redirect: true}`. **No manual navigation code is needed or wanted** — writing one would race the plugin's own navigation.

`provider: "google"` is a valid literal in `signInSocial`'s documented provider union (confirmed by reading the installed package's type declaration, not assumed).

### Step 1: Write the failing test

In `src/features/auth/auth-context-neon.test.tsx`, add `social: vi.fn()` to the hoisted `authClient` mock:

```typescript
const authClient = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: {
    email: vi.fn(),
    magicLink: vi.fn(),
    social: vi.fn(),
  },
  signOut: vi.fn(),
}));
```

Add a test, following the existing `MagicLinkConsumer` pattern in the same file:

```typescript
function GoogleConsumer() {
  const { loginWithGoogle } = useAuth();
  const [message, setMessage] = useState("");

  return (
    <>
      <button
        onClick={() => {
          void loginWithGoogle().then((result) => {
            setMessage(result.ok ? "ok" : result.error);
          });
        }}
      >
        Continue with Google
      </button>
      <output>{message}</output>
    </>
  );
}

describe("Neon Auth context Google login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoAuthEnabled.mockReturnValue(false);
    getNeonAuthClientConfiguration.mockResolvedValue({ url: "https://auth.example.test" });
    authClient.getSession.mockResolvedValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("requests a Google sign-in with the correct provider and callback", async () => {
    authClient.signIn.social.mockResolvedValue({
      data: { url: "https://accounts.google.test/x", redirect: true },
      error: null,
    });

    render(
      <AuthProvider>
        <GoogleConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(createNeonAuthClient).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("ok")).toBeTruthy();
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/login`,
      newUserCallbackURL: `${window.location.origin}/login`,
    });
  });

  it("surfaces a provider error without throwing", async () => {
    authClient.signIn.social.mockResolvedValue({
      data: null,
      error: { message: "Google sign-in is not configured." },
    });

    render(
      <AuthProvider>
        <GoogleConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(createNeonAuthClient).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Google sign-in is not configured.")).toBeTruthy();
  });
});
```

This mirrors the file's existing `describe("Neon Auth context magic-link login", ...)` block exactly — same `beforeEach`/`afterEach` shape, same "wait for `createNeonAuthClient` to have been called once" hydration idiom before interacting. Do not invent a different reset pattern.

### Step 2: Run the test to verify it fails

Run: `npm run test -- src/features/auth/auth-context-neon.test.tsx -t "Google"`
Expected: FAIL — `loginWithGoogle` does not exist on the context, `authClient.signIn.social` is never called.

### Step 3: Implement it

In `src/features/auth/auth-context-neon.tsx`, add `loginWithGoogle` to the `AuthContextValue` type (after `loginWithMagicLink`):

```typescript
  loginWithGoogle: () => Promise<AuthActionResult>;
```

In `NeonAuthProvider`, add the implementation alongside `loginWithMagicLink`:

```typescript
  const loginWithGoogle = useCallback(async (): Promise<AuthActionResult> => {
    const result = await client.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/login`,
      newUserCallbackURL: `${window.location.origin}/login`,
    });

    if (result.error) {
      return { ok: false, error: result.error.message ?? "Google sign-in failed." };
    }

    // better-auth's default redirectPlugin has already started navigating the
    // browser to Google at this point (see client/config.mjs — active whenever
    // the response carries {url, redirect: true}, which signIn.social's success
    // response always does). There is nothing further to do here.
    return { ok: true };
  }, [client]);
```

Add it to the memoised `value` object in `NeonAuthProvider` (alongside `login`, `loginWithMagicLink`):

```typescript
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated,
      demoUsers: [],
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginWithMagicLink,
      loginWithGoogle,
      loginDemo: demoUnavailable,
      loginDemoUser: demoUnavailable,
      signOut,
    }),
    [demoUnavailable, isHydrated, login, loginWithGoogle, loginWithMagicLink, session, signOut],
  );
```

In `NeonAuthBootstrap`'s `unavailable`-backed fallback value, add:

```typescript
    loginWithGoogle: unavailable,
```

In `DemoAuthProvider`, add a Google-unavailable stub — reuse the existing `magicLinkUnavailable` callback rather than creating a duplicate identical function:

```typescript
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated: true,
      demoUsers,
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginWithMagicLink: magicLinkUnavailable,
      loginWithGoogle: magicLinkUnavailable,
      loginDemo,
      loginDemoUser,
      signOut,
    }),
    [login, loginDemo, loginDemoUser, magicLinkUnavailable, session, signOut],
  );
```

### Step 4: Run the test

Run: `npm run test -- src/features/auth/auth-context-neon.test.tsx`
Expected: PASS, all cases.

### Step 5: Verify the wider suite and typecheck

Run: `npm run test -- src/features/auth/ src/routes/`
Expected: PASS — this is also where Task 4's `tsc` failure from Step 5 resolves.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean.

### Step 6: Commit

```bash
git add src/features/auth/auth-context-neon.tsx src/features/auth/auth-context-neon.test.tsx
git commit -m "feat(auth): add Google sign-in via better-auth's core signIn.social"
```

---

## Task 6: Runbook — Google Cloud / Neon Auth dashboard configuration

**Files:**
- Create: `docs/runbooks/google-signin-setup.md`

- [ ] **Step 1: Write the runbook**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/google-signin-setup.md
git commit -m "docs(auth): add the Google sign-in dashboard runbook"
```

---

## Task 7: Full verification sweep

**Files:** none modified.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. (Confirm the exit code directly — `npm run lint | tail -N` masks a non-zero exit behind `tail`'s own success. Run it unpiped, or check `$?` immediately after.)

- [ ] **Step 3: Full suite**

Run: `npm run test`
Expected: PASS, with a total no lower than this branch's baseline before Task 1.

- [ ] **Step 4: Pre-deploy gate**

Run: `npm run verify:firm -- --dry-run`
Expected: reports `RESEND_API_KEY`/`RESEND_FROM` among the tracked binding names (still "blocked" in dry-run, same as every other secret — that status is expected and correct for a dry run; it means "not tested live," not "missing").

- [ ] **Step 5: Grep for the old magic-link gate**

Run: `grep -rn "VITE_ENABLE_NEON_AUTH_DEMO\|isDemoMagicLinkEnabled" src/routes/login.tsx`
Expected: no hits in `login.tsx` itself (the two env vars may still appear in `docs/runbooks/neon-auth-demo.md`, which is correct — that runbook describes a real deployment configuration, not this now-removed gate).

- [ ] **Step 6: Commit and open the PR**

```bash
git push -u origin <branch-name>
```

---

## Acceptance: what "done" means

The suite proves the wiring is correct. It cannot prove Google or Resend work against the real, deployed Neon Auth project — that is what Task 1 already checked once, live, before any client code was written. Before calling this finished in production:

1. A staff member with an existing `users` row and `staff_profiles` row signs in with Google and lands in the app with the correct role.
2. A Google account with **no** `users` row is refused with the on-screen "does not have access" message — not a silent bounce — and is signed out, not left holding a valid-but-useless session.
3. A **deactivated** staff member (`staff_profiles.active = false`) gets the same refusal.
4. A magic link sent in production (real Resend, real Neon Auth) is received and signs the user in.
5. A client-portal user signs in with Google and sees only their own companies — proving the new sign-in method grants no additional access beyond what `client_company_memberships` already allows.

## Out of scope

Self-service access requests, invitation emails, auto-provisioning, additional OAuth providers, MFA, session-length changes, and the `users.role` vocabulary inconsistency (roadmap P3-9). None of these are started or partially built by this plan.
