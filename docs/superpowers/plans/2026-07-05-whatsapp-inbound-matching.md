# WhatsApp Inbound Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link inbound WOZTELL WhatsApp replies to known companies and active annual-return cases, then record matched replies on the case timeline.

**Architecture:** Keep the matching inside `src/features/whatsapp/repository.ts` so contact upsert, message deduplication, case matching, and timeline writes happen atomically. Reuse existing WhatsApp tables and annual-return tables; no migration is required. Return matching metadata from the server function so future webhook routes and UI surfaces can distinguish matched and unmatched replies.

**Tech Stack:** TypeScript, Vitest, TanStack Start server functions, `postgres`, Neon/Postgres.

---

## File Structure

- Modify `src/features/whatsapp/repository.ts`
  - Extend inbound message return type with `timelineEventCreated`.
  - Return contact details from `upsertContact`.
  - Add deterministic inbound matching helpers.
  - Change `recordInboundMessage` to run in one transaction.
- Modify `src/features/whatsapp/repository.test.ts`
  - Add DB tests for matched replies, duplicate reply idempotency, and unmatched replies.
  - Keep outbound queue coverage intact.
- Modify `src/features/whatsapp/server-fns.ts`
  - Add a small pure response builder.
  - Return `matchedCompanyId`, `matchedCaseId`, and `timelineEventCreated`.
- Modify `src/features/whatsapp/server-fns.test.ts`
  - Add unit coverage for the response builder.
- No migration file for this phase.

---

### Task 1: Repository Tests for Inbound Matching

**Files:**

- Modify: `src/features/whatsapp/repository.test.ts`

- [ ] **Step 1: Update the unmatched inbound test expectation**

In `src/features/whatsapp/repository.test.ts`, update the existing `"records inbound messages once while upserting the WhatsApp contact"` test so it explicitly proves unmatched inbound messages stay unmatched.

Replace this assertion:

```ts
expect(second).toEqual(first);
```

With this assertion block:

```ts
expect(first).toMatchObject({
  provider: "woztell",
  direction: "inbound",
  status: "received",
  companyId: null,
  caseId: null,
  timelineEventCreated: false,
});
expect(second).toEqual(first);
```

Then add this timeline assertion after the message count assertion:

```ts
const timelineEvents = await sql<{ count: number }[]>`
  select count(*)::int as count
  from timeline_events
  where event_type = 'whatsapp_message_received'
    and metadata ->> 'providerMessageId' = 'phase2-test-inbound-001'
`;
expect(timelineEvents[0].count).toBe(0);
```

- [ ] **Step 2: Add a matched inbound reply test**

Still in `src/features/whatsapp/repository.test.ts`, add this test after `"queues outbound template messages against an annual return case and timeline"`:

```ts
it(
  "matches inbound replies to the most recent outbound annual return case and records timeline",
  async () => {
    const repository = repositoryFor();

    const outbound = await repository.queueOutboundTemplateMessage({
      actorId: TEST_USER_ID,
      caseId: TEST_CASE_ID,
      toPhone: "+852 6999 0001",
      toWhatsAppId: "phase2-test-wa-outbound",
      contactName: "Phase 2 Director",
      templateName: "phase2_test_annual_return_30_day",
      languageCode: "en",
      category: "annual_return",
      body: "Phase 2 test annual return reminder body.",
    });
    const normalized = normalizeWoztellInboundMessage({
      event: "message",
      channel: { id: "kossilon-whatsapp-channel" },
      contact: {
        wa_id: "phase2-test-wa-outbound",
        phone: "+852 6999 0001",
        profile: { name: "Phase 2 Director" },
      },
      message: {
        id: "phase2-test-inbound-reply-001",
        type: "text",
        text: { body: "Phase 2 test reply: documents are ready." },
        timestamp: "2026-07-05T12:20:00.000Z",
      },
    });

    const inbound = await repository.recordInboundMessage(normalized);
    const duplicate = await repository.recordInboundMessage(normalized);

    expect(inbound).toMatchObject({
      provider: "woztell",
      direction: "inbound",
      status: "received",
      contactId: outbound.contactId,
      companyId: TEST_COMPANY_ID,
      caseId: TEST_CASE_ID,
      phoneE164: "+85269990001",
      whatsAppId: "phase2-test-wa-outbound",
      body: "Phase 2 test reply: documents are ready.",
      timelineEventCreated: true,
    });
    expect(duplicate).toMatchObject({
      id: inbound.id,
      companyId: TEST_COMPANY_ID,
      caseId: TEST_CASE_ID,
      timelineEventCreated: false,
    });

    const sql = sqlForTests();
    const timelineEvents = await sql<
      {
        event_type: string;
        description: string;
        message_id: string | null;
        provider_message_id: string | null;
        body_preview: string | null;
      }[]
    >`
      select
        event_type,
        description,
        metadata ->> 'messageId' as message_id,
        metadata ->> 'providerMessageId' as provider_message_id,
        metadata ->> 'bodyPreview' as body_preview
      from timeline_events
      where case_id = ${TEST_CASE_ID}
      order by created_at asc
    `;
    expect(timelineEvents).toEqual([
      {
        event_type: "whatsapp_message_queued",
        description:
          "Queued WhatsApp template phase2_test_annual_return_30_day for Phase 2 Director.",
        message_id: outbound.id,
        provider_message_id: null,
        body_preview: null,
      },
      {
        event_type: "whatsapp_message_received",
        description: "Received WhatsApp reply from Phase 2 Director.",
        message_id: inbound.id,
        provider_message_id: "phase2-test-inbound-reply-001",
        body_preview: "Phase 2 test reply: documents are ready.",
      },
    ]);

    const receivedEvents = await sql<{ count: number }[]>`
      select count(*)::int as count
      from timeline_events
      where event_type = 'whatsapp_message_received'
        and metadata ->> 'providerMessageId' = 'phase2-test-inbound-reply-001'
    `;
    expect(receivedEvents[0].count).toBe(1);
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
```

