# Production Assignment And SLA Platform Design

## Summary

This phase turns the existing annual-return command center into a production-capable vertical slice for multiple company-secretarial firms.

Each firm receives an isolated Cloudflare Worker deployment and R2 bucket managed by the platform operator. Each firm supplies and owns its Neon project and WhatsApp account. The firm deployment connects only to that firm's resources; there is no runtime tenant selector and no shared application database.

The production slice adds Neon Auth, private document storage, role and company authorization, a staff work queue, manager-confirmed assignment recommendations, configurable business-hour SLAs, escalation processing, transactional WhatsApp delivery, and complete audit history.

## Approved Decisions

- Productionize the annual-return, document-review, payment-proof, portal, and WhatsApp follow-up workflow as one vertical slice.
- Support multiple firms through isolated deployments, not a shared multi-tenant runtime.
- Use one codebase and one repeatable deployment template.
- Manage Cloudflare Workers and R2 resources centrally, with isolated resources per firm.
- Require each firm to provide its own Neon database and WhatsApp credentials.
- Use Neon Auth first for staff and client identity.
- Disable open signup.
- Use invite-only staff accounts and invite-only client magic links.
- Use manager-confirmed assignment recommendations; never auto-assign in this phase.
- Use firm-configurable, service-specific business-hour SLA policies.
- Keep unrelated demo routes out of the productionization scope.
- Do not provision live cloud resources, change paid services, or store real secrets without separate user approval.

## Goals

- Give staff a production work queue for annual-return actions.
- Let managers assign and reassign work with explainable recommendations.
- Track internal response and completion SLAs independently from statutory filing deadlines.
- Warn and escalate before and after SLA breaches.
- Authenticate staff and clients using the firm's Neon Auth instance.
- Authorize every protected read and mutation by role, team, company, and case scope.
- Store real private documents in a per-firm R2 bucket.
- Persist document metadata, workflow state, assignments, SLA state, notifications, and audit records in the firm's Neon database.
- Deliver and reconcile WhatsApp messages through the firm's own provider credentials.
- Make per-firm deployments reproducible, observable, testable, and reversible.

## Non-Goals

- No shared control-plane application or cross-firm database.
- No runtime tenant switching, tenant header, or tenant selector.
- No generic workflow builder.
- No AI-controlled or fully automatic assignment.
- No real Companies Registry filing API.
- No productionization of incorporation, deregistration, CRM, knowledge-base, or unrelated demo routes.
- No accounting ledger, payment gateway, refunds, or invoice settlement system.
- No public R2 objects or authorization through object URLs.
- No custom authentication implementation when Neon Auth lacks a required capability.
- No automatic creation of Neon projects or WhatsApp accounts.

## Architecture

### Per-Firm Deployment Boundary

Each firm deployment contains:

- One Cloudflare Worker built from the shared application codebase.
- One R2 bucket dedicated to the firm.
- One Hyperdrive binding connected to the firm's Neon Postgres database.
- One Neon Auth base URL and cookie-signing secret for the firm's Neon branch.
- One set of WhatsApp provider credentials supplied by the firm.
- One transactional-email configuration for invitations, magic links, and SLA alerts.
- Firm-specific domain, trusted origins, secrets, and observability labels.

The deployment identity is the firm identity. Request data cannot choose a different firm. A compromised or incorrect tenant identifier therefore cannot redirect a request to another firm's database or object store.

### Application Layers

The Worker is divided into focused units:

1. **Authentication adapter**
   - Integrates the current Neon Auth SDK for TanStack/React and Worker-compatible server handling.
   - Verifies server-side sessions and manages secure cookies.
   - Exposes a normalized authenticated identity to server functions.

2. **Authorization policy**
   - Resolves staff roles, teams, active status, and client company memberships from Postgres.
   - Guards every protected query and mutation.
   - Never trusts role or company scope supplied by the browser.

3. **Domain repositories**
   - Extend the existing annual-return Postgres repository rather than replacing it with browser state.
   - Add focused repositories for work items, SLA policy, documents, assignments, outbox messages, and audit queries.

