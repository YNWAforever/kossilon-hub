# Isolated Neon Auth Demo Runbook

## Purpose and approval gate

This is a planned operator workflow. It does not prove that any demo resources
already exist, have been provisioned, or have been verified.

Fresh, explicit approval is required immediately before each of these actions:

- Creating a Neon project or Neon Auth project/instance.
- Creating a Vercel project or deployment.
- Writing an environment variable in a provider.
- Creating or inviting a real account.
- Running a remote migration or seed.
- Performing an external login.
- Cleaning up remote resources.

Do not use an earlier approval to cover a later action. Record approval and use
provider consoles only for the approved demo scope.

## Isolated topology

- Use a separate Neon project and database for the demo.
- Use a separate Neon Auth project/instance for the demo.
- Use a separate Vercel project and domain, for example
  `https://kossilon-hub-demo.vercel.app`.
- Production remains `https://kossilon-hub.vercel.app`. Demo setup and seeding
  never target production.

## Configuration boundary

After approval, validate provider configuration through a redacted environment
view. Do not print or copy values into commands, source control, documents, or
logs.

| Variable                  | Demo deployment purpose                     |
| ------------------------- | ------------------------------------------- |
| `DATABASE_URL`            | Demo database connection for the deployment |
| `NEON_AUTH_URL`           | Demo Neon Auth endpoint                     |
| `NEON_AUTH_COOKIE_SECRET` | Demo Neon Auth cookie signing secret        |
| `FIRM_ID=kossilon-demo`   | Isolates the deployment to the demo firm    |

Keep `VITE_ENABLE_DEMO_AUTH` unset or `false`. For the deployed client build,
`VITE_PROVIDER_MODE` must not be `local`. Leave live WhatsApp, email, storage,
scanner, and backup bindings unset unless they receive separate explicit
approval.

## Provision, migration, account, seed, and deployment

1. Obtain fresh explicit approval for the next remote action.
2. Provision the separate demo Neon database. Confirm it is not the production
   database using redacted provider metadata.
3. Validate the demo deployment configuration in the provider's redacted
   environment view.
4. Obtain fresh explicit approval immediately before the migration. In an
   approved operator environment configured for the demo database only, run:

   ```powershell
   npm.cmd run db:migrate
   ```

5. Obtain fresh explicit approval immediately before account creation. In the
   demo Neon Auth instance, create or invite exactly
   `willylai@fimmick.com` through the approved provider UI/workflow.
6. Retrieve that account's user ID through the approved provider UI/workflow.
   Do not place an auth ID in this runbook, command history, or logs.
7. Obtain fresh explicit approval immediately before seeding. In an approved
   operator environment with `DEMO_DATABASE_URL`, `DEMO_AUTH_USER_ID`, and
   `DEMO_FIRM_ID` already set for the demo, run:

   ```powershell
   npm.cmd run db:seed:neon-auth-demo
   ```

   If the operator needs the production-target guard, `PRODUCTION_DATABASE_URL`
   may be set only in that operator environment. Never echo any of these
   values. The password is entered only through Neon Auth or the login UI; it
   is never passed to the seed command or stored in the repository, documents,
   or logs.

8. Obtain fresh explicit approval immediately before deployment. Deploy the
   separate Vercel project to its separate demo domain.

## Verification checklist

Obtain fresh explicit approval immediately before any external login. Record
only redacted results.

- The approved demo URL responds and its `/login` route returns HTTP 200.
- The login page presents the Neon Auth email/password form and exposes no
  public demo identities.
- A protected route redirects an unauthenticated visitor to login.
- The invited account can log in and log out.
- The authenticated account resolves to the `Admin` role.
- Seeded companies and cases appear only in the demo firm.
- An allowed workflow mutation succeeds in the demo scope.
- Production at `https://kossilon-hub.vercel.app` remains untouched.
- WhatsApp, email, storage, scanner, and backup integrations are blocked or
  unset.
- Provider and deployment logs remain redacted and contain no credentials.

## Rollback and cleanup

Cleanup is a remote action and requires a second fresh, explicit approval.
After that approval, remove only the separate demo Vercel project/domain, demo
Neon Auth project/instance, demo Neon project/database, and demo-only account.
Do not delete, seed, migrate, or otherwise target production resources.
