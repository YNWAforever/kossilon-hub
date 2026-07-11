# Production Assignment And SLA Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-backed annual-return workflow with isolated per-firm Cloudflare deployments, Neon Auth, private R2 documents, manager-confirmed assignment recommendations, business-hour SLAs, escalation processing, and durable notification delivery.

**Architecture:** Keep the deployment as the firm boundary: one Worker, R2 bucket, Hyperdrive binding, Neon Auth endpoint, and integration-secret set per firm. Replace browser-owned state only for the annual-return vertical slice, preserving the existing Postgres repositories and adding focused auth, work-item, SLA, document, and notification modules behind authorized TanStack Start server functions.

**Tech Stack:** TypeScript 5.8, React 19, TanStack Start/Router/Query, Vite 8, Nitro Cloudflare target, Neon Postgres, Neon Auth via `@neondatabase/neon-js`, Postgres.js, Cloudflare Hyperdrive/R2/Cron, Zod, Vitest, WOZTELL-compatible WhatsApp APIs.

## Global Constraints

- The deployment identity is the firm identity; never accept a tenant or firm selector from request data.
- Each firm owns its Neon project and WhatsApp account; the platform manages isolated Worker and R2 resources per firm.
- Neon Auth is authoritative for credentials and sessions; application tables own roles, teams, skills, and company memberships.
- Open signup is disabled. Staff are invited; clients use invite-only Neon Auth magic links.
- Staff production access requires an approved Neon Auth-supported second factor. Block production launch if that capability is unavailable.
- Managers must confirm or override assignment recommendations. Never auto-assign in this phase.
- SLA timestamps are immutable snapshots calculated from a versioned policy and `Asia/Hong_Kong` business calendar.
- R2 objects are private. Every upload/download is authorized through the Worker and Postgres metadata.
- Production document uploads remain disabled until an approved malware-scanning quarantine flow passes release verification.
- No live cloud resource, paid service, domain, secret, Neon Auth configuration, or production credential may be created or changed without separate explicit user approval.
- Preserve `.sdd-artifacts/` and `.superpowers/brainstorm/` as local untracked artifacts.

---

## Stage 1: Production Identity And Runtime

### Task 1: Per-Firm Runtime Contracts And Deployment Template

**Files:**

- Create: `src/server/runtime-env.ts`
- Create: `src/server/runtime-env.test.ts`
- Create: `wrangler.template.jsonc`
- Create: `scripts/validate-firm-runtime.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Worker bindings or local environment variables.
- Produces: `FirmRuntimeEnv`, `getFirmRuntimeEnv()`, `getRuntimeReadiness()`, and a no-secret deployment template used by all later tasks.

- [ ] **Step 1: Write the failing runtime-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { getFirmRuntimeEnv, getRuntimeReadiness } from "./runtime-env";

describe("firm runtime", () => {
  const fakeR2Bucket = {};
  const validEnv = {
    FIRM_ID: "firm-a",
    NEON_AUTH_URL: "https://firm-a.example.neon.tech/auth",
    NEON_AUTH_COOKIE_SECRET: "test-cookie-secret-at-least-32-characters",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    DOCUMENTS_BUCKET: fakeR2Bucket,
    WOZTELL_API_BASE_URL: "https://api.example.test",
    WOZTELL_ACCESS_TOKEN: "test-token",
    WOZTELL_CHANNEL_ID: "test-channel",
    WOZTELL_WEBHOOK_SECRET: "test-webhook-secret",
    EMAIL_FROM: "operations@example.test",
  };

  it("requires one fixed firm id and every production binding", () => {
    expect(() => getFirmRuntimeEnv({ FIRM_ID: "" })).toThrow(/FIRM_ID/);
    expect(getRuntimeReadiness({ FIRM_ID: "firm-a" })).toEqual(
      expect.objectContaining({ ready: false }),
    );
  });

  it("does not expose a request-controlled tenant field", () => {
    expect(Object.keys(getFirmRuntimeEnv(validEnv))).not.toContain("tenantId");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- --configLoader runner src/server/runtime-env.test.ts`

Expected: FAIL because `runtime-env.ts` does not exist.

- [ ] **Step 3: Implement the typed runtime boundary**

