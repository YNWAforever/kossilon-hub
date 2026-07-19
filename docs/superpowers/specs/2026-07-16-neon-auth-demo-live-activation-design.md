# Neon Auth Demo Live Activation Design

**Date:** 2026-07-16
**Status:** Approved design, pending written-spec review
**Scope:** Provision and verify the already-implemented isolated Kossilon demo path

## Goal

Activate a durable, separately deployed Kossilon demo that authenticates through Neon Auth, contains only synthetic workflow data, and cannot read from or write to production resources.

The phase completes the operational work left after the isolated demo safeguards landed: provision the dedicated resources, configure the deployment, initialize the Admin account, seed the demo database, verify the full login and workflow path, and document the operator-only reset procedure.

## Approved Decisions

- Use a dedicated demo stack rather than cloning production configuration or creating an ephemeral stack per deployment.
- Use a separate Neon project/database, Neon Auth instance, and Vercel project.
- Make `/login` publicly reachable; require Neon Auth for every application route.
- Use `willylai@fimmick.com` as the invited demo Admin account.
- Set or reset the password only through Neon Auth email. Kossilon code and operator tooling never receive the password.
- Keep demo mutations persistent across sessions and deployments.
- Reset demo data only through an operator CLI command; do not add a reset button or maintenance endpoint.
- Keep WhatsApp and email on simulated adapters and label their results as demo activity.
- Leave production resources and configuration unchanged.

## Resource Architecture

The live demo has three dedicated resource boundaries:

1. A Neon project/database containing only demo schema and synthetic Kossilon data.
2. A Neon Auth instance associated only with the demo environment.
3. A Vercel project such as `kossilon-hub-demo`, deployed from the shared application codebase.

The demo deployment receives its own bindings:

- `DATABASE_URL` points to the demo Neon database.
- `NEON_AUTH_URL` points to the demo Neon Auth instance.
- `NEON_AUTH_COOKIE_SECRET` is generated for and stored only in the demo deployment.
- `FIRM_ID` identifies the demo firm configuration, using `kossilon-demo` unless the deployment validator requires another non-production value.

Production environment values are not copied into the demo. The setup process verifies resource identity before migrations or seeds can run. Live WhatsApp, email, storage, scanning, and backup credentials remain unset unless a later separately approved phase enables them.

## Authentication And Access

The demo keeps the existing email/password Neon Auth path. Open signup remains disabled.

1. An operator invites or initializes `willylai@fimmick.com` in the demo Neon Auth instance.
2. Neon Auth sends an invite or password-reset email.
3. The user chooses the password privately through Neon Auth.
4. The operator obtains the resulting Neon Auth user ID through the approved provider workflow.
5. The demo seed maps that user ID to the active seeded Admin staff profile.
6. A successful Neon session resolves the profile and Admin role from the demo database.

The login page is public so the demo can be used without Vercel Deployment Protection. All application routes remain protected. A valid Neon session without an active linked staff profile fails closed and receives no application access.

Passwords, password hashes, reset links, session tokens, connection strings, and cookie secrets must never appear in source, Git history, PR text, command output, screenshots, or verification artifacts.

## Database Lifecycle

Migrations run against the verified demo database before seeding. The existing guarded demo seed creates deterministic synthetic companies, annual-return cases, work items, documents, payment proofs, notifications, and audit records. Re-running the seed is idempotent and preserves the Admin Auth mapping supplied for the demo.

Normal demo mutations persist. Redeploying the application does not reset the database.

The operator-only reset command restores deterministic seed state. It must:

- Require explicit demo database, demo firm, and Admin Auth identifiers.
- Refuse to fall back to `DATABASE_URL` or any production default.
- Reject a target matching a supplied production database identity.
- Require an explicit confirmation flag naming the demo firm.
- Run the reset inside the narrowest practical transaction boundary.
- Preserve or reapply the linked Admin Auth user ID.
- Print only safe status information and row counts.

No public reset route, in-app reset control, scheduled reset, or deployment-triggered reset is added.

## Simulated Integrations

WhatsApp and email actions continue through the application's durable notification and outbox paths, using the existing local or simulated transports. The UI identifies their provider state as demo activity and must not imply that a client received a real message.

Simulated sends record queued, delivered, failed, and retryable states so the operational workflow remains realistic. No live provider credentials are configured, and no network request is sent to a WhatsApp or email provider.

## Failure Handling

- Missing Auth, database, firm, or cookie configuration fails deployment validation.
- Resource-separation checks run before remote migration, seed, or reset operations.
- Migration failure stops seeding.
- Seed or reset failure does not print success and does not expose secret values.
- Unknown, inactive, or unlinked Auth identities are denied.
- Provider simulation failures remain visible as retryable outbox records.
- Production-equivalent resource identifiers stop the operation before a database connection is opened.

Provisioning commands remain operator-driven. Each external resource creation, environment-variable write, account invitation, remote migration, seed, reset, and live login test requires explicit approval immediately before execution.

## Verification Strategy

### Configuration And Safety

- Run the existing demo environment validator using redacted output.
- Prove the demo database and Auth instance are distinct from production.
- Confirm local provider mode and public demo identities are disabled in the production build.
- Search source, logs, and artifacts for password-like values, connection strings, tokens, and cookie secrets.

### Authentication

- Verify `/login` returns successfully without a session.
- Verify anonymous access to application routes redirects to login.
- Complete the invite or password-reset flow privately.
- Verify login, Admin profile resolution, protected-route access, and logout.
- Verify an unknown or unlinked Auth user remains forbidden.

### Workflow

- Confirm seeded companies, annual-return cases, work items, documents, payment proofs, and notifications are visible.
- Perform at least one authorized Admin workflow mutation and verify it persists after a reload.
- Exercise simulated WhatsApp and email activity and verify visible outbox state without external delivery.
- Run the operator reset, verify deterministic seed restoration, and confirm the Admin can still sign in.

### Regression And Presentation

- Run focused demo seed, validator, and Auth mapping tests.
- Run typecheck, lint, production import checks, the production build, and secret scanning.
- Verify desktop and mobile layouts for login and representative protected routes.
- Confirm no console errors, failed application requests, overlapping controls, or horizontal overflow.
- Verify production deployment, Auth configuration, and data were not modified.

## Completion Criteria

The phase is complete when:

- A dedicated demo Neon database, Neon Auth instance, and Vercel deployment exist and pass separation checks.
- `willylai@fimmick.com` can privately set a password and authenticate.
- The Neon Auth identity resolves to the active seeded Admin profile.
- Public login, protected-route redirects, Admin access, logout, seeded data, and representative mutations work.
- Demo data persists until the operator runs the guarded reset command.
- The reset restores deterministic data without breaking the Admin mapping.
- WhatsApp and email actions visibly use simulated transports and contact no live provider.
- Automated checks and desktop/mobile verification pass.
- No production resource, secret, deployment, or data is changed.

## Out Of Scope

- First-firm production provisioning.
- Live WhatsApp, transactional email, R2, malware scanning, backup, or domain configuration.
- Vercel Deployment Protection in front of the public login page.
- Public demo credentials or one-click identities.
- Scheduled, deployment-triggered, in-app, or HTTP-triggered demo reset.
- Shared-database tenant isolation or ephemeral per-deployment demo branches.
- New business workflows or unrelated product features.
