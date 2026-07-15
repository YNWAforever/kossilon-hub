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

## Operator sequence

1. Obtain fresh explicit approval immediately before creating the separate demo
   Neon project and database. Create them, then confirm through redacted
   provider metadata that neither is a production resource.
2. Obtain fresh explicit approval immediately before creating the separate demo
   Neon Auth project/instance. Create it only for this demo database and firm.
3. Obtain fresh explicit approval immediately before creating the separate
   Vercel project and domain. Create the project with a demo-only domain such
   as `https://kossilon-hub-demo.vercel.app`.
4. Obtain fresh explicit approval immediately before writing environment
   variables to the separate demo Vercel project. Write only the following
   deployment bindings through the provider's redacted environment view; do not
   print or copy their values into commands, source control, documents, or
   logs.

   | Variable                  | Demo deployment purpose                     |
   | ------------------------- | ------------------------------------------- |
   | `DATABASE_URL`            | Demo database connection for the deployment |
   | `NEON_AUTH_URL`           | Demo Neon Auth endpoint                     |
   | `NEON_AUTH_COOKIE_SECRET` | Demo Neon Auth cookie signing secret        |
   | `FIRM_ID=kossilon-demo`   | Isolates the deployment to the demo firm    |

   The approved operator-local environment file must also contain
   `PRODUCTION_DATABASE_URL` and `PRODUCTION_NEON_AUTH_URL` solely for the
   mandatory isolation comparison. These operator-only values must never be
   written to the demo Vercel project or any other demo runtime configuration.
   Keep `VITE_ENABLE_DEMO_AUTH` unset or `false`. For the deployed client
   build, `VITE_PROVIDER_MODE` must not be `local`. Leave live WhatsApp, email,
   storage, scanner, and backup bindings unset unless they receive separate
   explicit approval.

5. Before any migration, seed, or deployment, validate the approved local demo
   environment file. The production database comparison is mandatory. Run
   exactly:

   ```powershell
   npm run validate:neon-auth-demo -- --env-file <approved-demo-env-file>
   ```

   The approved local file must contain the two operator-only production identity
   values above. Never write either value to demo Vercel. Validate deployment
   bindings only through the provider's redacted environment view. Production
   remains `https://kossilon-hub.vercel.app`; demo setup and seeding never target it.

6. Obtain fresh explicit approval immediately before the remote migration. In
   an approved operator environment configured for the demo database only, run:

   ```powershell
   npm.cmd run db:migrate
   ```

7. Obtain fresh explicit approval immediately before account creation. In the
   demo Neon Auth instance, create or invite exactly
   `willylai@fimmick.com` through the approved provider UI/workflow.
8. Retrieve that account's user ID through the approved provider UI/workflow.
   Do not place an auth ID in this runbook, command history, or logs.
9. Obtain fresh explicit approval immediately before the remote seed. In an
   approved operator environment with `DEMO_DATABASE_URL`, `DEMO_AUTH_USER_ID`,
   `DEMO_FIRM_ID`, `PRODUCTION_DATABASE_URL`, and `PRODUCTION_NEON_AUTH_URL`
   already set in the approved local environment file, run:

   ```powershell
   npm.cmd run db:seed:neon-auth-demo
   ```

   The production-target guard is mandatory: both production identity values
   remain only in that approved local operator environment. Never echo any of
   these values. The password is entered only through Neon Auth or the login UI; it
   is never passed to the seed command or stored in the repository, documents,
   or logs.

10. Obtain fresh explicit approval immediately before deployment. Deploy the
    separate Vercel project to its separate demo domain.
11. Obtain fresh explicit approval immediately before an external login and
    live verification. Complete the verification checklist below and record
    only redacted results.

## Verification checklist

The external login and verification approval in step 11 is required immediately
before these checks. Record only redacted results.

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

12. Obtain a second fresh, explicit approval immediately before cleanup. Remove
    only the separate demo Vercel project/domain, demo Neon Auth
    project/instance, demo Neon project/database, and demo-only account. Do not
    delete, seed, migrate, or otherwise target production resources.