```ts
export type R2BucketLike = Pick<R2Bucket, "delete" | "get" | "head" | "put">;

export type FirmRuntimeEnv = {
  firmId: string;
  neonAuthUrl: string;
  neonAuthCookieSecret: string;
  databaseUrl: string;
  documentsBucket: R2BucketLike;
  woztellApiBaseUrl: string;
  woztellAccessToken: string;
  woztellChannelId: string;
  woztellWebhookSecret: string;
  emailFrom: string;
};

export type RuntimeReadiness = {
  ready: boolean;
  missing: string[];
};

export function getRuntimeReadiness(env: Record<string, unknown>): RuntimeReadiness;
export function getFirmRuntimeEnv(env?: Record<string, unknown>): FirmRuntimeEnv;
```

`wrangler.template.jsonc` must declare symbolic binding names for one Worker name, one R2 binding named `DOCUMENTS_BUCKET`, one Hyperdrive binding named `HYPERDRIVE`, and one cron trigger. It must contain no IDs or secrets. Add `validate:runtime` to `package.json` and ignore only generated local runtime files.

- [ ] **Step 4: Verify GREEN and validate the template**

Run: `npm.cmd test -- --configLoader runner src/server/runtime-env.test.ts`

Expected: PASS.

Run: `npm.cmd run validate:runtime -- --env-file .env.example`

Expected: non-zero with an exact list of missing production bindings, without printing secret values.

- [ ] **Step 5: Commit**

```powershell
git add package.json .gitignore wrangler.template.jsonc scripts/validate-firm-runtime.ts src/server/runtime-env.ts src/server/runtime-env.test.ts
git commit -m "feat: define per-firm runtime contract"
```

### Task 2: Production Identity, Access, Work, SLA, And Outbox Schema

**Files:**

- Create: `db/migrations/0006_production_assignment_sla_foundation.sql`
- Modify: `src/server/db/schema.sql`
- Modify: `scripts/db-seed-annual-return.ts`
- Create: `src/server/db/production-schema.test.ts`

**Interfaces:**

- Consumes: existing `users`, `teams`, `companies`, `annual_return_cases`, `documents`, and audit tables.
- Produces: durable tables and constraints consumed by Tasks 3-10.

- [ ] **Step 1: Write the failing schema contract test**

```ts
const requiredTables = [
  "staff_profiles",
  "staff_skills",
  "client_company_memberships",
  "business_calendars",
  "business_calendar_holidays",
  "sla_policies",
  "work_items",
  "assignment_events",
  "escalation_events",
  "notification_outbox",
  "document_upload_intents",
] as const;

it("defines the production workflow schema", () => {
  for (const table of requiredTables) expect(schemaSql).toContain(`create table ${table}`);
  expect(schemaSql).toContain("unique (work_item_id, sla_policy_version_id, threshold)");
  expect(schemaSql).toContain("auth_user_id text not null");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- --configLoader runner src/server/db/production-schema.test.ts`

Expected: FAIL listing the first missing production table.

- [ ] **Step 3: Add the migration and canonical schema**

The migration must:

- Reference Neon Auth users by stable text `auth_user_id`; do not foreign-key across a Neon-managed schema.
- Keep existing operational `users.id` UUIDs and link them through `staff_profiles.user_id`.
- Add `version integer not null default 1` to `work_items` for optimistic concurrency.
- Store `sla_warning_at`, `sla_due_at`, `sla_breached_at`, and policy version on each work item.
- Constrain role values to `Admin`, `Manager`, `Staff`, and `Client` only where application role data is stored.
- Use `on delete restrict` for audit/work history and `on delete set null` only for current optional ownership.
- Add indexes for open queue ordering, owner/team filters, SLA threshold scans, outbox retries, memberships, and orphan-upload cleanup.

- [ ] **Step 4: Seed one complete deterministic firm fixture**

Seed Amy as Admin, Ken as Manager, Mei as Staff, one client auth identity, skills, capacity, a Hong Kong calendar, versioned policies, and annual-return work items. Use stable UUIDs already used by repository fixtures.

- [ ] **Step 5: Verify schema and migration**

Run: `npm.cmd test -- --configLoader runner src/server/db/production-schema.test.ts`

Expected: PASS.

Run with an approved disposable test database only: `$env:DATABASE_URL=$env:TEST_DATABASE_URL; bun run db:migrate`

Expected: `Applied 0006_production_assignment_sla_foundation.sql`.

- [ ] **Step 6: Commit**

