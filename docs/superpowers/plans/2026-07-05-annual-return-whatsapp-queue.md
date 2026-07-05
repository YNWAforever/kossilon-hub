# Annual Return WhatsApp Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn annual-return reminder actions into durable queued WhatsApp template messages while preserving existing reminder logs, timeline events, and audit records.

**Architecture:** Build on the Phase 2 WhatsApp foundation from PR #3. Add a narrow annual-return WhatsApp service that composes reminder drafts, records the annual-return reminder transaction, then queues the outbound WhatsApp template through `src/features/whatsapp/repository.ts`.

**Tech Stack:** TypeScript, Vitest, TanStack Start server functions, `postgres`, Neon/Postgres.

---

### Task 1: Annual Return WhatsApp Reminder Service

**Files:**

- Create: `src/features/annual-return/whatsapp-reminders.ts`
- Test: `src/features/annual-return/whatsapp-reminders.test.ts`
- Modify: `src/features/annual-return/server-fns.ts`

- [ ] **Step 1: Write the failing unit test**

Test `buildAnnualReturnWhatsAppReminderRequest` with a representative annual-return case:

```ts
expect(
  buildAnnualReturnWhatsAppReminderRequest({
    case_: harbourCase,
    actorId: "20000000-0000-0000-0000-000000000003",
    recipientName: "Ada Director",
    recipientPhone: "+852 6123 4567",
  }),
).toEqual({
  annualReturnReminder: {
    caseId: harbourCase.id,
    actorId: "20000000-0000-0000-0000-000000000003",
    templateLabel: "Annual return WhatsApp reminder",
    recipientName: "Ada Director",
    recipientPhone: "+852 6123 4567",
    draftBody: buildReminderDraft(harbourCase),
    note: "Queued as WhatsApp template message.",
  },
  whatsAppMessage: {
    actorId: "20000000-0000-0000-0000-000000000003",
    caseId: harbourCase.id,
    toPhone: "+852 6123 4567",
    contactName: "Ada Director",
    templateName: "annual_return_manual_reminder",
    languageCode: "en",
    category: "annual_return",
    body: buildReminderDraft(harbourCase),
  },
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:
`bunx vitest run src/features/annual-return/whatsapp-reminders.test.ts`

Expected: FAIL because `whatsapp-reminders.ts` does not exist.

- [ ] **Step 3: Implement minimal service**

Create:

- `buildAnnualReturnWhatsAppReminderRequest`
- `queueAnnualReturnWhatsAppReminder`

`queueAnnualReturnWhatsAppReminder` should accept injected annual-return and WhatsApp repositories for tests, record the annual-return reminder first, then queue the WhatsApp message.

- [ ] **Step 4: Run the test to verify GREEN**

Run:
`bunx vitest run src/features/annual-return/whatsapp-reminders.test.ts`

Expected: PASS.

### Task 2: Repository Integration Test

**Files:**

- Modify: `src/features/annual-return/repository.test.ts`
- Modify: `src/features/whatsapp/repository.test.ts` only if shared cleanup helpers are needed

- [ ] **Step 1: Write the failing DB test**

Add a Neon-backed integration test proving `queueAnnualReturnWhatsAppReminder`:

- increments `annual_return_cases.reminders_sent`
- writes `reminder_logs`
- writes `annual_return_audit_events`
- inserts a queued row in `whatsapp_messages`
- writes a `whatsapp_message_queued` timeline event

- [ ] **Step 2: Run the DB test to verify RED**

Run the DB fixture files separately so their Neon test companies do not overlap under Vitest file parallelism:

`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts`

`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts`

Expected: FAIL until the service is wired and cleanup handles WhatsApp rows.

- [ ] **Step 3: Implement cleanup and integration behavior**

Extend annual-return test cleanup to delete WhatsApp webhook/message/template/contact rows linked to the test case/company before deleting annual-return fixtures.

- [ ] **Step 4: Run DB tests to verify GREEN**

Run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts`

Then run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts`

Expected: PASS.

### Task 3: Server Function and UI Action

**Files:**

- Modify: `src/features/annual-return/server-fns.ts`
- Modify: `src/routes/annual-returns.$id.tsx`
- Test: `src/features/annual-return/whatsapp-reminders.test.ts`

- [ ] **Step 1: Add server-function validation tests**

Test exported schema/parser logic if introduced, or add unit coverage that invalid phone/name/body is rejected by the service before queueing.

- [ ] **Step 2: Wire server function**

Add `queueAnnualReturnWhatsAppReminderMessage` server function:

- loads the case
- gets the actor from `getCurrentAnnualReturnActorId`
- calls `queueAnnualReturnWhatsAppReminder`
- returns serializable IDs/status only

- [ ] **Step 3: Update case detail action**

In `src/routes/annual-returns.$id.tsx`, replace the direct `recordAnnualReturnReminder` call in `handleReminder` with `queueAnnualReturnWhatsAppReminderMessage`.

Keep `copyDraftToClipboard` so staff still get a draft locally while the backend queues the message.

- [ ] **Step 4: Run focused tests**

Run:
`bunx vitest run src/features/annual-return/whatsapp-reminders.test.ts`

Expected: PASS.

### Task 4: Full Verification

**Files:**

- All changed files

- [ ] **Step 1: Targeted lint**

Run:
`bunx eslint src/features/annual-return/whatsapp-reminders.ts src/features/annual-return/whatsapp-reminders.test.ts src/features/annual-return/server-fns.ts 'src/routes/annual-returns.$id.tsx'`

Expected: exit 0.

- [ ] **Step 2: Typecheck**

Run:
`bunx tsc --noEmit --pretty false`

Expected: exit 0.

- [ ] **Step 3: Test suite**

Run:
`bun run test`

Expected: all non-DB tests pass.

- [ ] **Step 4: DB suites**

Run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts`

Then run:
`TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts`

Expected: all DB tests pass.

- [ ] **Step 5: Build**

Run:
`KOSSILON_ANNUAL_RETURN_ACTOR_ID=20000000-0000-0000-0000-000000000003 bun run build`

Expected: exit 0, with only existing Vite advisory warnings.

- [ ] **Step 6: Review diff**

Run:
`git diff --check && git status -sb`

Expected: no whitespace errors and only intended files changed.
