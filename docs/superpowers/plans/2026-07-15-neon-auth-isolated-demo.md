# Neon Auth Isolated Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a separately deployed Kossilon demo that authenticates through a real Neon Auth account, uses a separate Neon project/database, loads deterministic synthetic annual-return data, and leaves the production deployment and production database unchanged.

**Architecture:** Keep the existing production Neon Auth provider and email/password login path. Add a guarded demo seed entry point that writes only to an explicitly supplied demo database and maps the supplied Neon Auth user ID to the seeded Admin profile. Add configuration validation and a runbook for the separate Neon Auth, Neon database, and Vercel resources. The deployed demo remains a production build, so local demo auth and local provider mode stay disabled; live WhatsApp, email, storage, scanning, and backup bindings remain unset and are treated as blocked until separately approved.

**Tech Stack:** TypeScript, Bun/Node scripts, `postgres`, Vitest, existing Neon Auth server adapter, existing SQL migrations, Vercel deployment, Neon Auth, Neon Postgres.

## Global Constraints

- Do not alter production Neon Auth, production `DATABASE_URL`, production `FIRM_ID`, or the existing production Vercel deployment.
- Do not add public one-click demo identities, passwords, password hashes, auth tokens, connection strings, cookie secrets, or other credentials to source, fixtures, tests, documentation, git history, or command output.
- The demo database must be a separately provisioned Neon project/database. Do not attempt row-level tenant isolation in the existing production database.
- The demo login remains the existing Neon Auth email/password form in `src/routes/login.tsx`; `demoUsers` remains empty in the Neon Auth provider.
- The demo must use `VITE_ENABLE_DEMO_AUTH` unset/false and must not set `VITE_PROVIDER_MODE=local` in a production build, because the repository rejects local providers in production builds.
- Seed data is synthetic and deterministic. Seed commands must be idempotent and transactional.
- Any Neon project, Neon Auth instance, Vercel project/deployment, environment-variable write, real account creation/invitation, database migration against a remote database, or external login test requires a fresh explicit provisioning approval immediately before execution. This plan does not provision resources.
- Verification must report redacted configuration names and statuses only; never print secret values.

---

## Task 1: Extract a reusable, parameterized annual-return seed

**Files:**

- Modify `scripts/db-seed-annual-return.ts`
- Add `scripts/db-seed-annual-return.test.ts`

- [ ] **1.1 Write failing tests for the seed contract.** Add Vitest coverage for a pure seed configuration/fixture boundary that proves:
  - the default seed preserves the current synthetic fixture values and legacy synthetic auth IDs when no override is supplied;
  - a supplied `adminAuthUserId` replaces only the Admin staff profile auth ID;
  - non-Admin staff auth IDs and the synthetic client membership identity remain unchanged;
  - an empty or whitespace-only override is rejected;
  - no password-like field is accepted by the seed configuration type or included in generated seed rows.
    Use an injected SQL client or a generated operation model so these tests do not open a database connection.
    Run `npx vitest run scripts/db-seed-annual-return.test.ts`; confirm the new assertions fail before implementation.
- [ ] **1.2 Refactor the existing script around an exported seed function.** Preserve all existing fixture IDs, fixture values, upsert conflict targets, adopted-ID checks, transaction boundaries, and final row-count behavior. Move the SQL work behind an exported function such as `seedAnnualReturn(sql, options)` where `options.adminAuthUserId` is optional and validated before any query runs. Keep the current CLI behavior as a thin entry point using the existing `DATABASE_URL` and default fixture identity.
- [ ] **1.3 Make the Admin auth mapping explicit.** Build `staffProfiles` from a function that accepts the optional override and uses it only for the Admin fixture corresponding to `amy.chan@kossilon.hk`. Keep the seeded role as `Admin` and leave all other staff/client fixture identities unchanged. Ensure the function and its types are importable by the demo seed script without executing the CLI side effect.
- [ ] **1.4 Run the focused tests and typecheck.** Run `npx vitest run scripts/db-seed-annual-return.test.ts scripts/validate-firm-runtime.test.ts`, then `npx tsc --noEmit`. Expected result: all focused tests pass and TypeScript reports no errors.

## Task 2: Add a demo-only database seed command with separation guards