```powershell
git add db/migrations/0006_production_assignment_sla_foundation.sql src/server/db/schema.sql src/server/db/production-schema.test.ts scripts/db-seed-annual-return.ts
git commit -m "feat: add production workflow schema"
```

### Task 3: Neon Auth Adapter And Fail-Closed Authorization

**Files:**

- Create: `src/features/auth/types.ts`
- Create: `src/features/auth/neon-auth-client.ts`
- Create: `src/features/auth/neon-auth-server.ts`
- Create: `src/features/auth/authorization.ts`
- Create: `src/features/auth/authorization.test.ts`
- Modify: `src/features/auth/auth-context.tsx`
- Modify: `src/features/auth/route-guard.ts`
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/__root.tsx`
- Modify: `src/features/annual-return/session.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: Neon Auth session APIs and Task 2 access tables.
- Produces: `AuthenticatedActor`, `requireActor()`, `requireStaffActor()`, `requireClientCompanyAccess()`, and Neon-backed `AuthProvider` state.

- [ ] **Step 1: Write failing authorization tests**

```ts
export type AuthenticatedActor = {
  authUserId: string;
  userId: string | null;
  role: "Admin" | "Manager" | "Staff" | "Client";
  teamId: string | null;
  active: boolean;
};

it("denies an inactive staff actor", () => {
  expect(() => assertStaffAccess({ ...staff, active: false })).toThrow(/inactive/i);
});

it("denies a client without company membership", () => {
  expect(() => assertClientCompanyAccess(client, [])).toThrow(/not found|forbidden/i);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- --configLoader runner src/features/auth/authorization.test.ts src/features/auth/route-guard.test.ts`

Expected: FAIL because the Neon Auth adapter and policy functions do not exist.

- [ ] **Step 3: Install and isolate Neon Auth**

Add `@neondatabase/neon-js` at the current compatible version. `neon-auth-client.ts` creates the browser client from the fixed deployment URL. `neon-auth-server.ts` normalizes a verified Neon Auth session and accepts an injectable test adapter:

```ts
export type NeonSessionAdapter = {
  getSession(request: Request): Promise<{ user: { id: string; email: string } } | null>;
  signOut(request: Request): Promise<Response>;
};

export async function requireActor(
  request: Request,
  dependencies?: { auth?: NeonSessionAdapter; sql?: SqlClient },
): Promise<AuthenticatedActor>;
```

Do not preserve localStorage sessions as a production fallback. Keep demo auth only behind `VITE_ENABLE_DEMO_AUTH=true`, default false, and ensure server functions never trust it.

- [ ] **Step 4: Route every protected server action through the actor**

Replace `KOSSILON_ANNUAL_RETURN_ACTOR_ID` usage with `requireStaffActor(request)` and pass `actor.userId` into repository mutations. Client portal functions must call `requireClientCompanyAccess()` before loading case details.

- [ ] **Step 5: Verify GREEN**

Run: `npm.cmd test -- --configLoader runner src/features/auth src/features/annual-return/session.test.ts src/routes/-final-review-restorations.test.ts`

Expected: PASS, including anonymous, inactive, wrong-role, and wrong-company denials.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/features/auth src/features/annual-return/session.ts src/features/annual-return/session.test.ts src/routes/login.tsx src/routes/__root.tsx src/routes/-final-review-restorations.test.ts
git commit -m "feat: integrate Neon Auth authorization"
```

---

## Stage 2: Assignment And SLA Operations

### Task 4: Business Calendar, SLA Snapshot, And Recommendation Domain Logic

**Files:**

- Create: `src/features/work-items/types.ts`
- Create: `src/features/work-items/business-calendar.ts`
- Create: `src/features/work-items/business-calendar.test.ts`
- Create: `src/features/work-items/sla.ts`
- Create: `src/features/work-items/sla.test.ts`
- Create: `src/features/work-items/assignment.ts`
- Create: `src/features/work-items/assignment.test.ts`

**Interfaces:**

- Consumes: plain policy, calendar, work-item, and staff candidate values.
- Produces: pure deterministic functions used by repositories and UI.

- [ ] **Step 1: Write failing business-time and scoring tests**

```ts
expect(addBusinessMinutes("2026-07-10T08:00:00.000Z", 120, hkCalendar)).toBe(
  "2026-07-10T10:00:00.000Z",
);
expect(snapshotSla(policyV3, startedAt, hkCalendar)).toEqual({
  policyVersionId: policyV3.id,
  startedAt,
  warningAt: expect.any(String),
  dueAt: expect.any(String),
});
expect(rankAssignmentCandidates(input).map((item) => item.staffId)).toEqual([
  "amy-id",
  "mei-id",
]);
```

Cover lunch/closed intervals if configured, weekends, holidays, warning thresholds, deterministic tie-breaking by staff ID, skill exclusion, owner/reviewer conflict, capacity penalties, and workload weighted by breached/at-risk items.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- --configLoader runner src/features/work-items`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the pure interfaces**

