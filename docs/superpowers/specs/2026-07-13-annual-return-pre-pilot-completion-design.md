# Annual Return Pre-Pilot Completion Design

**Date:** 2026-07-13

## Purpose

Complete the existing annual-return production vertical slice so one full staff-and-client journey is reliable before any live firm infrastructure is provisioned. The phase closes warning-only route actions, separates demo and production behavior, exercises production contracts through deterministic local adapters, and makes the repository verification gates clean and reproducible.

## Scope

The completed journey covers manager-confirmed assignment and SLA tracking, staff case work, client document and payment-proof submission, staff review, filing packet submission, receipt acceptance, notifications, and audit history.

This phase does not create or modify live Neon, Cloudflare, R2, Hyperdrive, WhatsApp, email, malware-scanning, backup, domain, or secret resources. Those changes require separate explicit approval.

## Chosen Approach

Use incremental vertical closure. Preserve the existing repositories, server functions, private-document storage contracts, notification outbox, and route structure. Convert each remaining warning-only production action into a real server mutation with targeted React Query invalidation.

This approach has lower regression risk than introducing a new application-service layer or rewriting the production routes. New abstractions are added only where an existing server-function boundary is genuinely missing.

## Architecture And Boundaries

Production routes use React Query exclusively for reads, mutations, cache invalidation, pending states, and retry handling. They never import browser-store mutation functions. Existing stores may retain pure selectors and demo fixtures, but only behind an explicit demo-mode boundary that cannot activate in production.

Each production action calls a narrowly scoped server function that:

1. Authenticates through Neon Auth.
2. Confirms the actor's firm, company membership, and role.
3. Validates identifiers, input, and current workflow state.
4. Executes the existing repository operation.
5. Writes audit, SLA, and notification-outbox records transactionally where required.
6. Returns authoritative server state for query-cache reconciliation.

Documents, scanning, WhatsApp, email, and object storage retain production-facing interfaces. Local development binds deterministic adapters that exercise persistence, authorization, quarantine, retries, idempotency, and delivery state without contacting external services.

Demo mode uses a separate data-provider composition selected at startup. Demo identifiers and state cannot enter production server functions. Production UUIDs cannot fall back to browser state after an error.

## Workflow Components

### Case Operations

Assignment, owner changes, status transitions, checklist items, notes, payment state, filing packet submission, receipt acceptance, and completion locking use annual-return server functions. The route reflects pending state and refreshes the authoritative case after every successful mutation.

### Client Portal

Authenticated company members can view only their permitted cases, upload required documents and payment proof, replace rejected evidence, and see review outcomes. Staff-only actions are never exposed through the portal authorization boundary.

### Document Review

Uploads move through upload intent, private object write, quarantine, deterministic scan, and either available or rejected state. Staff review decisions update the case and audit timeline. Download authorization is checked against the current actor and company membership before private object access is granted.

### Notifications

"Send now" creates a durable outbox entry rather than mutating UI-only state. The local dispatcher records a simulated provider result through the same idempotency, retry, and delivery-state path used by the production transport.

### Integration Health

Settings reports readiness for auth, database, storage, scanning, WhatsApp, email, cron, and backups. It lists missing runtime binding names without reading or exposing secret values.

## Data Flow

A route action submits validated input to a server function. The server function authenticates and authorizes the actor, checks current workflow state, and invokes the relevant repository. The repository transaction writes business state plus audit, SLA, escalation, or outbox records as required. The server function returns authoritative state, and the client invalidates only the affected query keys.

Cross-domain actions remain transactional at the business-state boundary. Provider delivery happens asynchronously from the durable outbox and cannot roll back an already-committed business action.

## Failure Handling

Mutations disable duplicate submission while pending and preserve entered data on failure. Authorization failures return an inaccessible or not-found state without revealing another company's records. Validation failures show specific corrective messages.

Stale-state conflicts refresh the authoritative record before another action is allowed. Duplicate packet submissions, receipt acceptance, reminders, and uploads are idempotent or fail with a clear current-state response. Provider failures remain in the outbox for bounded retry and surface as delivery status rather than false success.

Production requests never fall back to demo data or browser mutations after server, authorization, or provider errors.

## Verification Strategy

Automated coverage includes:

- Repository invariants and transactional behavior.
- Server-function authentication, role, firm, and company authorization.
- Route contracts proving production routes cannot import browser mutations.
- Full workflow integration through local storage, scanner, outbox, and delivery adapters.
- Duplicate actions, stale updates, cross-company access, quarantine rejection, failed delivery, and retry behavior.
- Deployment dry-run checks that redact secret values and report unprovisioned external services as blocked.

Browser verification covers staff and client journeys at desktop and mobile sizes, including loading, empty, error, and success states. It records console errors, failed network requests, and horizontal overflow.

## Completion Criteria

The phase is complete only when:

- The full annual-return journey has no warning-only or UI-only production controls.
- Production routes use server-backed reads and mutations and cannot import browser mutation stores.
- Demo behavior is available only through an explicit non-production flag and separate provider composition.
- TypeScript exits with no errors.
- Lint exits with no errors.
- The complete test suite passes, with database-dependent tests skipped only when their test binding is absent.
- The production build succeeds.
- Deployment validation passes local structure and safety gates while marking live integrations as blocked.
- Desktop and mobile browser verification has no console errors or horizontal overflow.
- No live resource, paid service, domain, or secret is created or changed.

## Out Of Scope

- Live first-firm provisioning or production deployment.
- Productionization of incorporation, deregistration, CRM, knowledge-base, or unrelated demo routes.
- New billing, reporting, or analytics capabilities.
- A broad application-service rewrite or clean-slate route redesign.