**Files:**

- Add `scripts/db-seed-neon-auth-demo.ts`
- Add `scripts/db-seed-neon-auth-demo.test.ts`
- Modify `package.json`

- [ ] **2.1 Write failing tests for demo environment parsing.** Cover a pure `readDemoSeedConfig(env)` contract requiring `DEMO_DATABASE_URL`, `DEMO_AUTH_USER_ID`, and `DEMO_FIRM_ID`. Test that it rejects missing values, whitespace values, an invalid database URL, and a demo URL equal to an explicitly supplied `PRODUCTION_DATABASE_URL` after normalization. Test that the returned object contains no password field and that error/output-safe summaries contain names/statuses rather than secret values.
      Run `npx vitest run scripts/db-seed-neon-auth-demo.test.ts`; confirm the new tests fail before implementation.
- [ ] **2.2 Implement the guarded CLI.** Add a script that reads only the required demo variables, validates the separation contract before connecting, creates a `postgres` client for `DEMO_DATABASE_URL`, calls the reusable seed with `DEMO_AUTH_USER_ID`, and closes the client in `finally`. Use one transaction through the existing seed function. Do not fall back to `DATABASE_URL`; a missing demo URL must fail closed.
- [ ] **2.3 Add the package command.** Add `db:seed:neon-auth-demo` to `package.json` pointing at the new script. Keep `db:seed` unchanged for the existing fixture workflow. The demo command must print only a success count and the non-secret demo firm identifier, never a URL, auth ID, cookie secret, or password.
- [ ] **2.4 Verify idempotency behavior at the operation boundary.** Extend the focused tests to assert that the demo command delegates to the existing deterministic upsert seed and does not issue destructive SQL or a second connection outside the transaction. Run `npx vitest run scripts/db-seed-annual-return.test.ts scripts/db-seed-neon-auth-demo.test.ts` and `npx tsc --noEmit`.

## Task 3: Add demo runtime validation and auth-to-Admin acceptance checks

**Files:**

- Add `scripts/validate-neon-auth-demo.ts`
- Add `scripts/validate-neon-auth-demo.test.ts`
- Add or extend `src/features/auth/neon-auth-server.test.ts` using the repository's existing test location/pattern
- Modify `package.json`

- [ ] **3.1 Write failing tests for demo validation.** Define a pure validator for the deployed demo environment that checks required names `FIRM_ID`, `NEON_AUTH_URL`, `NEON_AUTH_COOKIE_SECRET`, and `DATABASE_URL`; requires `NEON_AUTH_URL` to be HTTPS; rejects `VITE_ENABLE_DEMO_AUTH=true`; rejects `VITE_PROVIDER_MODE=local` for the production build; and rejects a missing or placeholder demo firm ID. Assert that validation results expose only pass/fail status and missing variable names, never values.
      Run `npx vitest run scripts/validate-neon-auth-demo.test.ts`; confirm the new tests fail before implementation.
- [ ] **3.2 Implement the validator CLI.** Add `npm run validate:neon-auth-demo` with a `--env-file` option matching `validate-firm-runtime.ts` conventions. It must read a local env file or process environment, perform no network calls, and print redacted readiness checks. It must not require or attempt to create Neon/Vercel resources.
- [ ] **3.3 Add a server-side auth mapping regression test.** Use injected fake Neon session and SQL dependencies in `src/features/auth/neon-auth-server.test.ts` to prove that the real Neon Auth user ID inserted by the demo seed resolves to an active `Admin` actor and that an unknown auth user remains forbidden. Do not use a live Neon Auth account or database in the test.
- [ ] **3.4 Add the package validation command and run focused checks.** Add `validate:neon-auth-demo` to `package.json`. Run `npx vitest run scripts/validate-neon-auth-demo.test.ts src/features/auth/neon-auth-server.test.ts`, then `npx tsc --noEmit`. Expected result: all checks pass with no live network calls.

## Task 4: Document the explicit Neon/Vercel provisioning and verification workflow

**Files:**

- Add `docs/runbooks/neon-auth-demo.md`
- Modify `docs/runbooks/firm-deployment.md` only if a short cross-link is needed