4. **Service adapters**
   - R2 document storage.
   - WhatsApp outbound and inbound transport.
   - Transactional email delivery.
   - Structured logging and integration health checks.

5. **Route and UI layer**
   - Reads through server functions and React Query.
   - Performs mutations only through authorized server functions.
   - Presents role-specific controls and recoverable error states.

## Authentication And Authorization

### Neon Auth First

Neon Auth is the authoritative system for users, credentials, sessions, verification tokens, and supported authentication plugins. Auth records live in the firm's `neon_auth` schema and branch with the firm's database.

The application does not store passwords, generate its own login sessions, or run a parallel Better Auth server.

Neon Auth is powered by Better Auth but does not currently allow arbitrary custom server plugins. This design therefore uses only capabilities exposed and supported by the firm's Neon Auth project.

### Staff Authentication

- Staff sign in with email and password.
- Open staff registration is disabled.
- Admins invite staff and assign an application role after the Neon Auth user exists.
- Production launch requires a Neon Auth-supported second factor for staff.
- TOTP is preferred when exposed by the current Neon Auth project configuration.
- If Neon Auth cannot enforce an acceptable staff second factor at implementation time, production launch is blocked pending a user-approved design revision. The app will not silently replace it with custom auth code.

### Client Authentication

- Clients are invited by staff and sign in with Neon Auth magic links.
- Open client signup is disabled.
- Magic links are short-lived and single-use according to Neon Auth's supported configuration.
- A valid session alone grants no company data access; the user must also have an active `client_company_membership` record.

### Application Roles

Application roles are stored separately from Neon Auth credentials:

- `admin`: manage users, integrations, SLA policies, calendars, and complete audit access.
- `manager`: view team queues, confirm assignments, override recommendations, reassign work, acknowledge escalations, and inspect team audit history.
- `staff`: read permitted cases, perform assigned work, and execute actions allowed by existing annual-return permissions.
- `client`: read and mutate only portal resources for explicitly granted companies and cases.

Every protected server function receives an authenticated identity, loads current authorization data from Postgres, and fails closed if the identity, profile, role, membership, or target record is missing or inactive.

## Data Model

### Identity And Access

`staff_profiles`

- `auth_user_id`
- `name`
- `role`
- `team_id`
- `active`
- `capacity_limit`
- timestamps

`staff_skills`

- `staff_profile_id`
- `skill_code`
- `proficiency`

`client_company_memberships`

- `auth_user_id`
- `company_id`
- `status`
- `invited_by`
- `expires_at` when access is temporary
- timestamps

### Work Items

`work_items` is the operational unit shown in the staff queue. A case may have several work items over its lifecycle.

Required fields include:

- `id`
- `case_id`
- `company_id`
- `work_type`
- `title`
- `status`
- `priority`
- `required_skill_code`
- `owner_id`
- `reviewer_id`
- `created_at`
- `started_at`
- `completed_at`
- `sla_policy_version_id`
- `sla_started_at`
- `sla_warning_at`
- `sla_due_at`
- `sla_breached_at`
- `escalation_status`
- optimistic concurrency version

Work items are created by explicit domain events such as document upload, payment-proof submission, filing-packet readiness, or manual manager action. Creation must be idempotent for the originating event.

### Assignment History

`assignment_events` records:

- Work item and previous/new owner.
- Ranked recommendation snapshot.
- Score factors for each displayed candidate.
- Manager decision.
- Required override reason when the chosen owner is not the top recommendation or eligibility rules are bypassed.
- Actor and timestamp.

Recommendation snapshots are audit evidence, not durable ownership state. `work_items.owner_id` remains the current source of truth.

### SLA Policies And Calendars

`sla_policies` are versioned by service and work type. A policy defines:

- Target business minutes.
- Warning threshold.
- Breach threshold.
- Escalation recipient role or team.
- Priority modifiers.
- Active dates and version.

`business_calendars` define:

- Firm timezone, defaulting to `Asia/Hong_Kong`.
- Working weekdays and intervals.
- Firm holidays and exceptional closures.