```ts
export function addBusinessMinutes(startedAt: string, minutes: number, calendar: BusinessCalendar): string;
export function snapshotSla(policy: SlaPolicyVersion, startedAt: string, calendar: BusinessCalendar): SlaSnapshot;
export function rankAssignmentCandidates(input: AssignmentInput): AssignmentRecommendation[];
export function thresholdFor(workItem: WorkItem, now: string): "none" | "warning" | "breach";
```

No database, browser, network, or current-time reads are allowed inside these functions.

- [ ] **Step 4: Verify GREEN**

Run: `npm.cmd test -- --configLoader runner src/features/work-items`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/work-items
git commit -m "feat: add assignment and SLA domain logic"
```

### Task 5: Work-Item Repository, Assignment Transactions, And Escalation Evaluation

**Files:**

- Create: `src/features/work-items/repository.ts`
- Create: `src/features/work-items/repository.test.ts`
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/repository.test.ts`

**Interfaces:**

- Consumes: Task 2 schema and Task 4 pure functions.
- Produces: `WorkItemRepository` and atomic case-event-to-work-item hooks.

- [ ] **Step 1: Write failing repository tests**

Test against `TEST_DATABASE_URL` that:

- Document/payment/case events create one idempotent work item.
- `listQueue()` filters by owner/team/SLA state and sorts breach, due time, priority, then ID.
- `recommendAssignees()` returns explanations without mutating ownership.
- `assign()` locks the row, checks `expectedVersion`, validates eligibility, writes `assignment_events`, increments version, and requires an override reason when applicable.
- `evaluateEscalations()` inserts each warning/breach once across repeated runs.

- [ ] **Step 2: Confirm RED**

Run: `$env:TEST_DATABASE_URL=$env:DATABASE_URL; npm.cmd test -- --configLoader runner src/features/work-items/repository.test.ts`

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 3: Implement the repository contract**

```ts
export type WorkItemRepository = {
  listQueue(filters: WorkQueueFilters): Promise<WorkItem[]>;
  get(id: string): Promise<WorkItem | null>;
  recommendAssignees(id: string): Promise<AssignmentRecommendation[]>;
  assign(input: AssignWorkItemInput): Promise<WorkItem>;
  acknowledgeEscalation(input: AcknowledgeEscalationInput): Promise<WorkItem>;
  evaluateEscalations(now: string): Promise<EscalationEvaluationResult>;
  close(): Promise<void>;
};
```

Follow existing repository ownership rules: injectable SQL, close only owned clients, typed row mappers, transactions for mutations, and append-only audit writes.

- [ ] **Step 4: Connect annual-return events atomically**

Update document, payment, filing, and status mutations to call a transaction-scoped `ensureWorkItemForEvent(tx, event)` using a unique source-event key. Do not dual-write to `src/lib/annual-return-store.ts`.

- [ ] **Step 5: Verify GREEN and regression safety**

Run: `$env:TEST_DATABASE_URL=$env:DATABASE_URL; npm.cmd test -- --configLoader runner src/features/work-items/repository.test.ts src/features/annual-return/repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/work-items/repository.ts src/features/work-items/repository.test.ts src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts
git commit -m "feat: persist work assignment and SLA events"
```

### Task 6: Authorized Work-Queue Server Functions And UI

**Files:**

- Create: `src/features/work-items/server-fns.ts`
- Create: `src/features/work-items/server-fns.test.ts`
- Create: `src/routes/work-queue.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/routes/annual-returns.tsx`
- Modify: `src/routes/annual-returns.$id.tsx`
- Modify: `src/routes/-annual-returns-workflow.test.ts`

**Interfaces:**

- Consumes: `requireStaffActor()` and `WorkItemRepository`.
- Produces: list/recommend/assign/acknowledge server functions and the daily staff surface.