- [ ] **Step 3: Run repository tests to verify RED**

Run:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts
```

Expected: FAIL because `timelineEventCreated` does not exist and inbound replies are not yet linked to `company_id` or `case_id`.

- [ ] **Step 4: Commit the failing tests**

Commit only if the tests fail for the expected missing behavior:

```bash
git add src/features/whatsapp/repository.test.ts
git commit -m "test: cover whatsapp inbound matching"
```

---

### Task 2: Repository Matching Implementation

**Files:**

- Modify: `src/features/whatsapp/repository.ts`
- Test: `src/features/whatsapp/repository.test.ts`

- [ ] **Step 1: Add inbound match types**

In `src/features/whatsapp/repository.ts`, after `export type WhatsAppMessageRecord`, add:

```ts
export type InboundWhatsAppMessageRecord = WhatsAppMessageRecord & {
  timelineEventCreated: boolean;
};
```

Replace the `WhatsAppRepository` inbound method signature:

```ts
recordInboundMessage(input: NormalizedInboundWhatsAppMessage): Promise<WhatsAppMessageRecord>;
```

With:

```ts
recordInboundMessage(input: NormalizedInboundWhatsAppMessage): Promise<InboundWhatsAppMessageRecord>;
```

- [ ] **Step 2: Replace contact and match row types**

In `src/features/whatsapp/repository.ts`, replace:

```ts
type ContactRow = {
  id: string;
};
```

With:

```ts
type ContactRow = {
  id: string;
  company_id: string | null;
  display_name: string | null;
  phone_e164: string | null;
  whatsapp_id: string | null;
};

type ContactRecord = {
  id: string;
  companyId: string | null;
  displayName: string | null;
  phoneE164: string | null;
  whatsAppId: string | null;
};

type InboundMatch = {
  companyId: string | null;
  caseId: string | null;
};

type OutboundContextRow = {
  company_id: string | null;
  case_id: string | null;
  case_company_id: string | null;
};

type ActiveCaseRow = {
  id: string;
  company_id: string;
};
```

- [ ] **Step 3: Add mapping and preview helpers**

In `src/features/whatsapp/repository.ts`, after `mapWebhookEvent`, add:

```ts
function mapContact(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    displayName: row.display_name,
    phoneE164: row.phone_e164,
    whatsAppId: row.whatsapp_id,
  };
}

function bodyPreview(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();

  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157)}...`;
}

function inboundDescriptionTarget(contact: ContactRecord): string {
  return contact.displayName ?? contact.phoneE164 ?? contact.whatsAppId ?? "client";
}
```

- [ ] **Step 4: Return contact details from `upsertContact`**

Change the return type of `upsertContact` from `Promise<string>` to `Promise<ContactRecord>`.

Inside the `existing` branch, replace the update query with:

