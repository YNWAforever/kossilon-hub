import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { sortConversationMessagesOldestFirst } from "./conversations";
import { normalizeWoztellInboundMessage } from "./woztell";
import {
  createWhatsAppRepository,
  planContactIdentityMerge,
  resolveWhatsAppReplayMessageId,
} from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

const TEST_TEAM_ID = "95000000-0000-0000-0000-000000000001";
const TEST_USER_ID = "95100000-0000-0000-0000-000000000001";
const TEST_COMPANY_ID = "95200000-0000-0000-0000-000000000001";
const TEST_CASE_ID = "95300000-0000-0000-0000-000000000001";
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;

type ClosableRepository = ReturnType<typeof createWhatsAppRepository>;

const repositories: ClosableRepository[] = [];
let testSql: SqlClient | undefined;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for WhatsApp integration tests.");
  }

  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

function repositoryFor(): ClosableRepository {
  const repository = createWhatsAppRepository(databaseUrl!);
  repositories.push(repository);
  return repository;
}

async function cleanupWhatsAppFixtures() {
  if (!databaseUrl) return;

  const sql = sqlForTests();

  await sql.begin(async (tx) => {
    await tx`
      delete from notification_outbox
      where company_id = ${TEST_COMPANY_ID}
        or idempotency_key like 'follow-up:phase2-test:%'
    `;
    await tx`
      delete from whatsapp_webhook_events
      where provider_event_id like 'phase2-test-%'
        or normalized_message_id in (
          select id from whatsapp_messages where provider_message_id like 'phase2-test-%'
        )
    `;
    await tx`
      delete from whatsapp_messages
      where provider_message_id like 'phase2-test-%'
        or body like 'Phase 2 test%'
        or case_id = ${TEST_CASE_ID}
    `;
    await tx`
      delete from whatsapp_templates
      where template_name like 'phase2_test_%'
    `;
    await tx`
      delete from whatsapp_contacts
      where whatsapp_id like 'phase2-test-%'
        or phone_e164 in (
          '+85261234567',
          '+85269990001',
          '+85261000001',
          '+85261000002',
          '+85261000003',
          '+85261000004'
        )
    `;
    await tx`
      delete from timeline_events
      where case_id = ${TEST_CASE_ID}
        or metadata ->> 'source' = 'phase2-whatsapp-test'
        or metadata ->> 'providerMessageId' like 'phase2-test-%'
    `;
    await tx`
      delete from annual_return_cases
      where id = ${TEST_CASE_ID}
    `;
    await tx`
      delete from companies
      where id = ${TEST_COMPANY_ID}
    `;
    await tx`
      delete from users
      where id = ${TEST_USER_ID}
    `;
    await tx`
      delete from teams
      where id = ${TEST_TEAM_ID}
    `;
  });
}

async function createAnnualReturnCaseFixture() {
  const sql = sqlForTests();

  await sql.begin(async (tx) => {
    await tx`
      insert into teams (id, name, active)
      values (${TEST_TEAM_ID}, 'Phase 2 WhatsApp Test Team', true)
    `;
    await tx`
      insert into users (id, name, email, role, team_id, active)
      values (
        ${TEST_USER_ID},
        'Phase 2 Staff',
        'phase2-whatsapp-test@kossilon.hk',
        'Staff',
        ${TEST_TEAM_ID},
        true
      )
    `;
    await tx`
      update teams
      set manager_id = ${TEST_USER_ID}
      where id = ${TEST_TEAM_ID}
    `;
    await tx`
      insert into companies (
        id,
        company_name,
        cr_number,
        br_number,
        incorporation_date,
        annual_return_basis_date,
        registered_office,
        company_secretary,
        status,
        assigned_owner_id,
        assigned_team_id
      )
      values (
        ${TEST_COMPANY_ID},
        'Phase 2 WhatsApp Test Ltd',
        'P2WCR0001',
        'P2WBR0001',
        '2021-07-01',
        '2026-07-01',
        'Unit 2, WhatsApp Test Tower, Hong Kong',
        'Kossilon Corporate Services Limited',
        'active',
        ${TEST_USER_ID},
        ${TEST_TEAM_ID}
      )
    `;
    await tx`
      insert into annual_return_cases (
        id,
        company_id,
        return_year,
        made_up_date,
        filing_due_date,
        current_status,
        risk_level,
        owner_id,
        reviewer_id,
        reminders_sent
      )
      values (
        ${TEST_CASE_ID},
        ${TEST_COMPANY_ID},
        2091,
        '2026-07-01',
        '2026-08-12',
        'Upcoming',
        'green',
        ${TEST_USER_ID},
        ${TEST_USER_ID},
        0
      )
    `;
  });
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});

