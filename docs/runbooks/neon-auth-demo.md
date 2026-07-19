# Isolated Neon Auth Demo Runbook

## Purpose and approval gate

This runbook activates and verifies a dedicated demo stack without changing
production. Production remains `https://kossilon-hub.vercel.app`.

Fresh, explicit approval is required immediately before every external write or
remote action:

- create a Neon project/database or Neon Auth instance;
- create a Vercel project, domain, deployment, or environment binding;
- invite or create an account;
- run a remote migration, seed, or reset;
- perform a live login or workflow mutation;
- remove demo resources during cleanup.

An approval for one step does not cover a later step. Use provider consoles only
for the approved demo scope. Never place password values, credentials, reset
URLs, connection strings, cookies, Auth user IDs, or request authorization
headers in this document, commands, logs, screenshots, or Git.

## Approved local environment

Use one operator-local environment file for validation, migration, seed, reset,
and deployment preparation. Enter its path privately:

```powershell
$demoEnvFile = Read-Host "Approved demo environment file path"
```

The file contains these names only; values are never committed. `VITE_ENABLE_DEMO_AUTH` may be absent, and if present it must be false. The public `VITE_ENABLE_NEON_AUTH_DEMO` flag is true only for the isolated demo build.

- `DATABASE_URL`
- `DEMO_DATABASE_URL`
- `PRODUCTION_DATABASE_URL`
- `NEON_AUTH_URL`
- `PRODUCTION_NEON_AUTH_URL`
- `NEON_AUTH_COOKIE_SECRET`
- `FIRM_ID`
- `DEMO_FIRM_ID`
- `DEMO_AUTH_USER_ID`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `VITE_PROVIDER_MODE`
- `VITE_ENABLE_NEON_AUTH_DEMO`

DATABASE_URL and DEMO_DATABASE_URL identify the same demo database.
FIRM_ID and DEMO_FIRM_ID are both kossilon-demo.
`VITE_PROVIDER_MODE=simulated` and `VITE_ENABLE_NEON_AUTH_DEMO=true` are required for the demo login experience. Keep the flag unset or false in production. Production identity values remain only in the operator-local file. They never enter the demo Vercel bindings.

The validator compares the demo database/Auth identities against the
operator-only production identities. It fails if the identities match, if the
firm is not `kossilon-demo`, if required bindings are missing, or if simulated
mode is not selected.

## Provisioning and activation

1. Obtain fresh approval, create a separate Neon project/database, and confirm
   from redacted provider metadata that it is not production.
2. Obtain fresh approval, create a separate Neon Auth instance connected to the
   demo database.
3. Obtain fresh approval, create a separate Vercel project and demo hostname.
4. Obtain fresh approval, write only demo runtime bindings to the separate
   Vercel project: `DATABASE_URL`, `NEON_AUTH_URL`,
   `NEON_AUTH_COOKIE_SECRET`, `FIRM_ID`, `RESEND_API_KEY`, `RESEND_FROM`, and
   `VITE_PROVIDER_MODE=simulated` and `VITE_ENABLE_NEON_AUTH_DEMO=true`. Keep
   `PRODUCTION_DATABASE_URL` and `PRODUCTION_NEON_AUTH_URL` in the
   operator-local file only. Keep `VITE_ENABLE_DEMO_AUTH` unset or false in the demo, and keep `VITE_ENABLE_NEON_AUTH_DEMO` unset or false in production.

   Treat `$demoEnvFile` as the only source of truth for deployment. Before deploying, compare the separate Vercel project binding names and values with that file and rerun the validator against the same file; abort if they differ. Do not hand-type a second configuration.

5. Validate the exact operator-local file before any remote operation:

   ```powershell
   npm run validate:neon-auth-demo -- --env-file $demoEnvFile
   ```

   The output contains only names and pass/fail statuses.

6. Obtain fresh approval, then run the remote migration with the same file:

   ```powershell
   bun --env-file="$demoEnvFile" scripts/db-migrate.ts
   ```

7. Obtain fresh approval, then invite exactly `willylai@fimmick.com` through
   the demo Neon Auth workflow. Set or reset the password only through the
   Neon Auth email flow. Do not enter a password into Kossilon code or scripts.
8. Obtain the invited Admin Auth user ID through the approved provider workflow
   and put it only in the operator-local file as `DEMO_AUTH_USER_ID`.
9. Obtain fresh approval, then seed the dedicated demo:

   ```powershell
   bun --env-file="$demoEnvFile" scripts/db-seed-neon-auth-demo.ts
   ```

   The seed reuses `DEMO_AUTH_USER_ID` for the Admin mapping and prints only a
   redacted success line. It cannot target the configured production database.

10. Obtain fresh approval, then deploy the verified commit to the separate
    Vercel demo project. Record only the deployment ID, ready state, and demo
    hostname.

