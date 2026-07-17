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

The file contains these names only; values are never committed:

- `DATABASE_URL`
- `DEMO_DATABASE_URL`
- `PRODUCTION_DATABASE_URL`
- `NEON_AUTH_URL`
- `PRODUCTION_NEON_AUTH_URL`
- `NEON_AUTH_COOKIE_SECRET`
- `FIRM_ID`
- `DEMO_FIRM_ID`
- `DEMO_AUTH_USER_ID`
- `VITE_PROVIDER_MODE`

DATABASE_URL and DEMO_DATABASE_URL identify the same demo database.
FIRM_ID and DEMO_FIRM_ID are both kossilon-demo.
`VITE_PROVIDER_MODE=simulated` is required for the demo. Production identity values remain only in the operator-local file. They never enter the demo Vercel bindings.

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
   `NEON_AUTH_COOKIE_SECRET`, `FIRM_ID`, and
   `VITE_PROVIDER_MODE=simulated`. Keep
   `PRODUCTION_DATABASE_URL` and `PRODUCTION_NEON_AUTH_URL` in the
   operator-local file only. Keep `VITE_ENABLE_DEMO_AUTH` unset or false.
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
- The authenticated account resolves to the `Admin` role.
- Seeded companies and annual-return cases appear only for `kossilon-demo`.
- One reversible workflow mutation persists after reload.
- WhatsApp Automation shows the two exact simulated-delivery strings.
- One `Send now` action records a provider ID beginning with `simulated:`.
- No WhatsApp or email provider request is made.
- Production `https://kossilon-hub.vercel.app` has the same read-only counts or
  checksums before and after demo verification.
- No migration, seed, reset, or write query is run against production.

Do not record credentials, reset URLs, connection strings, Auth user IDs, cookies,
or request authorization headers in acceptance evidence.

## Cleanup

Obtain a second fresh approval immediately before cleanup. Remove only the
separate demo Vercel project/domain, demo Neon Auth instance, demo Neon
project/database, and demo-only account. Do not delete, seed, migrate, reset,
or otherwise target production resources.