When a work item starts its SLA, warning and due timestamps are calculated once and stored on the item with the policy version. Later policy edits do not rewrite existing SLA commitments.

### Documents

The `documents` table stores authorization and workflow metadata while R2 stores bytes:

- `id`
- `company_id`
- `case_id`
- `work_item_id` when applicable
- `object_key`
- original file name
- content type
- byte size
- checksum
- document category
- upload status
- review status
- uploader identity and type
- reviewer identity
- rejection reason and note
- timestamps

Object keys are opaque identifiers. They are not public URLs and do not grant access.

### Escalation And Audit

`escalation_events` stores warning, breach, acknowledgement, and resolution events. A uniqueness constraint prevents duplicate events for the same work item, SLA snapshot, and threshold.

Existing annual-return audit events are extended or complemented by a shared immutable audit format containing actor, action, target, result, summary, correlation ID, and structured metadata.

## Assignment Recommendation

The recommendation service ranks only eligible staff. Eligibility requires:

- Active staff profile.
- Team access to the company or case.
- Required role and skill.
- No owner/reviewer conflict for actions requiring separation of duties.

The deterministic score includes:

- Required-skill match.
- Active workload weighted by SLA urgency.
- Current capacity limit.
- Availability.
- Existing relationship to the case when continuity is beneficial.
- Conflict and overload penalties.

The UI explains the main factors. A manager confirms the recommendation or chooses another eligible staff member. An override reason is required when bypassing the top recommendation or an overload warning.

Assignment executes in a transaction that locks the work item, rechecks eligibility and version, updates ownership, and appends assignment and audit events.

## SLA Processing

### Clock Behavior

- SLA timing uses the firm's business calendar and timezone.
- Statutory filing deadlines remain separate and visible.
- Pausing an SLA requires an explicit supported pause reason and audit event.
- Client-waiting pauses are allowed only for configured work types.
- Completing or cancelling a work item stops future escalation processing.

### Scheduled Evaluation

A per-firm Cloudflare Cron Trigger evaluates open work items on a short interval.

For each threshold crossed, it:

1. Inserts an idempotent escalation event.
2. Updates the work item's current escalation state.
3. Adds an in-app notification.
4. Enqueues configured email or WhatsApp notifications through the outbox.
5. Writes an audit event with a shared correlation ID.

Repeated cron runs cannot emit the same threshold event twice.

## Document Storage Workflow

### Upload

1. The client or staff member requests an upload intent for an authorized company, case, and document category.
2. The Worker validates role, membership, file constraints, and workflow state.
3. The file is written to the firm's private R2 bucket using an opaque object key.
4. Postgres metadata is finalized with checksum and size.
5. The related annual-return action and work item are updated in a transaction.

An upload that reaches R2 but not Postgres remains inaccessible because no authorized metadata record exists. A scheduled cleanup removes expired upload intents and orphan objects.

### Download

Downloads always pass through a Worker route that authenticates the request and authorizes access against current Postgres records. The Worker streams the R2 object only after the authorization check succeeds.

### Validation

The production slice enforces configurable size, file-extension, MIME-type, and category rules. Unsupported files fail before workflow state changes. Production launch with document uploads also requires an approved malware-scanning provider and a verified quarantine-to-clean workflow. Until that provider is separately approved and integrated, document uploads may run only in local and disposable test environments.

## WhatsApp And Email Delivery

### Transactional Outbox

Workflow transactions insert outbound message records into `notification_outbox`. A dispatcher sends messages after commit.

Each outbox record includes:

- Firm deployment channel configuration.
- Recipient and template data.
- Provider-neutral message payload.
- Idempotency key.
- Attempt count and next retry time.
- Provider message ID.
- Delivery state and last error.

Retries use bounded exponential backoff. Permanently failed messages remain visible to admins and managers for manual retry or cancellation.

### WhatsApp Inbound

- Verify the provider signature before processing.
- Deduplicate by provider message ID.
- Resolve contacts only inside the firm's database.
- Persist the inbound event before triggering case or enquiry logic.
- Return safe provider responses without leaking application errors.

