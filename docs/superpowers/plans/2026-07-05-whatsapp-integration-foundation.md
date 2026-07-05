# WhatsApp Integration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first durable Phase 2 backend slice for WhatsApp/WOZTELL integration without requiring live WOZTELL credentials.

**Architecture:** Keep WhatsApp as the communication layer and Kossilon CoSec OS as the system of record. Add a small `src/features/whatsapp` boundary for provider config, WOZTELL payload normalization, Postgres persistence, and server actions that can later power the static WhatsApp UI and external webhook route.

**Tech Stack:** TypeScript, Vitest, TanStack Start server functions, `postgres`, Neon/Postgres migrations, Zod.

---

### Task 1: Provider Config and Payload Normalization

**Files:**

- Create: `src/features/whatsapp/types.ts`
- Create: `src/features/whatsapp/config.ts`
- Create: `src/features/whatsapp/config.test.ts`
- Create: `src/features/whatsapp/woztell.ts`
- Create: `src/features/whatsapp/woztell.test.ts`

- [ ] **Step 1: Write failing unit tests**

Test that config validation:

- returns a complete WOZTELL config when all required env vars are present
- reports every missing env var in one error
- allows webhook-only validation with just the webhook secret

Test that WOZTELL normalization:

- extracts a text inbound message from common WOZTELL-style payload fields
- keeps the original payload for audit storage
- rejects payloads without provider message id, sender, or body

- [ ] **Step 2: Run tests to verify RED**

Run:
`bunx vitest run src/features/whatsapp/config.test.ts src/features/whatsapp/woztell.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement minimal config and normalizer**

Expose:

- `getWhatsAppWebhookConfig(env?: NodeJS.ProcessEnv)`
- `getWhatsAppProviderConfig(env?: NodeJS.ProcessEnv)`
- `normalizeWoztellInboundMessage(payload: unknown)`

- [ ] **Step 4: Run tests to verify GREEN**

Run:
`bunx vitest run src/features/whatsapp/config.test.ts src/features/whatsapp/woztell.test.ts`

Expected: PASS.

### Task 2: Durable WhatsApp Tables

**Files:**

- Create: `db/migrations/0005_whatsapp_integration_foundation.sql`

- [ ] **Step 1: Add migration**

Create idempotent tables:

- `whatsapp_contacts`
- `whatsapp_templates`
- `whatsapp_messages`
- `whatsapp_webhook_events`

Use no cascade deletes for message history. Prefer `on delete set null` when linked company/case/user records are removed.

- [ ] **Step 2: Apply migration**

Run:
`bun run db:migrate`

Expected: `Applied 0005_whatsapp_integration_foundation.sql`.

### Task 3: WhatsApp Repository

**Files:**

- Create: `src/features/whatsapp/repository.ts`
- Create: `src/features/whatsapp/repository.test.ts`

- [ ] **Step 1: Write failing integration tests**

With `TEST_DATABASE_URL`, test that:

- `recordInboundMessage` upserts a contact and deduplicates repeated provider message ids
- `queueOutboundTemplateMessage` writes a queued outbound message, links the case/company, and records a timeline event
- `recordWebhookEvent` stores raw payload and marks processing result

- [ ] **Step 2: Run tests to verify RED**

Run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts`

Expected: FAIL because repository/tables are not implemented yet.

- [ ] **Step 3: Implement repository**

Follow the annual-return repository style:

- accept optional `sql` or `databaseUrl`
- close only owned clients
- use typed rows and deterministic mappers
- avoid sending network requests

- [ ] **Step 4: Run tests to verify GREEN**

Run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts`

Expected: PASS.

### Task 4: Server Functions

**Files:**

- Create: `src/features/whatsapp/server-fns.ts`
- Create: `src/features/whatsapp/server-fns.test.ts`

- [ ] **Step 1: Write failing unit tests**

Test validation for:

- inbound webhook payload processing
- outbound template queueing payloads
- clear failure when provider env vars are missing for live send readiness

- [ ] **Step 2: Run tests to verify RED**

Run:
`bunx vitest run src/features/whatsapp/server-fns.test.ts`

Expected: FAIL because server functions do not exist.

- [ ] **Step 3: Implement server functions**

Expose:

- `processWhatsAppInboundWebhook`
- `queueWhatsAppTemplateMessage`
- `getWhatsAppIntegrationStatus`

- [ ] **Step 4: Run tests to verify GREEN**

Run:
`bunx vitest run src/features/whatsapp/server-fns.test.ts`

Expected: PASS.

### Task 5: Full Verification

**Files:**

- All changed files

- [ ] **Step 1: Typecheck**

Run:
`bunx tsc --noEmit --pretty false`

Expected: exit 0.

- [ ] **Step 2: Test suite**

Run:
`bun run test`

Expected: all non-DB tests pass.

- [ ] **Step 3: DB suite**

Run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts`

Expected: all DB tests pass.

- [ ] **Step 4: Build**

Run:
`KOSSILON_ANNUAL_RETURN_ACTOR_ID=20000000-0000-0000-0000-000000000003 bun run build`

Expected: exit 0, with only existing Vite advisory warnings.

- [ ] **Step 5: Review diff**

Run:
`git diff --check && git status -sb`

Expected: no whitespace errors and only intended files changed.