afterAll(async () => {
  await testSql?.end();
});

describe("WhatsApp follow-up replay metadata", () => {
  it("fails closed when an existing idempotency row has no usable message reference", () => {
    expect(resolveWhatsAppReplayMessageId(undefined)).toBeNull();
    expect(
      resolveWhatsAppReplayMessageId({
        payload: { whatsappMessageId: "11111111-1111-4111-8111-111111111111" },
      }),
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(() => resolveWhatsAppReplayMessageId({ payload: {} })).toThrow(
      /existing WhatsApp follow-up cannot be replayed/i,
    );
    expect(() => resolveWhatsAppReplayMessageId({ payload: null })).toThrow(
      /existing WhatsApp follow-up cannot be replayed/i,
    );
  });
});

describe("WhatsApp contact identity reconciliation", () => {
  it("prefers the WhatsApp identity and marks split phone contacts for merge", () => {
    expect(
      planContactIdentityMerge(
        {
          whatsAppId: "phase2-test-wa-split",
          phoneE164: "+85269990001",
        },
        [
          {
            id: "phone-contact",
            company_id: TEST_COMPANY_ID,
            display_name: "Phone Contact",
            phone_e164: "+85269990001",
            whatsapp_id: null,
          },
          {
            id: "wa-contact",
            company_id: null,
            display_name: "WhatsApp Contact",
            phone_e164: null,
            whatsapp_id: "phase2-test-wa-split",
          },
        ],
      ),
    ).toEqual({
      primary: {
        id: "wa-contact",
        company_id: null,
        display_name: "WhatsApp Contact",
        phone_e164: null,
        whatsapp_id: "phase2-test-wa-split",
      },
      duplicateContactIds: ["phone-contact"],
      duplicateCompanyId: TEST_COMPANY_ID,
      duplicateDisplayName: "Phone Contact",
    });
  });
});

describe.skipIf(!databaseUrl)("WhatsApp repository", () => {
  beforeEach(async () => {
    await cleanupWhatsAppFixtures();
    await createAnnualReturnCaseFixture();
  });

  afterEach(async () => {
    await cleanupWhatsAppFixtures();
  });

  it(
    "records inbound messages once while upserting the WhatsApp contact",
    async () => {
      const repository = repositoryFor();
      // WOZTELL's real inbound shape is {from, to, timestamp, type, data, member,
      // channel, app} — a single `from` identity, not Meta's separate wa_id/phone
      // pair. `from` drives both fromWhatsAppId and fromPhone (normalizePhone(from)),
      // so it has to be phone-like for the phone_e164 assertion below to be
      // meaningful — "+85261234567" is also in cleanupWhatsAppFixtures' fixed
      // phone_e164 list, so no cleanup-filter change is needed.
      const normalized = normalizeWoztellInboundMessage({
        from: "+85261234567",
        to: "85268227287",
        timestamp: "2026-07-05T12:10:00.000Z",
        type: "TEXT",
        data: { text: "Phase 2 test inbound annual return question" },
        member: "memberId",
        channel: "kossilon-whatsapp-channel",
        app: "appId",
        messageId: "phase2-test-inbound-001",
      });

      const first = await repository.recordInboundMessage(normalized);
      const second = await repository.recordInboundMessage(normalized);

      expect(first).toMatchObject({
        provider: "woztell",
        direction: "inbound",
        status: "received",
        companyId: null,
        caseId: null,
        timelineEventCreated: false,
      });
      expect(second).toEqual(first);

      const sql = sqlForTests();
      const contacts = await sql<{ whatsapp_id: string | null; phone_e164: string | null }[]>`
        select whatsapp_id, phone_e164
        from whatsapp_contacts
        where id = ${first.contactId}
      `;
      // WOZTELL sends one identity (`from`), so whatsapp_id and phone_e164 are
      // both derived from it and are equal here — unlike Meta's independent
      // wa_id/phone fields.
      expect(contacts).toEqual([
        {
          whatsapp_id: "+85261234567",
          phone_e164: "+85261234567",
        },
      ]);

      const messages = await sql<{ count: number }[]>`
        select count(*)::int as count
        from whatsapp_messages
        where provider_message_id = 'phase2-test-inbound-001'
      `;
      expect(messages[0].count).toBe(1);

      const timelineEvents = await sql<{ count: number }[]>`
        select count(*)::int as count
        from timeline_events
        where event_type = 'whatsapp_message_received'
          and metadata ->> 'providerMessageId' = 'phase2-test-inbound-001'
      `;
      expect(timelineEvents[0].count).toBe(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "queues outbound template messages against an annual return case and timeline",
    async () => {
      const repository = repositoryFor();

      const message = await repository.queueOutboundTemplateMessage({
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

      expect(message).toMatchObject({
        provider: "woztell",
        direction: "outbound",
        status: "queued",
        companyId: TEST_COMPANY_ID,
        caseId: TEST_CASE_ID,
        phoneE164: "+85269990001",
        whatsAppId: "phase2-test-wa-outbound",
        body: "Phase 2 test annual return reminder body.",
      });

      const sql = sqlForTests();
      const timelineEvents = await sql<{ event_type: string; description: string }[]>`
        select event_type, description
        from timeline_events
        where case_id = ${TEST_CASE_ID}
      `;
      expect(timelineEvents).toEqual([
        {
          event_type: "whatsapp_message_queued",
          description:
            "Queued WhatsApp template phase2_test_annual_return_30_day for Phase 2 Director.",
        },
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "replays stable follow-up keys without duplicating messages, outbox, or timeline",
    async () => {
      const repository = repositoryFor();
      const input = {
        actorId: TEST_USER_ID,
        caseId: TEST_CASE_ID,
        toPhone: "+852 6999 0001",
        contactName: "Phase 2 Director",
        templateName: "phase2_test_follow_up",
        languageCode: "en",
        category: "document" as const,
        body: "Phase 2 test replacement request.",
        idempotencyKey: `follow-up:phase2-test:${TEST_CASE_ID}:${TEST_CASE_ID}`,
        followUpId: TEST_CASE_ID,
        metadata: { source: "phase2-test", entityId: TEST_CASE_ID },
      };
      const first = await repository.queueOutboundTemplateMessage(input);
      const replay = await repository.queueOutboundTemplateMessage(input);
      expect(first.idempotentReplay).toBe(false);
      expect(replay).toMatchObject({ id: first.id, idempotentReplay: true });
      const sql = sqlForTests();
      await sql`
        update notification_outbox
        set payload = '{}'::jsonb
        where idempotency_key = ${input.idempotencyKey}
      `;
      await expect(repository.queueOutboundTemplateMessage(input)).rejects.toThrow(
        /existing WhatsApp follow-up cannot be replayed/i,
      );
      const messages = await sql<{ count: number }[]>`
        select count(*)::int as count from whatsapp_messages
        where case_id = ${TEST_CASE_ID} and body = ${input.body}
      `;
      const outbox = await sql<{ count: number }[]>`
        select count(*)::int as count from notification_outbox
        where idempotency_key = ${input.idempotencyKey}
      `;
      const timeline = await sql<{ count: number }[]>`
        select count(*)::int as count from timeline_events
        where case_id = ${TEST_CASE_ID}
          and event_type = 'whatsapp_message_queued'
          and metadata ->> 'followUpId' = ${TEST_CASE_ID}
      `;
      expect(messages[0].count).toBe(1);
      expect(outbox[0].count).toBe(1);
      expect(timeline[0].count).toBe(1);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
  it(
    "matches inbound replies to a prior outbound annual return case and records timeline",
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
      // The outbound leg above set toWhatsAppId "phase2-test-wa-outbound" and
      // toPhone "+852 6999 0001" directly (not through the normalizer). For the
      // inbound reply to match that same contact, its `from` only needs to equal
      // one of those two values — `from` now feeds both fromWhatsAppId and
      // fromPhone (normalizePhone(from)), so it can no longer carry a synthetic
      // wa-id and a real phone independently. Using the phone value lets the
      // repository match by phone_e164 and keeps phoneE164 below meaningful;
      // recordInboundMessage stores fromWhatsAppId verbatim on the message row,
      // so whatsAppId below reflects that same phone-like `from`, not the
      // contact's original synthetic wa-id.
      const normalized = normalizeWoztellInboundMessage({
        from: "+85269990001",
        to: "85268227287",
        timestamp: "2026-07-05T12:20:00.000Z",
        type: "TEXT",
        data: { text: "Phase 2 test reply: documents are ready." },
        member: "memberId",
        channel: "kossilon-whatsapp-channel",
        app: "appId",
        messageId: "phase2-test-inbound-reply-001",
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
        whatsAppId: "+85269990001",
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
          and event_type in ('whatsapp_message_queued', 'whatsapp_message_received')
        order by created_at asc, id asc
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

  it(
    "merges split contact identities before inbound matching",
    async () => {
      const sql = sqlForTests();
      // Seeded as a phone-like value, not a synthetic "phase2-test-..." id: WOZTELL's
      // single `from` field now drives both fromWhatsAppId and fromPhone in one shot,
      // so the inbound message below can only carry ONE raw identity string. For the
      // split-identity merge query to find *both* pre-existing rows (one keyed by
      // whatsapp_id, one by phone_e164), that one string has to equal both — hence
      // reusing the phone number here instead of a distinct synthetic wa-id.
      const [whatsAppContact] = await sql<{ id: string }[]>`
        insert into whatsapp_contacts (
          provider,
          whatsapp_id,
          display_name,
          metadata
        )
        values (
          'woztell',
          '+85269990001',
          'Split WhatsApp Contact',
          ${sql.json({})}
        )
        returning id
      `;
      await sql`
        insert into whatsapp_contacts (
          provider,
          phone_e164,
          display_name,
          company_id,
          metadata
        )
        values (
          'woztell',
          '+85269990001',
          'Split Phone Contact',
          ${TEST_COMPANY_ID},
          ${sql.json({})}
        )
      `;
      const repository = repositoryFor();
      const normalized = normalizeWoztellInboundMessage({
        from: "+85269990001",
        to: "85268227287",
        timestamp: "2026-07-05T12:25:00.000Z",
        type: "TEXT",
        data: { text: "Phase 2 test split identity reply." },
        member: "memberId",
        channel: "kossilon-whatsapp-channel",
        app: "appId",
        messageId: "phase2-test-inbound-split-001",
      });

      const inbound = await repository.recordInboundMessage(normalized);

      // recordInboundMessage stores fromWhatsAppId/fromPhone verbatim on the
      // message row, and both now come from the same `from` string, so they are
      // equal here (see the seed comment above for why the WA-only contact was
      // itself seeded with that same phone-like value).
      expect(inbound).toMatchObject({
        contactId: whatsAppContact.id,
        companyId: TEST_COMPANY_ID,
        caseId: TEST_CASE_ID,
        phoneE164: "+85269990001",
        whatsAppId: "+85269990001",
        timelineEventCreated: true,
      });

      const contacts = await sql<
        {
          id: string;
          company_id: string | null;
          phone_e164: string | null;
          whatsapp_id: string | null;
        }[]
      >`
        select id, company_id, phone_e164, whatsapp_id
        from whatsapp_contacts
        where whatsapp_id = '+85269990001'
          or phone_e164 = '+85269990001'
        order by id asc
      `;
      expect(contacts).toEqual([
        {
          id: whatsAppContact.id,
          company_id: TEST_COMPANY_ID,
          phone_e164: "+85269990001",
          whatsapp_id: "+85269990001",
        },
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "records raw webhook events and processing status",
    async () => {
      const repository = repositoryFor();
      const payload = {
        id: "phase2-test-webhook-001",
        type: "delivery",
      };

      const event = await repository.recordWebhookEvent({
        providerEventId: "phase2-test-webhook-001",
        signatureValid: true,
        payload,
        processingStatus: "processed",
        normalizedMessageId: null,
        errorMessage: null,
      });

      expect(event).toMatchObject({
        provider: "woztell",
        providerEventId: "phase2-test-webhook-001",
        signatureValid: true,
        processingStatus: "processed",
        errorMessage: null,
      });
      expect(event.payload).toEqual(payload);
      expect(event.processedAt).not.toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // WOZTELL's inbound payload has one `from` identity (no separate wa_id/phone,
  // no profile name — normalizeWoztellInboundMessage always sets contactName to
  // null). The conversations below are told apart by phone number, not by a
  // display name that WOZTELL never sends.
  function inboundFixture(input: {
    from: string;
    messageId: string;
    body: string;
    timestamp: string;
  }) {
    return normalizeWoztellInboundMessage({
      from: input.from,
      to: "85268227287",
      timestamp: input.timestamp,
      type: "TEXT",
      data: { text: input.body },
      member: "memberId",
      channel: "kossilon-whatsapp-channel",
      app: "appId",
      messageId: input.messageId,
    });
  }

  it(
    "lists conversations newest first, each showing its own latest message",
    async () => {
      const repository = repositoryFor();

      await repository.recordInboundMessage(
        inboundFixture({
          from: "+85261000001",
          messageId: "phase2-test-inbox-a-1",
          body: "First question from A",
          timestamp: "2026-07-05T09:00:00.000Z",
        }),
      );
      await repository.recordInboundMessage(
        inboundFixture({
          from: "+85261000002",
          messageId: "phase2-test-inbox-b-1",
          body: "Only question from B",
          timestamp: "2026-07-05T10:00:00.000Z",
        }),
      );
      await repository.recordInboundMessage(
        inboundFixture({
          from: "+85261000001",
          messageId: "phase2-test-inbox-a-2",
          body: "Latest question from A",
          timestamp: "2026-07-05T11:00:00.000Z",
        }),
      );

      const conversations = await repository.listConversations();

      // A ahead of B because A's newest is 11:00, and A's preview is that newest
      // message rather than its first — the `distinct on` has to pick the latest.
      // Distinguished by phone number, not display name: WOZTELL's channel webhook
      // sends no profile name, so contact.display_name is null for both.
      expect(conversations.map((entry) => [entry.phoneE164, entry.lastMessageBody])).toEqual([
        ["+85261000001", "Latest question from A"],
        ["+85261000002", "Only question from B"],
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "reads a thread newest first so a limit keeps the most recent messages",
    async () => {
      const repository = repositoryFor();
      const oldest = await repository.recordInboundMessage(
        inboundFixture({
          from: "+85261000004",
          messageId: "phase2-test-thread-1",
          body: "one",
          timestamp: "2026-07-05T09:00:00.000Z",
        }),
      );
      for (const [index, timestamp] of [
        "2026-07-05T10:00:00.000Z",
        "2026-07-05T11:00:00.000Z",
      ].entries()) {
        await repository.recordInboundMessage(
          inboundFixture({
            from: "+85261000004",
            messageId: `phase2-test-thread-${index + 2}`,
            body: index === 0 ? "two" : "three",
            timestamp,
          }),
        );
      }

      const limited = await repository.listConversationMessages({
        contactId: oldest.contactId!,
        limit: 2,
      });

      // Ascending order here would hand back the two oldest and silently drop the
      // messages a reader actually wants.
      expect(limited.map((entry) => entry.body)).toEqual(["three", "two"]);
      expect(sortConversationMessagesOldestFirst(limited).map((entry) => entry.body)).toEqual([
        "two",
        "three",
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "carries the company and case a queued template message was sent against",
    async () => {
      const repository = repositoryFor();
      await repository.queueOutboundTemplateMessage({
        actorId: TEST_USER_ID,
        caseId: TEST_CASE_ID,
        toPhone: "+852 6100 0003",
        contactName: "Template Recipient",
        templateName: "annual-return-reminder",
        category: "annual_return",
        body: "Reminder body",
      });

      const [conversation] = await repository.listConversations();

      // Exercises the companies join and the coalesce that prefers the message's
      // own company over the contact's.
      expect(conversation).toMatchObject({
        companyId: TEST_COMPANY_ID,
        companyName: "Phase 2 WhatsApp Test Ltd",
        caseId: TEST_CASE_ID,
        lastMessageDirection: "outbound",
        lastMessageBody: "Reminder body",
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "applies a DELIVERED then READ receipt without ever downgrading the status",
    async () => {
      const repository = repositoryFor();
      const providerMessageId = "phase2-test-receipt-001";

      await repository.recordInboundMessage({
        provider: "woztell",
        providerMessageId,
        channelId: "channel-1",
        fromWhatsAppId: "phase2-test-wa-receipt-001",
        fromPhone: "+85290000009",
        contactName: null,
        messageType: "text",
        body: "seed row for receipt test",
        receivedAt: new Date().toISOString(),
        rawPayload: {},
      });

      const delivered = await repository.recordMessageStatusEvent({
        provider: "woztell",
        providerMessageId,
        status: "delivered",
        occurredAt: "2026-08-16T10:00:00.000Z",
      });
      expect(delivered.matched).toBe(true);
      expect(delivered.status).toBe("delivered");

      const read = await repository.recordMessageStatusEvent({
        provider: "woztell",
        providerMessageId,
        status: "read",
        occurredAt: "2026-08-16T10:05:00.000Z",
      });
      expect(read.status).toBe("read");

      // A late-arriving DELIVERED must not drag a read message backwards.
      const late = await repository.recordMessageStatusEvent({
        provider: "woztell",
        providerMessageId,
        status: "delivered",
        occurredAt: "2026-08-16T10:06:00.000Z",
      });
      expect(late.status).toBe("read");

      // The returned status alone would still pass if the timestamp columns were
      // wrong. Each column must hold the FIRST receipt of its kind — that is what
      // the coalesce is for, and the late DELIVERED at 10:06 must not overwrite
      // the 10:00 one.
      const [row] = await sqlForTests()<{ delivered_at: string | null; read_at: string | null }[]>`
        select delivered_at::text as delivered_at, read_at::text as read_at
        from whatsapp_messages
        where provider = 'woztell' and provider_message_id = ${providerMessageId}
      `;

      expect(new Date(row.delivered_at!).toISOString()).toBe("2026-08-16T10:00:00.000Z");
      expect(new Date(row.read_at!).toISOString()).toBe("2026-08-16T10:05:00.000Z");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // A receipt for a message this firm never recorded is normal — it must be
  // reported as unmatched, not thrown, or the webhook answers 503 and WOZTELL
  // redelivers it forever.
  it(
    "reports an unmatched receipt instead of throwing",
    async () => {
      const repository = repositoryFor();

      const result = await repository.recordMessageStatusEvent({
        provider: "woztell",
        providerMessageId: "phase2-test-receipt-does-not-exist",
        status: "read",
        occurredAt: "2026-08-16T10:00:00.000Z",
      });

      expect(result).toEqual({ matched: false, messageId: null, status: null });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "attaches a provider message id exactly once",
    async () => {
      const repository = repositoryFor();
      const seeded = await repository.recordInboundMessage({
        provider: "woztell",
        providerMessageId: "phase2-test-attach-seed-001",
        channelId: "channel-1",
        fromWhatsAppId: "phase2-test-wa-attach-001",
        fromPhone: "+85290000010",
        contactName: null,
        messageType: "text",
        body: "seed row for attach test",
        receivedAt: new Date().toISOString(),
        rawPayload: {},
      });

      // Already has an id, so the guarded update must refuse it.
      await expect(
        repository.attachProviderMessageId({
          messageId: seeded.id,
          providerMessageId: "phase2-test-attach-002",
        }),
      ).resolves.toBe(false);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // The success path — the one that actually matters in production. A queued
  // outbound row starts with provider_message_id NULL; until this links it, no
  // DELIVERED or READ receipt can ever match the row.
  it(
    "links a queued outbound row to its provider id and marks it sent",
    async () => {
      const repository = repositoryFor();
      const sql = sqlForTests();

      // Body prefix matters: cleanupWhatsAppFixtures also matches on
      // `body like 'Phase 2 test%'`, which is the only handle on this row while
      // provider_message_id is still null.
      const [queued] = await sql<{ id: string }[]>`
        insert into whatsapp_messages (provider, direction, status, body)
        values ('woztell', 'outbound', 'queued', 'Phase 2 test queued outbound')
        returning id
      `;

      await expect(
        repository.attachProviderMessageId({
          messageId: queued.id,
          providerMessageId: "phase2-test-attach-linked-001",
        }),
      ).resolves.toBe(true);

      const [linked] = await sql<
        { provider_message_id: string | null; status: string; sent_at: string | null }[]
      >`
        select provider_message_id, status, sent_at::text as sent_at
        from whatsapp_messages
        where id = ${queued.id}
      `;

      expect(linked.provider_message_id).toBe("phase2-test-attach-linked-001");
      expect(linked.status).toBe("sent");
      expect(linked.sent_at).not.toBeNull();

      // Idempotent: a retried dispatch must not relabel an already-linked row.
      await expect(
        repository.attachProviderMessageId({
          messageId: queued.id,
          providerMessageId: "phase2-test-attach-linked-002",
        }),
      ).resolves.toBe(false);

      // And a receipt can now find it — the whole point of the link.
      const applied = await repository.recordMessageStatusEvent({
        provider: "woztell",
        providerMessageId: "phase2-test-attach-linked-001",
        status: "delivered",
        occurredAt: "2026-08-16T11:00:00.000Z",
      });

      expect(applied).toMatchObject({ matched: true, messageId: queued.id, status: "delivered" });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