### Authentication And Alert Email

Neon Auth handles supported invitation and magic-link flows. Where custom delivery is required, use Neon Auth's supported SMTP or webhook configuration rather than reimplementing token issuance.

Operational SLA alerts use the transactional outbox and the firm's configured email sender.

## User Experience

### `/work-queue`

The new daily operating surface contains:

- `My work`, `Team queue`, and `Breached` tabs.
- Stable counters for due today, at risk, breached, and unassigned.
- Dense table or list rows with work type, company, owner, SLA state, priority, and blocker.
- Filters for owner, team, work type, SLA state, priority, and case status.
- Direct navigation to the annual-return case and relevant review action.
- Empty, loading, partial-error, and stale-data states.

### Manager Assignment And Escalation

Managers can:

- View ranked candidates with score explanations.
- Confirm the recommendation.
- Override with a reason.
- Reassign or unassign work.
- Acknowledge and resolve escalations.
- Change priority with a reason.
- Inspect assignment and SLA history.

### `/annual-returns` And `/annual-returns/$id`

The existing command center remains the case context and gains:

- Current work-item ownership.
- SLA warning/breach state.
- Manager assignment action.
- Work-item timeline.
- Real persisted document, payment-proof, and filing state.

### `/portal`

The portal becomes an authenticated client action center:

- Neon Auth magic-link sign-in.
- Company selection only when the user has multiple active memberships.
- Real private uploads and authorized downloads.
- Review outcomes and replacement requests.
- Payment-proof status.
- Filing receipt access after authorization and completion.

### Settings And Health

Admins receive focused settings for:

- Staff invitations, roles, teams, skills, and capacity.
- Client invitations and company memberships.
- SLA policy versions and business calendars.
- WhatsApp and email integration status.
- R2, Hyperdrive, Neon Auth, cron, and outbox health.

Secrets are configured through Cloudflare bindings and secret management, never displayed after entry and never stored in application tables.

## Error Handling And Guardrails

- Neon Auth or database failure causes protected reads and mutations to fail closed.
- Mutations are transactional and return stable domain errors.
- Concurrent assignment uses row locking and optimistic version checks.
- R2 failures do not advance document workflow state.
- Database finalization failures leave objects inaccessible and eligible for cleanup.
- WhatsApp and email failures remain retryable outbox records rather than rolling back successful domain work.
- Cron processing is idempotent and safe to rerun.
- Completed cases and completed work items reject incompatible mutations.
- Cross-company and cross-role requests return not found or forbidden without revealing record details.
- Audit events are append-only through application APIs.

## Observability

Structured logs include:

- Deployment/firm label.
- Request and correlation IDs.
- Authenticated actor ID when available.
- Case, work-item, document, and outbox IDs.
- Operation name, result, latency, and safe error code.

Health surfaces include:

- Neon Auth session check.
- Hyperdrive/Postgres connectivity.
- R2 read/write probe using a dedicated health object.
- WhatsApp credential and webhook state.
- Transactional email state.
- Cron last-success timestamp.
- Outbox backlog, retry count, and permanent failures.
- Orphan-upload cleanup status.

Logs must not contain credentials, auth tokens, magic-link tokens, full document contents, or unnecessary personal data.

## Testing And Verification

### Unit Tests

- Business-calendar arithmetic across working hours, weekends, holidays, and timezone boundaries.
- SLA snapshot and pause/resume behavior.
- Assignment eligibility, scoring, conflicts, and deterministic ordering.
- Role, team, company, case, and work-item authorization policies.
- Outbox idempotency and retry scheduling.

### Repository And Integration Tests

- Migrations against disposable Neon branches.
- Annual-return repository reads and mutations using production schemas.
- Concurrent assignment and escalation evaluation.
- Neon Auth identity-to-profile resolution.
- R2 upload, finalization, download authorization, and orphan cleanup.
- WhatsApp signature verification, inbound deduplication, outbound idempotency, and retry behavior.

### Route And End-To-End Tests