- [ ] **Step 1: Write failing server-function and rendered-route tests**

```ts
expect(workQueueSource).toContain('createFileRoute("/work-queue")');
expect(workQueueSource).toContain("My work");
expect(workQueueSource).toContain("Team queue");
expect(workQueueSource).toContain("Breached");
expect(assignInputSchema.safeParse({ workItemId, assigneeId, expectedVersion: 3 }).success).toBe(true);
```

Test that Staff cannot assign, Manager can assign within team, Admin can assign across teams, and every mutation derives the actor from the verified session rather than input.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- --configLoader runner src/features/work-items/server-fns.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: FAIL because server functions and `/work-queue` are absent.

- [ ] **Step 3: Implement server functions with Zod validators**

Expose `listWorkQueue`, `recommendWorkItemAssignees`, `assignWorkItem`, and `acknowledgeWorkItemEscalation`. Inputs include target IDs and expected version only; never accept actor, role, team, or firm IDs from clients.

- [ ] **Step 4: Build the queue and case integration**

Use TanStack Query for server data, stable counter dimensions, filters in route search state, accessible tables on desktop, stacked rows on mobile, and dialogs for assignment/override reasons. Existing annual-return routes show owner and SLA state and link back to the queue.

- [ ] **Step 5: Verify GREEN**

Run: `npm.cmd test -- --configLoader runner src/features/work-items src/routes/-annual-returns-workflow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/work-items src/routes/work-queue.tsx src/components/app-sidebar.tsx src/routes/annual-returns.tsx 'src/routes/annual-returns.$id.tsx' src/routes/-annual-returns-workflow.test.ts src/routeTree.gen.ts
git commit -m "feat: add production work queue"
```

---

## Stage 3: Private Documents And Durable Delivery

### Task 7: R2 Document Storage, Upload Intents, And Authorized Downloads

**Files:**

- Create: `src/features/documents/types.ts`
- Create: `src/features/documents/storage.ts`
- Create: `src/features/documents/storage.test.ts`
- Create: `src/features/documents/scanner.ts`
- Create: `src/features/documents/scanner.test.ts`
- Create: `src/features/documents/repository.ts`
- Create: `src/features/documents/repository.test.ts`
- Create: `src/features/documents/server-fns.ts`
- Create: `src/features/documents/server-fns.test.ts`
- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/portal.tsx`
- Modify: `src/lib/client-portal-store.ts`
- Modify: `src/lib/client-portal-store.test.ts`

**Interfaces:**

- Consumes: `FirmRuntimeEnv.documentsBucket`, auth policies, production document tables, annual-return repository hooks.
- Produces: private object storage and production document actions.

- [ ] **Step 1: Write failing fake-R2 and repository tests**

```ts
export type DocumentStorage = {
  put(input: PutDocumentInput): Promise<StoredObject>;
  get(objectKey: string): Promise<StoredObjectBody | null>;
  delete(objectKey: string): Promise<void>;
  head(objectKey: string): Promise<StoredObjectMetadata | null>;
};

export type DocumentScanResult =
  | { status: "clean"; providerReference: string }
  | { status: "rejected"; reason: string; providerReference: string }
  | { status: "failed"; retryable: boolean; errorCode: string };

export type DocumentScanner = {
  scan(input: { objectKey: string; checksum: string; contentType: string }): Promise<DocumentScanResult>;
};
```

Cover opaque keys, checksum/size persistence, wrong-company denial, object-without-metadata denial, rejected replacement, accepted-document immutability, expired intent cleanup, R2 failure leaving workflow state unchanged, quarantined objects remaining unreadable, clean scan release, rejected scan deletion, and retryable scan failure.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- --configLoader runner src/features/documents src/lib/client-portal-store.test.ts`

Expected: FAIL because production document modules do not exist.

- [ ] **Step 3: Implement two-phase upload and authorized download**

Expose `createDocumentUploadIntent`, `finalizeDocumentUpload`, `scanQuarantinedDocument`, `downloadDocument`, `reviewDocument`, and `cleanupExpiredUploads`. Enforce category, extension, MIME, size, and current workflow state before writing. New objects remain `quarantined`; only a `clean` scanner result changes them to `available`. Rejected objects are deleted and audited. Return streamed responses only after current Postgres authorization succeeds. Use a deterministic fake scanner in local tests; a real provider adapter remains a separately approved provisioning step.

