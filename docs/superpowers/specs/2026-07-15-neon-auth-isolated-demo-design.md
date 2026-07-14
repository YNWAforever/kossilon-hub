# Neon Auth Isolated Demo Design

**Date:** 2026-07-15
**Status:** Approved design, pending written-spec review
**Scope:** Deployed Kossilon demo backed by a separate Neon project and Neon Auth instance

## Goal

Provide a deployed demo that signs in through real Neon Auth while keeping the existing production deployment and data untouched. The demo will use synthetic company-secretary workflow data and an isolated database boundary.

## Decisions

- Use a separate Neon project/database for the demo.
- Use a separate Neon Auth project connected to the demo environment.
- Use a separate Vercel deployment, such as `kossilon-hub-demo.vercel.app`.
- Use `willylai@fimmick.com` as the demo Neon Auth account email.
- Give the demo account the `Admin` role so the complete workflow can be explored.
- Keep the production URL `https://kossilon-hub.vercel.app` unchanged.
- Keep WhatsApp, email, R2, malware scanning, backups, and other live integrations blocked or on local adapters.
- Do not add public one-click demo identities or store a password in Git, source code, or PR text.

## Architecture

The demo deployment uses the same application code as production but receives a separate environment binding set:

- `DATABASE_URL` points to the demo Neon database.
- `NEON_AUTH_URL` points to the demo Neon Auth instance.
- `NEON_AUTH_COOKIE_SECRET` is a demo-only secret stored in the demo deployment environment.
- `FIRM_ID` identifies the demo deployment configuration.
- Provider bindings remain unset or use the existing local adapters according to the pre-pilot safety contract.

The application continues to use the existing Neon Auth provider path. The demo user is created through Neon Auth, then linked to a demo `staff_profiles` record using the returned `auth_user_id`. The database contains only synthetic companies, cases, documents, payment proofs, work items, notifications, and audit records.

## Seed And Lifecycle

The seed must be deterministic and idempotent. Stable demo identifiers, email, company registration numbers, and source event keys make reruns safe. The seed must not delete or update records outside the demo database.

The account lifecycle is managed through Neon Auth: invite or initialize the account, set or reset the password there, and revoke the account there. No credential value is accepted by the seed script or committed to the repository.

## User Flow

1. Open the separate demo deployment's `/login` route.
2. Enter the Neon Auth email and password for `willylai@fimmick.com`.
3. Neon Auth establishes the session.
4. The server resolves the staff profile and Admin role from the demo database.
5. The user can explore seeded annual-return, work-queue, portal, payment-proof, and notification flows.
6. External sends remain local or blocked and are visibly represented by the existing provider state.

## Safety And Verification

- Production URL and production environment variables are not modified.
- Demo database and Neon Auth project are verified to be distinct from production before any seed runs.
- Login, logout, protected-route redirects, Admin access, seeded data visibility, and representative workflow mutations are verified against the demo deployment.
- Cross-environment access is rejected: the demo auth URL must not point at production and the demo database URL must not point at production.
- No password, token, cookie secret, or provider credential appears in source, logs, PR text, or verification output.
- Live WhatsApp, email, storage, scanner, backup, and browser-evidence gates remain explicit blockers until separately approved.

## Required External Setup

Implementation can prepare the code, seed contract, runbook, and verification checks locally. Creating the Neon project, Neon Auth instance, Vercel deployment, deployment secrets, and the real demo account are external resource changes and require explicit provisioning approval immediately before execution.

## Out Of Scope

- Multi-tenant row-level isolation in the existing production database.
- Public one-click demo identities.
- Changing the production deployment to use demo data.
- Enabling live WhatsApp, email, R2, malware scanner, backups, or other external providers.
