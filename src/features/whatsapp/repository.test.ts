import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { normalizeWoztellInboundMessage } from "./woztell";
import { createWhatsAppRepository } from "./repository";

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
        or phone_e164 in ('+85261234567', '+85269990001')
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
      const normalized = normalizeWoztellInboundMessage({
        event: "message",
        channel: { id: "kossilon-whatsapp-channel" },
        contact: {
          wa_id: "phase2-test-wa-001",
          phone: "+852 6123 4567",
          profile: { name: "Phase 2 Client" },
        },
        message: {
          id: "phase2-test-inbound-001",
          type: "text",
          text: { body: "Phase 2 test inbound annual return question" },
          timestamp: "2026-07-05T12:10:00.000Z",
        },
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
      expect(contacts).toEqual([
        {
          whatsapp_id: "phase2-test-wa-001",
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
});