- [ ] **4.1 Document the approval gate and resource topology.** State that the demo uses a separate Neon project/database, a separate Neon Auth project/instance, and a separate Vercel project/deployment such as `kossilon-hub-demo.vercel.app`. State that production remains at `https://kossilon-hub.vercel.app` and is not used for setup or seeding.
- [ ] **4.2 Document secret-safe environment setup.** List variable names and purpose without example secret values: `DATABASE_URL` for the demo deployment, `NEON_AUTH_URL`, `NEON_AUTH_COOKIE_SECRET`, and `FIRM_ID=kossilon-demo`. Document that `VITE_ENABLE_DEMO_AUTH` must be unset/false, `VITE_PROVIDER_MODE` must not be `local` in the production build, and live WhatsApp/email/storage/scanner/backup variables stay unset unless separately approved.
- [ ] **4.3 Document migration, account, and seed order.** Specify: obtain explicit approval; provision the demo Neon database; run `npm run db:migrate` with the demo database only; create/invite `willylai@fimmick.com` in the demo Neon Auth instance; obtain that account's Neon Auth user ID through the approved provider workflow; run `npm run db:seed:neon-auth-demo` with `DEMO_DATABASE_URL`, `DEMO_AUTH_USER_ID`, `DEMO_FIRM_ID`, and optional `PRODUCTION_DATABASE_URL` set only in the operator's environment; then deploy the separate Vercel project. Explicitly state that the account password is entered only in Neon Auth/the login form and never passed to the seed command or stored in the repo.
- [ ] **4.4 Document the verification checklist.** Include redacted checks for deployment URL, `/login` 200 response, email/password Neon Auth form with no public demo identities, login/logout, protected-route redirect, Admin role resolution, seeded companies/cases, an allowed workflow mutation, no mutation of production, and blocked external integrations. Include rollback/cleanup steps that remove only demo resources after a second approval.
- [ ] **4.5 Review documentation for copy and safety.** Confirm the supplied email is exact, URLs are exact, no credentials appear, and the runbook does not imply that provisioning has already happened.

## Task 5: Verify the implementation locally without provisioning resources

**Files:**

- No new files unless a test failure requires a narrowly scoped correction in the files above

- [ ] **5.1 Run focused unit tests.** Run `npx vitest run scripts/db-seed-annual-return.test.ts scripts/db-seed-neon-auth-demo.test.ts scripts/validate-neon-auth-demo.test.ts src/features/auth/neon-auth-server.test.ts`.
- [ ] **5.2 Run repository checks.** Run `npx tsc --noEmit`, `npm run lint`, `npm run check:production-imports`, and `npm run verify:firm -- --dry-run`. Expected result: touched-surface tests, typecheck, lint, route import checks, and local dry-run gates pass; live database, storage, malware scanner, WhatsApp, email, backup, and browser evidence remain explicitly blocked.
- [ ] **5.3 Build the production bundle.** Run `npm run build`. Confirm the build succeeds with no demo-auth UI enabled and no local provider mode configured.
- [ ] **5.4 Inspect the final diff and safety surface.** Run `git diff --check`, `git status --short`, and a targeted search for `willylai@fimmick.com`, `DEMO_AUTH_USER_ID`, `DEMO_DATABASE_URL`, `NEON_AUTH_COOKIE_SECRET`, and password-like literals. Confirm only the intended email and variable names occur, no secret values occur, and unrelated `.sdd-artifacts/` remains unstaged.
- [ ] **5.5 Stop at the provisioning checkpoint.** Report the local verification evidence and the exact external actions still blocked. Do not create Neon/Vercel resources, set remote environment variables, create the real account, run a remote migration/seed, or push a deployment until the user gives explicit provisioning approval.

## Completion Criteria

- The repository has an idempotent, transaction-safe, demo-only seed path that cannot silently target production and maps the real Neon Auth Admin user ID without storing a password.
- The deployed-demo validator and runbook make the separate Neon database/Auth/Vercel topology and the explicit provisioning gate unambiguous.
- Existing production Neon Auth behavior remains the email/password path with no public demo identities.
- Focused tests, typecheck, lint, route import checks, dry-run verification, and production build pass locally.
- External provisioning remains pending until explicitly approved, and no claim is made that the deployed demo exists before that work is performed and verified.