- Anonymous, inactive, wrong-role, wrong-team, and wrong-company denial paths.
- Staff sign-in and required second-factor flow supported by Neon Auth.
- Client invitation and magic-link flow.
- Manager recommendation, confirmation, override, and reassignment.
- SLA warning, breach, acknowledgement, and resolution.
- Client upload, staff review, replacement, payment proof, filing packet, and receipt journey.
- No cross-company data or document access through direct IDs or altered URLs.

### Release Gates

- Migration rehearsal and rollback verification on a disposable Neon branch.
- Full unit, integration, route, and end-to-end suites pass.
- Lint and production build pass.
- Secret scan and dependency audit pass to the agreed threshold.
- A fresh per-firm deployment from the template succeeds.
- Auth, R2, Hyperdrive, cron, email, and WhatsApp smoke checks pass.
- Cross-company access probes fail closed.
- Malware-scanning quarantine, clean-file release, and rejected-file handling pass before document uploads are enabled in production.
- Backup and restore procedure is documented and rehearsed.
- Neon Auth staff MFA capability is confirmed before production launch.

## Deployment And Provisioning

The repository will contain a repeatable per-firm deployment template and validation script. It will define required bindings and secrets without committing their values.

Expected firm inputs include:

- Neon connection details and Neon Auth configuration.
- WhatsApp provider credentials and webhook details.
- Firm domain and trusted origins.
- Email sender configuration.
- Business calendar and initial SLA policies.
- Initial admin identity.

The implementation may provide local configuration stubs, schemas, scripts, and documentation without external side effects. Actual creation or modification of Cloudflare Workers, R2 buckets, Hyperdrive configurations, cron triggers, domains, Neon Auth, paid email services, malware-scanning services, or production secrets requires explicit user approval at the provisioning step.

## Implementation Boundaries

The phase should build small, testable modules rather than extending the existing large local stores.

Expected areas include:

- Neon Auth client/server adapter and authorization policies.
- Database migrations for profiles, memberships, work items, SLA policies, calendars, documents, escalation events, outbox, and audit support.
- Extensions to the annual-return Postgres repository and server functions.
- Focused work-item, SLA, assignment, document-storage, and notification modules.
- Cloudflare Worker bindings and per-firm deployment template.
- New `/work-queue` route.
- Production updates to annual-return, documents, payments, WhatsApp automation, portal, and settings routes.
- Focused unit, integration, route, and end-to-end tests.

The implementation plan must split this design into reviewable stages. Infrastructure adapters and schemas should land before route conversion. The annual-return vertical slice should be migrated incrementally so mocked and production-backed state cannot silently diverge for the same case.

## Acceptance Criteria

- A new firm deployment can be configured from the shared template without code changes.
- The deployment connects only to that firm's Neon, Neon Auth, R2, WhatsApp, and email resources.
- Staff and clients authenticate through Neon Auth; open signup is disabled.
- Staff production access requires an approved Neon Auth-supported second factor.
- Admin, manager, staff, and client permissions fail closed on unauthorized access.
- Managers receive explainable assignment recommendations and must confirm or override them.
- SLA warning and due timestamps use versioned policy snapshots and the firm's business calendar.
- SLA warnings and breaches are emitted once per threshold and remain auditable.
- Client documents are private in R2 and accessible only through authorized Worker routes.
- Document, payment-proof, review, filing, and receipt state persists in Neon.
- WhatsApp and email delivery use an idempotent transactional outbox with visible retry state.
- Every sensitive mutation appends an audit event.
- The complete annual-return production journey passes automated and manual verification.
- No live cloud resource or secret is provisioned without separate explicit approval.

## Technical References

- [Cloudflare Workers database connections](https://developers.cloudflare.com/workers/databases/connecting-to-databases/)
- [Cloudflare Neon and Hyperdrive integration](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Neon Auth branchable identity architecture](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)
- [Neon Auth SDK migration and session model](https://neon.com/docs/auth/migrate/from-auth-v0.1)
- [Neon Auth product updates](https://neon.com/blog/category/changelog)