- [ ] **Step 4: Convert portal/document routes off browser ownership**

Keep pure selectors in `client-portal-store.ts` only if useful; remove production mutations and event-emitter ownership. The route must use Neon Auth client sessions, company memberships, server functions, pending/retry UI, and no public object URL.

- [ ] **Step 5: Verify GREEN**

Run: `npm.cmd test -- --configLoader runner src/features/documents src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/documents src/routes/documents.tsx src/routes/portal.tsx src/lib/client-portal-store.ts src/lib/client-portal-store.test.ts src/routes/-annual-returns-workflow.test.ts
git commit -m "feat: store private client documents in R2"
```

### Task 8: Transactional Outbox, WhatsApp Dispatch, And SLA Cron

**Files:**

- Create: `src/features/notifications/types.ts`
- Create: `src/features/notifications/outbox.ts`
- Create: `src/features/notifications/outbox.test.ts`
- Create: `src/features/notifications/dispatcher.ts`
- Create: `src/features/notifications/dispatcher.test.ts`
- Create: `src/server/cron.ts`
- Create: `src/server/cron.test.ts`
- Modify: `src/features/whatsapp/repository.ts`
- Modify: `src/features/whatsapp/repository.test.ts`
- Modify: `src/features/whatsapp/server-fns.ts`
- Modify: `src/features/whatsapp/woztell.ts`

**Interfaces:**

- Consumes: work-item escalation events and existing WOZTELL normalization/repository code.
- Produces: provider-neutral durable delivery with retry and integration status.

- [ ] **Step 1: Write failing outbox and cron tests**

Test transaction-coupled enqueueing, idempotency key uniqueness, bounded exponential backoff, permanent failure after configured attempts, provider message ID persistence, webhook signature rejection, provider-event deduplication, and repeated cron runs emitting one threshold notification.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- --configLoader runner src/features/notifications src/server/cron.test.ts src/features/whatsapp`

Expected: FAIL because outbox/dispatcher/cron modules do not exist.

- [ ] **Step 3: Implement the outbox contract**

```ts
export type NotificationChannel = "email" | "whatsapp" | "in_app";

export type NotificationDispatcher = {
  dispatchDue(now: string, limit: number): Promise<DispatchSummary>;
};

export function nextRetryAt(attempt: number, now: string): string;
export function notificationIdempotencyKey(input: NotificationIdentity): string;
```

The annual-return and escalation transactions insert outbox rows; network calls happen only after commit.

- [ ] **Step 4: Implement scheduled processing**

`runScheduledMaintenance(now, deps)` evaluates SLA thresholds, dispatches a bounded outbox batch, and cleans expired upload intents. Each sub-operation reports structured counts and can retry safely.

- [ ] **Step 5: Verify GREEN**

Run: `npm.cmd test -- --configLoader runner src/features/notifications src/server/cron.test.ts src/features/whatsapp`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/notifications src/server/cron.ts src/server/cron.test.ts src/features/whatsapp
git commit -m "feat: add durable notification delivery"
```

---

## Stage 4: Production Route Conversion And Release Gates

### Task 9: Complete The Annual-Return Production Vertical Slice

**Files:**

- Modify: `src/routes/annual-returns.tsx`
- Modify: `src/routes/annual-returns.$id.tsx`
- Modify: `src/routes/documents.tsx`
- Modify: `src/routes/payments.tsx`
- Modify: `src/routes/portal.tsx`
- Modify: `src/routes/whatsapp.automation.tsx`
- Modify: `src/routes/settings.tsx`
- Modify: `src/components/ai-assistant-panel.tsx`
- Modify: `src/lib/annual-return-store.ts`
- Modify: `src/lib/annual-return-store.test.ts`
- Modify: `src/routes/-annual-returns-workflow.test.ts`
- Create: `src/routes/-production-authorization.test.ts`

**Interfaces:**

- Consumes: Tasks 3, 5, 6, 7, and 8.
- Produces: one coherent production-backed annual-return journey without browser/server state divergence.

- [ ] **Step 1: Write failing route-contract and authorization tests**

Cover all four roles, wrong-company direct IDs, protected downloads, anonymous server functions, manager-only assignment/SLA policy controls, staff work actions, client portal-only access, stale mutation versions, and persisted refresh behavior.

- [ ] **Step 2: Confirm RED**

