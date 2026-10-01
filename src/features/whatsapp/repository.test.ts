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
const INBOX_ADMIN = {
  authUserId: "owned-admin-reader",
  userId: TEST_USER_ID,
  teamId: TEST_TEAM_ID,
  role: "Admin" as const,
  active: true,
};
const TEST_COMPANY_ID = "95200000-0000-0000-0000-000000000001";
const TEST_CASE_ID = "95300000-0000-0000-0000-000000000001";
/** A second client, so one phone number can be messaged by two of them. */
const SHARED_COMPANY_ID = "95200000-0000-0000-0000-000000000002";
const SHARED_CASE_ID = "95300000-0000-0000-0000-000000000002";
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
      -- Both companies. The shared-number test introduced SHARED_COMPANY_ID and
      -- this sweep still named only the first, so the companies delete below hit
      -- notification_outbox_company_id_fkey and took the whole test with it.
      where company_id in (${TEST_COMPANY_ID}, ${SHARED_COMPANY_ID})
        or idempotency_key like 'follow-up:phase2-test:%'
    `;
    // The two predicates below must stay identical: the first clears the
    // children of exactly the rows the second removes, and a webhook event left
    // pointing at a deleted message fails the delete and takes the run with it.
    await tx`
      delete from whatsapp_webhook_events
      where provider_event_id like 'phase2-test-%'
        or normalized_message_id in (
          select id
          from whatsapp_messages
          where provider_message_id like 'phase2-test-%'
            or provider_message_id like 'test-window-%'
            or body like 'Phase 2 test%'
            or case_id in (${TEST_CASE_ID}, ${SHARED_CASE_ID})
            or contact_id in (
              select id
              from whatsapp_contacts
              where whatsapp_id like 'phase2-%' or phone_e164 like '+8526999%'
            )
        )
    `;
    // `contact_id` is the durable handle, and it is here because every other
    // column on these rows can be nulled out from under this delete.
    //
    // The shared-number test queues against SHARED_CASE_ID, which this predicate
    // never named, so its two messages survived. The cases delete further down
    // then set their case_id to NULL -- whatsapp_messages.case_id is
    // ON DELETE SET NULL -- and a row with no provider id, no company and now no
    // case matched nothing at all. Unreachable, and one more of them every run.
    await tx`
      delete from whatsapp_messages
      where provider_message_id like 'phase2-test-%'
        or provider_message_id like 'test-window-%'
        or body like 'Phase 2 test%'
        or case_id in (${TEST_CASE_ID}, ${SHARED_CASE_ID})
        or contact_id in (
          select id
          from whatsapp_contacts
          where whatsapp_id like 'phase2-%' or phone_e164 like '+8526999%'
        )
    `;
    await tx`
      delete from whatsapp_templates
      where template_name like 'phase2_test_%'
    `;
    await tx`
      -- 'phase2-%' rather than 'phase2-test-%', and the whole +8526999 fixture
      -- range rather than the two numbers someone remembered to list.
      --
      -- "clears a contact's company when two clients share the number" ends, by
      -- design, with company_id NULL and whatsapp_id 'phase2-shared-number'.
      -- That matched neither predicate, so the row it deliberately orphans was
      -- the one row this teardown could not see, and it survived every run.
      -- The next run then found an extra conversation in the listing and failed
      -- an assertion three hundred lines away. CI never saw it: a fresh Postgres
      -- per job means there is never a next run.
      delete from whatsapp_contacts
      where whatsapp_id like 'phase2-%'
        or phone_e164 like '+8526999%'
        or phone_e164 in (
          '85260903521',
          '+85260903521',
          '85261234567',
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
    // Every FK child of annual_return_cases that does NOT cascade. This file
    // never writes them, but whole-book sweeps in other suites do —
    // evaluateReminders() walks every open case in the database and inserts an
    // annual_return_reminder_events row for each eligible one, this fixture
    // included. Those FKs are deliberately restrict/no-action so real audit and
    // reminder history cannot be erased by a case delete, which means one stray
    // sweep row makes the delete below throw, rolls this whole transaction back,
    // and leaves the fixture company alive to break every later run.
    await tx`
      delete from annual_return_reminder_events
      where case_id = ${TEST_CASE_ID}
    `;
    await tx`
      delete from annual_return_audit_events
      where case_id in (${TEST_CASE_ID}, ${SHARED_CASE_ID})
        or company_id in (${TEST_COMPANY_ID}, ${SHARED_COMPANY_ID})
    `;
    // work_items is itself the parent of three restrict-only children, so
    // clearing them has to come first or the delete below just trades one
    // foreign key violation for another. (notification_outbox, the third, is
    // already deleted by company_id at the top of this transaction.)
    await tx`
      delete from assignment_events
      where work_item_id in (
        select id from work_items
        where annual_return_case_id = ${TEST_CASE_ID}
          or company_id = ${TEST_COMPANY_ID}
      )
    `;
    await tx`
      delete from escalation_events
      where work_item_id in (
        select id from work_items
        where annual_return_case_id = ${TEST_CASE_ID}
          or company_id = ${TEST_COMPANY_ID}
      )
    `;
    await tx`
      delete from work_items
      where annual_return_case_id = ${TEST_CASE_ID}
        or company_id = ${TEST_COMPANY_ID}
    `;
    await tx`
      delete from document_upload_intents
      where case_id in (${TEST_CASE_ID}, ${SHARED_CASE_ID})
        or company_id in (${TEST_COMPANY_ID}, ${SHARED_COMPANY_ID})
    `;
    await tx`
      delete from annual_return_cases
      where id in (${TEST_CASE_ID}, ${SHARED_CASE_ID})
    `;
    // companies has seven further restrict-only children that are deliberately
    // NOT swept here: client_company_memberships, corporate_change_requests,
    // incorporation_cases, officers, scr_inspection_requests, shareholdings and
    // significant_controllers. Every insert into them is an explicit
    // create against one named company, so no other test file's sweep can
    // attach one to this fixture; deleting them would be dead work on every
    // teardown. If any of them ever gains a whole-book sweep the way
    // evaluateReminders() did, add it here — and note the order is not free:
    // corporate_change_requests references officers and shareholdings with
    // restrict, and work_items references corporate_change_requests, so those
    // have to be removed innermost-first or the delete just moves the error.
    await tx`
      delete from companies
      where id in (${TEST_COMPANY_ID}, ${SHARED_COMPANY_ID})
    `;
    await tx`
      delete from staff_profiles where user_id=${TEST_USER_ID}
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
    await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${TEST_USER_ID},'owned-whatsapp-auth','Staff',${TEST_TEAM_ID},true)`;
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
      insert into companies (
        id, company_name, cr_number, br_number, incorporation_date,
        annual_return_basis_date, registered_office, company_secretary, status,
        assigned_owner_id, assigned_team_id
      )
      values (
        ${SHARED_COMPANY_ID}, 'Phase 2 Shared Number Ltd', 'P2WCR0002', 'P2WBR0002',
        '2021-07-02', '2026-07-02', 'Unit 3, WhatsApp Test Tower, Hong Kong',
        'Kossilon Corporate Services Limited', 'active', ${TEST_USER_ID}, ${TEST_TEAM_ID}
      )
    `;
    await tx`
      insert into annual_return_cases (
        id, company_id, return_year, made_up_date, filing_due_date,
        current_status, risk_level, owner_id, reviewer_id, reminders_sent
      )
      values (
        ${SHARED_CASE_ID}, ${SHARED_COMPANY_ID}, 2091, '2026-07-02', '2026-08-13',
        'Upcoming', 'green', ${TEST_USER_ID}, ${TEST_USER_ID}, 0
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
  it("rechecks current verified queue identity before creating outbound rows", async () => {
    const rollback = new Error("owned queue authority rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const repository = createWhatsAppRepository({ sql: tx });
        const input = {
          actorId: TEST_USER_ID,
          actorAuthUserId: "owned-whatsapp-auth",
          caseId: TEST_CASE_ID,
          toPhone: "+85269990101",
          templateName: "phase2_test_queue_auth",
          category: "general" as const,
          body: "Owned local queue identity test",
        };
        await expect(
          repository.queueOutboundTemplateMessage({ ...input, actorAuthUserId: "foreign-auth" }),
        ).rejects.toThrow(/verified staff/);
        await tx`update staff_profiles set active=false where user_id=${TEST_USER_ID}`;
        await expect(repository.queueOutboundTemplateMessage(input)).rejects.toThrow(
          /verified staff/,
        );
        const [count] = await tx<
          { count: number }[]
        >`select count(*)::int count from whatsapp_messages where case_id=${TEST_CASE_ID} and direction='outbound'`;
        expect(count.count).toBe(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("retains an early signed receipt contract and reconciles it after provider ID attachment", async () => {
    const rollback = new Error("owned early receipt rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const repository = createWhatsAppRepository({ sql: tx });
        const message = await repository.queueOutboundTemplateMessage({
          actorId: TEST_USER_ID,
          caseId: TEST_CASE_ID,
          toPhone: "+85269990102",
          templateName: "phase2_test_early_receipt",
          category: "general",
          body: "Owned local receipt race",
        });
        const providerId = `owned-early-${crypto.randomUUID()}`;
        await repository.recordWebhookEvent({
          providerEventId: crypto.randomUUID(),
          signatureValid: false,
          payload: { type: "READ", messageId: providerId, timestamp: "1790850000" },
          processingStatus: "ignored",
          normalizedMessageId: null,
          errorMessage: "Signature invalid",
        });
        const receiptEventId = crypto.randomUUID();
        const event = await repository.recordWebhookEvent({
          providerEventId: receiptEventId,
          signatureValid: true,
          payload: { type: "DELIVERED", messageId: providerId, timestamp: "1790850000" },
          processingStatus: "ignored",
          normalizedMessageId: null,
          errorMessage: "No outbound message matched this status update.",
        });
        await repository.recordWebhookEvent({
          providerEventId: receiptEventId,
          signatureValid: false,
          payload: { type: "READ", messageId: providerId },
          processingStatus: "ignored",
          normalizedMessageId: null,
          errorMessage: "Signature invalid",
        });
        const [protectedSource] = await tx<
          { signature_valid: boolean; type: string }[]
        >`select signature_valid,payload->>'type' type from whatsapp_webhook_events where id=${event.id}`;
        expect(protectedSource).toEqual({ signature_valid: true, type: "DELIVERED" });
        await repository.recordWebhookEvent({
          providerEventId: receiptEventId,
          signatureValid: true,
          payload: { type: "READ", messageId: providerId, timestamp: "1790850300" },
          processingStatus: "ignored",
          normalizedMessageId: null,
          errorMessage: null,
        });
        await repository.attachProviderMessageId({
          messageId: message.id,
          providerMessageId: providerId,
          sentAs: "text",
        });
        const [stored] = await tx<
          { status: string; delivered_at: string | null }[]
        >`select status,delivered_at::text from whatsapp_messages where id=${message.id}`;
        expect(stored).toMatchObject({ status: "delivered", delivered_at: expect.any(String) });
        const [audit] = await tx<
          { processing_status: string; normalized_message_id: string }[]
        >`select processing_status,normalized_message_id from whatsapp_webhook_events where id=${event.id}`;
        expect(audit).toMatchObject({
          processing_status: "processed",
          normalized_message_id: message.id,
        });
        // A receipt recorded after linkage is also reconciled in the event transaction.
        await repository.recordWebhookEvent({
          providerEventId: crypto.randomUUID(),
          signatureValid: true,
          payload: { type: "READ", data: { messageId: providerId }, timestamp: "1790850300" },
          processingStatus: "ignored",
          normalizedMessageId: null,
          errorMessage: "No outbound message matched this status update.",
        });
        const [read] = await tx<
          { status: string }[]
        >`select status from whatsapp_messages where id=${message.id}`;
        expect(read.status).toBe("read");
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it(
    "scopes each message before choosing a shared contact's latest conversation",
    async () => {
      const rollback = new Error("owned inbox visibility rollback");
      await expect(
        sqlForTests().begin(async (tx) => {
          const repository = createWhatsAppRepository({ sql: tx });
          const sharedPhone = "+85269990051";
          const first = await repository.queueOutboundTemplateMessage({
            actorId: TEST_USER_ID,
            caseId: TEST_CASE_ID,
            toPhone: sharedPhone,
            templateName: "phase2_test_scope",
            category: "general",
            body: "Phase 2 test allowed text",
          });
          const second = await repository.queueOutboundTemplateMessage({
            actorId: TEST_USER_ID,
            caseId: SHARED_CASE_ID,
            toPhone: sharedPhone,
            templateName: "phase2_test_scope",
            category: "general",
            body: "Phase 2 test private other team",
          });
          const [otherTeam] = await tx<
            { id: string }[]
          >`insert into teams(name) values('owned inbox other team') returning id`;
          const [otherUser] = await tx<
            { id: string }[]
          >`select id from users where id<>${TEST_USER_ID} limit 1`;
          await tx`update companies set assigned_team_id=${otherTeam.id} where id=${SHARED_COMPANY_ID}`;
          await tx`update annual_return_cases set owner_id=${otherUser.id},reviewer_id=null where id=${SHARED_CASE_ID}`;
          const unknown = await repository.recordInboundMessage(
            normalizeWoztellInboundMessage({
              from: "85269990052",
              messageId: "phase2-test-unmapped-scope",
              timestamp: "1790850000",
              type: "TEXT",
              data: { text: "Phase 2 test unassigned intake" },
            }),
          );
          const actor = {
            authUserId: "owned-reader",
            userId: TEST_USER_ID,
            teamId: TEST_TEAM_ID,
            role: "Staff" as const,
            active: true,
          };
          const conversations = await repository.listConversations({ actor });
          expect(
            conversations.find((row) => row.contactId === first.contactId)?.lastMessageBody,
          ).toBe(first.body);
          expect(conversations.some((row) => row.contactId === unknown.contactId)).toBe(false);
          const messages = await repository.listConversationMessages({
            contactId: first.contactId!,
            actor,
          });
          expect(messages.map((row) => row.id)).toContain(first.id);
          expect(messages.map((row) => row.id)).not.toContain(second.id);
          expect(
            (await repository.listConversations({ actor: { ...actor, role: "Admin" } })).some(
              (row) => row.contactId === unknown.contactId,
            ),
          ).toBe(true);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

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
      // pair. `from` drives both fromWhatsAppId and fromPhone (normalizePhone(from)).
      // `from` is BARE DIGITS with no plus (see woztell-fixtures.ts, copied from
      // WOZTELL's docs); normalizePhone only preserves a leading "+", never adds
      // one, so phone_e164 lands unprefixed too. A "+85261234567" here would be a
      // value WOZTELL never sends, and would hide the format mismatch that
      // lastInboundAtForPhoneDigits exists to bridge. "85261234567" is in
      // cleanupWhatsAppFixtures' fixed phone_e164 list.
      const normalized = normalizeWoztellInboundMessage({
        from: "85261234567",
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
          whatsapp_id: "85261234567",
          phone_e164: "85261234567",
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
    "resolves the last inbound timestamp across real-world phone formats",
    async () => {
      const repository = repositoryFor();
      // WOZTELL's documented inbound `from` is bare digits with no plus.
      const inboundFrom = "85260903521";
      const receivedAt = "2026-08-26T02:00:00.000Z";

      await repository.recordInboundMessage({
        provider: "woztell",
        providerMessageId: `test-window-${inboundFrom}`,
        channelId: null,
        fromWhatsAppId: inboundFrom,
        fromPhone: inboundFrom,
        contactName: "Window Test",
        messageType: "text",
        body: "Hello",
        receivedAt,
        attachments: [],
        rawPayload: {},
      });

      // The sweeps enqueue company_contacts.phone verbatim, and the firm's house
      // format is spaced. Exact string equality against phone_e164 would miss.
      const sweepRecipient = "+852 6090 3521";
      const resolved = await repository.lastInboundAtForPhoneDigits(
        sweepRecipient.replace(/\D/g, ""),
      );

      expect(resolved).not.toBeNull();
      expect(new Date(resolved!).toISOString()).toBe(receivedAt);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "spans the duplicate contact rows the format split creates, taking the latest",
    async () => {
      const repository = repositoryFor();
      // One human, two contact rows. upsertContact looks contacts up by exact
      // string equality and whatsapp_contacts_provider_phone_uidx keys on the raw
      // string, so the bare-digit row WOZTELL creates on inbound and the
      // plus-prefixed row a staff send creates never collide — production already
      // holds pairs like this.
      const earlierAt = "2026-08-25T02:00:00.000Z";
      const laterAt = "2026-08-26T02:00:00.000Z";

      const earlier = await repository.recordInboundMessage({
        provider: "woztell",
        providerMessageId: "test-window-dup-bare",
        channelId: null,
        fromWhatsAppId: "85260903521",
        fromPhone: "85260903521",
        contactName: "Window Dup Bare",
        messageType: "text",
        body: "Earlier",
        receivedAt: earlierAt,
        attachments: [],
        rawPayload: {},
      });
      const later = await repository.recordInboundMessage({
        provider: "woztell",
        providerMessageId: "test-window-dup-plus",
        channelId: null,
        fromWhatsAppId: "+85260903521",
        fromPhone: "+85260903521",
        contactName: "Window Dup Plus",
        messageType: "text",
        body: "Later",
        receivedAt: laterAt,
        attachments: [],
        rawPayload: {},
      });

      // Pin the precondition: if these two ever merge into a single contact row,
      // the assertion below would still pass while proving nothing about spanning.
      expect(later.contactId).not.toBe(earlier.contactId);

      const resolved = await repository.lastInboundAtForPhoneDigits("85260903521");

      // max() runs across BOTH rows. A contact-first query that resolves one
      // contact id and then reads its messages would return whichever row it
      // happened to pick — the earlier one here, closing the window early and
      // downgrading a free-form reply to a paid template.
      expect(resolved).not.toBeNull();
      expect(new Date(resolved!).toISOString()).toBe(laterAt);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "returns null for a number that has never messaged us",
    async () => {
      const repository = repositoryFor();
      expect(await repository.lastInboundAtForPhoneDigits("85299999999")).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "returns null for an empty digit string rather than matching digitless contacts",
    async () => {
      const repository = repositoryFor();
      expect(await repository.lastInboundAtForPhoneDigits("")).toBeNull();
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

      const conversations = await repository.listConversations({ actor: INBOX_ADMIN });

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
        actor: INBOX_ADMIN,
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

      const [conversation] = await repository.listConversations({ actor: INBOX_ADMIN });

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
        attachments: [],
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
        attachments: [],
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

  /**
   * A nominee director serving several shell companies from one number.
   *
   * company_id used to be `coalesce(input, existing, ...)`, so every staff send
   * repointed the contact at whichever company messaged last. resolveInboundMatch
   * prefers the last outbound message, so the primary path was unaffected -- but
   * an unsolicited inbound, the one case that falls back to this column, was then
   * filed against whichever client had messaged most recently.
   */
  it(
    "clears a contact's company when two clients share the number, rather than picking one",
    async () => {
      const repository = repositoryFor();
      const sql = sqlForTests();
      const sharedPhone = "+852 6999 0042";

      await repository.queueOutboundTemplateMessage({
        actorId: TEST_USER_ID,
        caseId: TEST_CASE_ID,
        toPhone: sharedPhone,
        toWhatsAppId: "phase2-shared-number",
        contactName: "Nominee Director",
        templateName: "phase2_test_annual_return_30_day",
        languageCode: "en",
        category: "annual_return",
        body: "First client reminder.",
      });

      const afterFirst = await sql<{ company_id: string | null }[]>`
        select company_id from whatsapp_contacts where whatsapp_id = 'phase2-shared-number'
      `;
      // Unambiguous so far: one client, one number.
      expect(afterFirst[0]?.company_id).toBe(TEST_COMPANY_ID);

      await repository.queueOutboundTemplateMessage({
        actorId: TEST_USER_ID,
        caseId: SHARED_CASE_ID,
        toPhone: sharedPhone,
        toWhatsAppId: "phase2-shared-number",
        contactName: "Nominee Director",
        templateName: "phase2_test_annual_return_30_day",
        languageCode: "en",
        category: "annual_return",
        body: "Second client reminder.",
      });

      const afterSecond = await sql<{ company_id: string | null }[]>`
        select company_id from whatsapp_contacts where whatsapp_id = 'phase2-shared-number'
      `;
      // Null, not the second company. A number two clients use belongs to
      // neither, and naming one would file the other's reply against it.
      expect(afterSecond[0]?.company_id).toBeNull();
      const incoming = normalizeWoztellInboundMessage({
        from: "phase2-shared-number",
        timestamp: "1790850000",
        type: "TEXT",
        data: { text: "Phase 2 test ambiguous reply" },
        channel: "test-channel",
        messageId: "phase2-test-ambiguous-001",
      });
      const inbound = await repository.recordInboundMessage(incoming);
      expect(inbound).toMatchObject({ companyId: null, caseId: null, timelineEventCreated: false });
      expect((await repository.recordInboundMessage(incoming)).id).toBe(inbound.id);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