```ts
const updatedRows = await client<ContactRow[]>`
  update whatsapp_contacts
  set whatsapp_id = coalesce(whatsapp_contacts.whatsapp_id, ${input.whatsAppId}),
      phone_e164 = coalesce(whatsapp_contacts.phone_e164, ${input.phoneE164}),
      display_name = coalesce(${input.displayName}, whatsapp_contacts.display_name),
      company_id = coalesce(${input.companyId ?? null}, whatsapp_contacts.company_id),
      last_seen_at = now(),
      updated_at = now()
  where id = ${existing.id}
  returning id, company_id, display_name, phone_e164, whatsapp_id
`;

return mapContact(updatedRows[0]);
```

Inside the insert branch, replace the insert query tail with:

```ts
returning id, company_id, display_name, phone_e164, whatsapp_id
`;

return mapContact(insertedRows[0]);
```

- [ ] **Step 5: Update outbound queue contact usage**

In `queueOutboundTemplateMessage`, replace:

```ts
const contactId = await upsertContact(tx, {
```

With:

```ts
const contact = await upsertContact(tx, {
```

Then replace both `contactId` usages in the outbound insert with `contact.id`.

The outbound insert value should include:

```ts
${contact.id},
```

- [ ] **Step 6: Add inbound matching helper**

In `src/features/whatsapp/repository.ts`, before `recordInboundMessage`, add:

```ts
async function resolveInboundMatch(
  client: QueryClient,
  contact: ContactRecord,
): Promise<InboundMatch> {
  let companyId = contact.companyId;
  let caseId: string | null = null;

  const outboundRows = await client<OutboundContextRow[]>`
    select
      wm.company_id,
      case
        when arc.id is not null
          and arc.current_status not in ('Filed', 'Completed')
        then wm.case_id
        else null
      end as case_id,
      arc.company_id as case_company_id
    from whatsapp_messages wm
    left join annual_return_cases arc on arc.id = wm.case_id
    where wm.contact_id = ${contact.id}
      and wm.direction = 'outbound'
      and (wm.company_id is not null or wm.case_id is not null)
    order by wm.created_at desc
    limit 1
  `;
  const [outbound] = outboundRows;

  if (!companyId && outbound) {
    companyId = outbound.company_id ?? outbound.case_company_id;
  }

  if (outbound?.case_id) {
    caseId = outbound.case_id;
  }

  if (!caseId && companyId) {
    const activeCaseRows = await client<ActiveCaseRow[]>`
      select id, company_id
      from annual_return_cases
      where company_id = ${companyId}
        and current_status not in ('Filed', 'Completed')
      order by filing_due_date asc, created_at desc
      limit 1
    `;
    const [activeCase] = activeCaseRows;

    if (activeCase) {
      caseId = activeCase.id;
      companyId = activeCase.company_id;
    }
  }

  if (companyId && contact.companyId !== companyId) {
    await client`
      update whatsapp_contacts
      set company_id = ${companyId},
          updated_at = now()
      where id = ${contact.id}
    `;
  }

  return { companyId, caseId };
}
```

- [ ] **Step 7: Replace `recordInboundMessage` with transactional matching**

Replace the entire `recordInboundMessage` function in `src/features/whatsapp/repository.ts` with:

```ts
async function recordInboundMessage(
  input: NormalizedInboundWhatsAppMessage,
): Promise<InboundWhatsAppMessageRecord> {
  return sql.begin(async (tx) => {
    const contact = await upsertContact(tx, {
      whatsAppId: input.fromWhatsAppId,
      phoneE164: input.fromPhone,
      displayName: input.contactName,
    });
    const existingRows = await tx<MessageRow[]>`
      select
        id,
        provider,
        provider_message_id,
        direction,
        status,
        contact_id,
        company_id,
        case_id,
        template_id,
        phone_e164,
        whatsapp_id,
        body,
        payload,
        sent_by,
        received_at::text as received_at,
        sent_at::text as sent_at,
        created_at::text as created_at
      from whatsapp_messages
      where provider = 'woztell'
        and provider_message_id = ${input.providerMessageId}
      limit 1
    `;
    const [existing] = existingRows;

    if (existing) {
      return {
        ...mapMessage(existing),
        timelineEventCreated: false,
      };
    }

    const match = await resolveInboundMatch(tx, contact);
    const rows = await tx<MessageRow[]>`
      insert into whatsapp_messages (
        provider,
        provider_message_id,
        direction,
        status,
        contact_id,
        company_id,
        case_id,
        phone_e164,
        whatsapp_id,
        body,
        payload,
        received_at
      )
      values (
        'woztell',
        ${input.providerMessageId},
        'inbound',
        'received',
        ${contact.id},
        ${match.companyId},
        ${match.caseId},
        ${input.fromPhone},
        ${input.fromWhatsAppId},
        ${input.body},
        ${tx.json(toJsonValue(input.rawPayload))},
        ${input.receivedAt}
      )
      returning
        id,
        provider,
        provider_message_id,
        direction,
        status,
        contact_id,
        company_id,
        case_id,
        template_id,
        phone_e164,
        whatsapp_id,
        body,
        payload,
        sent_by,
        received_at::text as received_at,
        sent_at::text as sent_at,
        created_at::text as created_at
    `;
    const message = mapMessage(rows[0]);
    const timelineEventCreated = Boolean(match.companyId && match.caseId);

    if (timelineEventCreated) {
      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${match.companyId},
          ${match.caseId},
          'whatsapp_message_received',
          'system',
          null,
          ${`Received WhatsApp reply from ${inboundDescriptionTarget(contact)}.`},
          ${tx.json({
            source: "woztell",
            messageId: message.id,
            providerMessageId: input.providerMessageId,
            contactId: contact.id,
            phoneE164: input.fromPhone,
            whatsAppId: input.fromWhatsAppId,
            bodyPreview: bodyPreview(input.body),
          })}
        )
      `;
    }

    return {
      ...message,
      timelineEventCreated,
    };
  });
}
```

- [ ] **Step 8: Run repository tests to verify GREEN**

Run:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts
```

Expected: PASS with all WhatsApp DB repository tests.

- [ ] **Step 9: Commit repository implementation**

```bash
git add src/features/whatsapp/repository.ts src/features/whatsapp/repository.test.ts
git commit -m "feat: match inbound whatsapp replies"
```

---

### Task 3: Server Function Matching Metadata

**Files:**

- Modify: `src/features/whatsapp/server-fns.ts`
- Modify: `src/features/whatsapp/server-fns.test.ts`

- [ ] **Step 1: Add response builder test**

In `src/features/whatsapp/server-fns.test.ts`, add `buildWhatsAppInboundWebhookResponse` to the import list:

```ts
import {
  buildWhatsAppInboundWebhookResponse,
  getWhatsAppIntegrationStatusForEnv,
  processWhatsAppInboundWebhookInputSchema,
  queueWhatsAppTemplateMessageInputSchema,
} from "./server-fns";
```

Then add this test before `"reports webhook and live-send readiness from env vars"`:

```ts
it("serializes inbound webhook matching metadata", () => {
  const response = buildWhatsAppInboundWebhookResponse({
    signatureValid: true,
    message: {
      id: "96000000-0000-0000-0000-000000000001",
      companyId: "95200000-0000-0000-0000-000000000001",
      caseId: "95300000-0000-0000-0000-000000000001",
      timelineEventCreated: true,
    },
    event: {
      id: "97000000-0000-0000-0000-000000000001",
      processingStatus: "processed",
      errorMessage: null,
    },
  });

  expect(response).toEqual({
    ok: true,
    messageId: "96000000-0000-0000-0000-000000000001",
    eventId: "97000000-0000-0000-0000-000000000001",
    processingStatus: "processed",
    errorMessage: null,
    matchedCompanyId: "95200000-0000-0000-0000-000000000001",
    matchedCaseId: "95300000-0000-0000-0000-000000000001",
    timelineEventCreated: true,
  });
});
```

- [ ] **Step 2: Run server function tests to verify RED**

Run:

```bash
bunx vitest run src/features/whatsapp/server-fns.test.ts
```

Expected: FAIL because `buildWhatsAppInboundWebhookResponse` is not exported.

- [ ] **Step 3: Add response types and builder**

In `src/features/whatsapp/server-fns.ts`, update the repository import to include types:

```ts
import {
  createWhatsAppRepository,
  type InboundWhatsAppMessageRecord,
  type WhatsAppRepository,
  type WhatsAppTemplateCategory,
  type WhatsAppWebhookEventRecord,
  type WhatsAppWebhookProcessingStatus,
} from "./repository";
```

After `getWhatsAppIntegrationStatusForEnv`, add:

```ts
export type WhatsAppInboundWebhookResponse = {
  ok: boolean;
  messageId: string | null;
  eventId: string;
  processingStatus: WhatsAppWebhookProcessingStatus;
  errorMessage: string | null;
  matchedCompanyId: string | null;
  matchedCaseId: string | null;
  timelineEventCreated: boolean;
};

export function buildWhatsAppInboundWebhookResponse(input: {
  signatureValid: boolean;
  message: Pick<
    InboundWhatsAppMessageRecord,
    "id" | "companyId" | "caseId" | "timelineEventCreated"
  >;
  event: Pick<WhatsAppWebhookEventRecord, "id" | "processingStatus" | "errorMessage">;
}): WhatsAppInboundWebhookResponse {
  return {
    ok: input.signatureValid,
    messageId: input.message.id,
    eventId: input.event.id,
    processingStatus: input.event.processingStatus,
    errorMessage: input.event.errorMessage,
    matchedCompanyId: input.message.companyId,
    matchedCaseId: input.message.caseId,
    timelineEventCreated: input.message.timelineEventCreated,
  };
}
```

- [ ] **Step 4: Wire success and failure responses**

In `processWhatsAppInboundWebhook`, replace the success return object:

```ts
return {
  ok: data.signatureValid,
  messageId: message.id,
  eventId: event.id,
  processingStatus: event.processingStatus,
  errorMessage: event.errorMessage,
};
```

With:

```ts
return buildWhatsAppInboundWebhookResponse({
  signatureValid: data.signatureValid,
  message,
  event,
});
```

Replace the catch return object:

```ts
return {
  ok: false,
  messageId: null,
  eventId: event.id,
  processingStatus: event.processingStatus,
  errorMessage: event.errorMessage,
};
```

With:

```ts
return {
  ok: false,
  messageId: null,
  eventId: event.id,
  processingStatus: event.processingStatus,
  errorMessage: event.errorMessage,
  matchedCompanyId: null,
  matchedCaseId: null,
  timelineEventCreated: false,
};
```

- [ ] **Step 5: Run server function tests to verify GREEN**

Run:

```bash
bunx vitest run src/features/whatsapp/server-fns.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit server function metadata**

```bash
git add src/features/whatsapp/server-fns.ts src/features/whatsapp/server-fns.test.ts
git commit -m "feat: return whatsapp inbound match metadata"
```

---

### Task 4: Full Verification

**Files:**

- `src/features/whatsapp/repository.ts`
- `src/features/whatsapp/repository.test.ts`
- `src/features/whatsapp/server-fns.ts`
- `src/features/whatsapp/server-fns.test.ts`

- [ ] **Step 1: Focused lint**

Run:

```bash
bunx eslint src/features/whatsapp/repository.ts src/features/whatsapp/repository.test.ts src/features/whatsapp/server-fns.ts src/features/whatsapp/server-fns.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Typecheck**

Run:

```bash
bunx tsc --noEmit --pretty false
```

Expected: exit 0.

- [ ] **Step 3: Non-DB test suite**

Run:

```bash
bun run test
```

Expected: all non-DB tests pass.

- [ ] **Step 4: DB repository suites**

Run WhatsApp and annual-return DB suites separately:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/whatsapp/repository.test.ts
```

Then run:

```bash
TEST_DATABASE_URL="$DATABASE_URL" bunx vitest run src/features/annual-return/repository.test.ts
```

Expected: all DB-backed tests pass when `DATABASE_URL` is exported. If the shell does not have `DATABASE_URL`, the DB tests will skip; record that as an environment limitation, not a product pass.

- [ ] **Step 5: Build**

Run:

```bash
KOSSILON_ANNUAL_RETURN_ACTOR_ID=20000000-0000-0000-0000-000000000003 bun run build
```

Expected: exit 0 with only existing Vite advisory warnings.

- [ ] **Step 6: Full repo lint status**

Run:

```bash
set +e
bun run lint > /tmp/kossilon-whatsapp-inbound-lint.log 2>&1
lint_status=$?
printf 'lint exit %s\n' "$lint_status"
tail -80 /tmp/kossilon-whatsapp-inbound-lint.log
exit 0
```

Expected: likely exit 1 from existing repo-wide Prettier findings outside this change. Confirm no new findings point to the changed WhatsApp files.

- [ ] **Step 7: Diff and status review**

Run:

```bash
git diff --check
git status -sb
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors and only intended WhatsApp/spec/plan commits on the branch.

- [ ] **Step 8: Commit verification notes only if files changed**

If verification produces no file changes, do not create a commit. If formatting changes were needed in the touched WhatsApp files, commit them:

```bash
git add src/features/whatsapp/repository.ts src/features/whatsapp/repository.test.ts src/features/whatsapp/server-fns.ts src/features/whatsapp/server-fns.test.ts
git commit -m "chore: verify whatsapp inbound matching"
```