Run: `npm.cmd test -- --configLoader runner src/routes/-production-authorization.test.ts src/routes/-annual-returns-workflow.test.ts`

Expected: FAIL while routes still call browser-store mutations.

- [ ] **Step 3: Replace browser-owned mutations route by route**

Use server functions and React Query invalidation for annual-return status, checklist review, payment proof, packet actions, documents, portal actions, assignments, and notifications. Delete or clearly mark demo-only mutation exports so production routes cannot import them.

- [ ] **Step 4: Add admin settings and health states**

Settings must show staff/team/skill/capacity management, client memberships, versioned SLA policies, business calendars, and read-only integration health. Never render secret values.

- [ ] **Step 5: Verify GREEN and state consistency**

Run: `npm.cmd test -- --configLoader runner src/routes/-production-authorization.test.ts src/routes/-annual-returns-workflow.test.ts src/lib/annual-return-store.test.ts`

Expected: PASS and no production route imports a browser mutation from `annual-return-store.ts` or `client-portal-store.ts`.

- [ ] **Step 6: Commit**

```powershell
git add src/routes src/components/ai-assistant-panel.tsx src/lib/annual-return-store.ts src/lib/annual-return-store.test.ts src/routeTree.gen.ts
git commit -m "feat: complete production annual return workflow"
```

### Task 10: Deployment Validation, Security Probes, And Full Verification

**Files:**

- Create: `scripts/verify-firm-deployment.ts`
- Create: `scripts/check-production-route-imports.ts`
- Create: `docs/runbooks/firm-deployment.md`
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/document-quarantine.md`
- Modify: `package.json`
- Modify: `README.md`
- Test: all changed tests

**Interfaces:**

- Consumes: the complete production vertical slice.
- Produces: reproducible offline validation, provisioning checklist, security evidence, and launch blockers. It does not provision live resources.

- [ ] **Step 1: Add failing validation-script tests or dry-run fixtures**

`verify-firm-deployment --dry-run` must report each required binding, auth capability, migration, cron, integration, backup, and malware-scanning gate as `pass`, `fail`, or `blocked`, and redact all secret values.

- [ ] **Step 2: Implement dry-run validation and runbooks**

The runbooks must contain exact commands for migration rehearsal, rollback, R2/Hyperdrive health, webhook verification, Neon Auth invite/magic-link checks, cross-company access probes, backup/restore rehearsal, and quarantine validation. Every external write command must be labeled `REQUIRES EXPLICIT APPROVAL`.

- [ ] **Step 3: Run focused production checks**

Run: `npm.cmd run check:production-imports`

Expected: PASS; production routes have no forbidden browser-store mutation imports.

Run: `npm.cmd run verify:firm -- --dry-run`

Expected: PASS for local structure and `blocked` for unprovisioned live resources, without making network calls.

- [ ] **Step 4: Run the complete verification suite**

Run: `npx.cmd tsc --noEmit --pretty false`

Expected: exit 0.

Run: `npm.cmd test -- --configLoader runner`

Expected: all test files pass; database-dependent tests skip only when `TEST_DATABASE_URL` is absent.

Run: `npm.cmd run lint`

Expected: 0 errors; only the six known Fast Refresh warnings are acceptable unless touched files remove them.

Run: `npm.cmd run build`

Expected: exit 0 with only existing Vite/Nitro advisory warnings.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Perform local browser verification**

Start the dev server, then verify desktop `1440x1000` and mobile `390x844` flows for login, work queue, assignment dialog, SLA state, annual-return case, client magic-link fixture, upload/review, payment proof, and integration health. Record zero console errors and no horizontal overflow.

- [ ] **Step 6: Request final code and security review**

Review the complete range from `3976932` to HEAD. Resolve Critical and Important findings, rerun the full gates, and leave live provisioning blocked until separately approved.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json README.md scripts/verify-firm-deployment.ts scripts/check-production-route-imports.ts docs/runbooks
git commit -m "docs: add production deployment gates"
```

## Execution Notes

- Use a fresh isolated worktree when implementation starts.
- Prefer `superpowers:subagent-driven-development`; Tasks 1-3, 4-6, 7-8, and 9-10 form sequential dependency groups.
- Run a specification-compliance review and a code-quality review after every task.
- Do not begin live resource provisioning during this plan. When local implementation and verification are complete, present the exact Cloudflare, Neon Auth, email, malware-scanning, and secret changes for separate approval.