## Neon Auth login configuration

Obtain fresh, explicit approval immediately before changing managed Neon Auth settings. On the isolated demo Auth branch:

1. Enable the managed magic-link capability and keep email/password authentication enabled.
2. Add a Resend sending-only API key as `RESEND_API_KEY`. Set `RESEND_FROM` to a sender on a verified domain; never expose either value in logs or Git.
3. Deploy and verify that `/api/webhooks/neon-auth` accepts only signed Neon POST requests and that `/auth/magic-link/confirm` returns the confirmation page without a Neon URL or token in its HTML.
4. Configure the demo branch webhook at `https://kossilon-hub-demo.vercel.app/api/webhooks/neon-auth`, subscribe only to `send.magic_link`, and use a ten-second timeout. Enabling this event replaces Neon's built-in magic-link delivery, so do it only after the deployed handler and Resend binding are ready.
5. Keep open signup disabled with `disable_sign_up=true`. This is invite-only; do not enable public `signUp.email` registration.
6. Invite users through the demo Neon Auth workflow. The `Request an invitation` action is a contact mailto for the firm administrator; it is not registration and does not create an Auth account.
7. Verify that accepted magic-link requests return to the same-origin `/login` callback. Do not copy tokens, passwords, or provider response bodies into Kossilon code, logs, or this runbook.

The webhook emails an encrypted app confirmation ticket instead of the one-time Neon verification URL. Automated GET requests can load `/auth/magic-link/confirm` but cannot see or consume the Neon token. Only the confirmation form POST decrypts the ticket and redirects once to Neon's verification endpoint. If delivery fails during activation, disable the webhook to restore Neon's built-in email delivery while investigating.

The login page exposes the magic-link mode and invitation CTA only when both
`VITE_ENABLE_NEON_AUTH_DEMO=true` and `VITE_PROVIDER_MODE=simulated` are set on
the isolated demo build. Production leaves the feature flag unset or false and
remains password-only.

## Persistent data and guarded reset

Demo changes persist until an operator runs the guarded reset. Do not reset
after every demo action.

The reset truncates only the fixed public application tables, preserves `schema_migrations` and Neon Auth records, reapplies deterministic seed data,
and reuses `DEMO_AUTH_USER_ID` for the Admin mapping. It never targets
production and prints only a redacted success or failure line.

Obtain fresh approval immediately before a reset, then run:

```powershell
$demoEnvFile = Read-Host "Approved demo environment file path"
npm run validate:neon-auth-demo -- --env-file $demoEnvFile
bun --env-file="$demoEnvFile" scripts/db-reset-neon-auth-demo.ts --confirm-firm kossilon-demo
```

Expected success output is:
`Reset Neon Auth demo data for DEMO_FIRM_ID=kossilon-demo.`

## Delivery behavior

The isolated demo uses simulated delivery. The durable `Send now` action still
queues the WhatsApp follow-up and its notification outbox record, then the
demo-only dispatcher marks due WhatsApp or email records with a deterministic
`simulated:` provider ID after the enqueue transaction commits.

The UI must show:

- `Demo simulation`
- `No external WhatsApp or email message is sent.`

Simulated mode makes zero WhatsApp or email provider network calls. Live
provider bindings are not needed for the demo. Never configure live provider
secrets in the demo project without a separate approval.

## Live acceptance and production non-mutation evidence

Obtain fresh approval immediately before external login and browser checks.
Record only booleans, counts, deployment IDs, HTTP status codes, and route names.

- `/login` responds with HTTP 200.
- An unauthenticated protected route redirects to `/login`.
- The invited account can log in and log out through Neon Auth.
- The demo login shows Password and Magic link modes only when both demo flags are enabled.
- The emailed URL opens `/auth/magic-link/confirm` without consuming the Neon token.
- The confirmation form POST completes the one-time verification and returns to `/login`.
- Production login remains password-only with no invitation CTA.
- The authenticated account resolves to the `Admin` role.
- Seeded companies and annual-return cases appear only for `kossilon-demo`.
- One reversible workflow mutation persists after reload.
- Simulated-delivery UI copy matches the two exact expected strings: true.
- One `Send now` action records a simulated provider ID: true.
- No WhatsApp or email provider request is made.
- Production `https://kossilon-hub.vercel.app` read-only counts/checksums match before and after demo verification: true.
- No migration, seed, reset, or write query is run against production.

Do not record credentials, reset URLs, connection strings, Auth user IDs, cookies,
or request authorization headers in acceptance evidence.

## Cleanup

Obtain a second fresh approval immediately before cleanup. Remove only the
separate demo Vercel project/domain, demo Neon Auth instance, demo Neon
project/database, and demo-only account. Do not delete, seed, migrate, reset,
or otherwise target production resources.
