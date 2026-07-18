# Neon Auth Magic Link And Invite Request Design

## Goal

Add a demo-only magic-link login path and a clear invitation-request action to the Kossilon login page without opening public account registration or changing production authentication.

## Scope

- The demo keeps Neon Auth `disable_sign_up=true`.
- Existing invited users can sign in with either email/password or a Neon Auth magic link.
- The login page exposes a `Request an invitation` action that explains the invite-only policy and directs the user to request access from their firm administrator. It does not create an Auth account.
- Production behavior and production Neon Auth configuration remain unchanged.

## Architecture

`createNeonAuthClient` enables Better Auth's `magicLinkClient` plugin. The Neon Auth context exposes a magic-link action alongside the existing password action. The login route owns mode selection, form submission, pending state, and user-facing success/error messages. Returning from the Auth provider to `/login` reuses the existing session bootstrap and redirect behavior.

The demo Auth branch must enable magic-link delivery while retaining email/password authentication and disabled open signup. If the provider does not expose the required magic-link capability, the UI reports the provider error and does not pretend that a link was sent.

## User Flow

1. The user opens `/login` and sees Password and Magic link modes.
2. Password mode continues to call `signIn.email`.
3. Magic link mode accepts an email and calls `signIn.magicLink` with a safe `/login` callback URL.
4. The user sees a neutral confirmation to check the email inbox. No password is collected in this mode.
5. A user without an invitation cannot create an account through either mode.
6. `Request an invitation` reveals invite-only guidance and the administrator contact action.

## Error Handling

- Disable submit while the request is pending.
- Display provider errors without leaking response bodies, tokens, or internal URLs.
- Show success only after the provider accepts the request.
- Keep the existing session refresh and protected-route redirect behavior.

## Testing

- Auth context tests cover magic-link success, provider errors, and disabled demo actions.
- Login route tests cover password/magic-link mode switching, success messaging, error messaging, and invitation guidance.
- Existing auth and production-import checks remain green.
- The demo provider configuration is verified separately from local UI tests.

## Non-goals

- No public `signUp.email` flow.
- No new database table or admin request queue.
- No production Neon Auth changes.
- No custom token generation, email transport, or password handling.