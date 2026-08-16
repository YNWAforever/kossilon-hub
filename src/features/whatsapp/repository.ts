import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import { enqueueNotification } from "@/features/notifications/outbox";
// Both caps are bounded because a WhatsApp history has no natural end: an
// unbounded thread query would grow as the provider keeps delivering.
import {
  CONVERSATION_MESSAGE_PAGE_SIZE,
  CONVERSATION_PAGE_SIZE,
  type WhatsAppConversation,
  type WhatsAppConversationMessage,
} from "./conversations";
import type {
  NormalizedInboundWhatsAppMessage,
  NormalizedWoztellStatusEvent,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppProvider,
} from "./types";

export type WhatsAppTemplateCategory =
  | "annual_return"
  | "payment"
  | "document"
  | "signature"
  | "general";

export type WhatsAppWebhookProcessingStatus = "received" | "processed" | "ignored" | "failed";

export type WhatsAppMessageRecord = {
  id: string;
  provider: WhatsAppProvider;
  providerMessageId: string | null;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  contactId: string | null;
  companyId: string | null;
  caseId: string | null;
  templateId: string | null;
  phoneE164: string | null;
  whatsAppId: string | null;
  body: string;
  payload: postgres.JSONValue;
  sentBy: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  idempotentReplay?: boolean;
};

export type InboundWhatsAppMessageRecord = WhatsAppMessageRecord & {
  timelineEventCreated: boolean;
};

export type WhatsAppWebhookEventRecord = {
  id: string;
  provider: WhatsAppProvider;
  providerEventId: string | null;
  signatureValid: boolean;
  payload: postgres.JSONValue;
  normalizedMessageId: string | null;
  processingStatus: WhatsAppWebhookProcessingStatus;
  errorMessage: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export type QueueOutboundTemplateMessageInput = {
  actorId: string;
  caseId: string;
  toPhone: string;
  toWhatsAppId?: string | null;
  contactName?: string | null;
  templateName: string;
  languageCode?: string;
  category: WhatsAppTemplateCategory;
  body: string;
  idempotencyKey?: string;
  followUpId?: string;
  metadata?: Record<string, postgres.JSONValue>;
};

export function resolveWhatsAppReplayMessageId(
  existingOutbox: { payload: postgres.JSONValue | null } | undefined,
): string | null {
  if (!existingOutbox) return null;

  const payload = existingOutbox.payload;
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "whatsappMessageId" in payload &&
    typeof payload.whatsappMessageId === "string"
  ) {
    return payload.whatsappMessageId;
  }

  throw new Error("Existing WhatsApp follow-up cannot be replayed safely.");
}

export type RecordWebhookEventInput = {
  providerEventId: string | null;
  signatureValid: boolean;
  payload: unknown;
  processingStatus: WhatsAppWebhookProcessingStatus;
  normalizedMessageId: string | null;
  errorMessage: string | null;
};

export type WhatsAppStatusUpdateResult = {
  matched: boolean;
  messageId: string | null;
  status: WhatsAppMessageStatus | null;
};

/** read supersedes delivered supersedes sent. Receipts can arrive out of order. */
const WHATSAPP_STATUS_RANK: Readonly<Record<string, number>> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

export type ListConversationsInput = {
  limit?: number;
};

export type ListConversationMessagesInput = {
  contactId: string;
  limit?: number;
};

type QueryClient = SqlClient | postgres.TransactionSql;

export type CreateWhatsAppRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type WhatsAppRepository = {
  recordInboundMessage(
    input: NormalizedInboundWhatsAppMessage,
  ): Promise<InboundWhatsAppMessageRecord>;
  getCaseAuthorizationContext(caseId: string): Promise<WhatsAppCaseAuthorizationContext | null>;
  queueOutboundTemplateMessage(
    input: QueueOutboundTemplateMessageInput,
  ): Promise<WhatsAppMessageRecord>;
  recordWebhookEvent(input: RecordWebhookEventInput): Promise<WhatsAppWebhookEventRecord>;
  recordMessageStatusEvent(
    input: NormalizedWoztellStatusEvent,
  ): Promise<WhatsAppStatusUpdateResult>;
  attachProviderMessageId(input: {
    messageId: string;
    providerMessageId: string;
  }): Promise<boolean>;
  listConversations(input?: ListConversationsInput): Promise<WhatsAppConversation[]>;
  listConversationMessages(
    input: ListConversationMessagesInput,
  ): Promise<WhatsAppConversationMessage[]>;
  close(): Promise<void>;
};

type ContactRow = {
  id: string;
  company_id: string | null;
  display_name: string | null;
  phone_e164: string | null;
  whatsapp_id: string | null;
};

export type ContactIdentityMergeInput = {
  whatsAppId: string | null;
  phoneE164: string | null;
};

export type ContactUpsertCandidate = ContactRow;

export type ContactIdentityMergePlan = {
  primary: ContactUpsertCandidate | null;
  duplicateContactIds: string[];
  duplicateCompanyId: string | null;
  duplicateDisplayName: string | null;
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

type AnnualReturnCaseRow = {
  company_id: string;
  company_name: string;
};

/** Structurally satisfies AnnualReturnActionCase in ../annual-return/permissions. */
export type WhatsAppCaseAuthorizationContext = {
  id: string;
  companyName: string;
  companyTeamId: string;
  ownerId: string;
  reviewerId: string | null;
};

type CaseAuthorizationRow = {
  id: string;
  company_name: string;
  assigned_team_id: string;
  owner_id: string;
  reviewer_id: string | null;
};

type TemplateRow = {
  id: string;
};

type MessageRow = {
  id: string;
  provider: WhatsAppProvider;
  provider_message_id: string | null;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  contact_id: string | null;
  company_id: string | null;
  case_id: string | null;
  template_id: string | null;
  phone_e164: string | null;
  whatsapp_id: string | null;
  body: string;
  payload: postgres.JSONValue;
  sent_by: string | null;
  received_at: string | Date | null;
  sent_at: string | Date | null;
  created_at: string | Date;
};

type WebhookEventRow = {
  id: string;
  provider: WhatsAppProvider;
  provider_event_id: string | null;
  signature_valid: boolean;
  payload: postgres.JSONValue;
  normalized_message_id: string | null;
  processing_status: WhatsAppWebhookProcessingStatus;
  error_message: string | null;
  received_at: string | Date;
  processed_at: string | Date | null;
};

function timestampString(value: string | Date | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function toJsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value ?? {})) as postgres.JSONValue;
}

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return client.begin(handler) as Promise<T>;
  }

  return handler(client);
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    throw new Error("WhatsApp recipient phone must contain digits.");
  }

  return `${prefix}${digits}`;
}

function mapMessage(row: MessageRow): WhatsAppMessageRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    direction: row.direction,
    status: row.status,
    contactId: row.contact_id,
    companyId: row.company_id,
    caseId: row.case_id,
    templateId: row.template_id,
    phoneE164: row.phone_e164,
    whatsAppId: row.whatsapp_id,
    body: row.body,
    payload: row.payload,
    sentBy: row.sent_by,
    receivedAt: timestampString(row.received_at),
    sentAt: timestampString(row.sent_at),
    createdAt: timestampString(row.created_at)!,
  };
}

function mapWebhookEvent(row: WebhookEventRow): WhatsAppWebhookEventRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    signatureValid: row.signature_valid,
    payload: row.payload,
    normalizedMessageId: row.normalized_message_id,
    processingStatus: row.processing_status,
    errorMessage: row.error_message,
    receivedAt: timestampString(row.received_at)!,
    processedAt: timestampString(row.processed_at),
  };
}

function mapContact(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    displayName: row.display_name,
    phoneE164: row.phone_e164,
    whatsAppId: row.whatsapp_id,
  };
}

type ConversationRow = {
  contact_id: string;
  display_name: string | null;
  phone_e164: string | null;
  company_id: string | null;
  company_name: string | null;
  case_id: string | null;
  last_message_body: string;
  last_message_direction: WhatsAppMessageDirection;
  last_message_at: string | Date;
};

type ConversationMessageRow = {
  id: string;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  body: string;
  case_id: string | null;
  created_at: string | Date;
  received_at: string | Date | null;
  sent_at: string | Date | null;
};

function mapConversation(row: ConversationRow): WhatsAppConversation {
  return {
    contactId: row.contact_id,
    displayName: row.display_name,
    phoneE164: row.phone_e164,
    companyId: row.company_id,
    companyName: row.company_name,
    caseId: row.case_id,
    lastMessageBody: row.last_message_body,
    lastMessageDirection: row.last_message_direction,
    lastMessageAt: timestampString(row.last_message_at)!,
  };
}

function mapConversationMessage(row: ConversationMessageRow): WhatsAppConversationMessage {
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    body: row.body,
    caseId: row.case_id,
    createdAt: timestampString(row.created_at)!,
    receivedAt: timestampString(row.received_at),
    sentAt: timestampString(row.sent_at),
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

export function planContactIdentityMerge(
  input: ContactIdentityMergeInput,
  candidates: ContactUpsertCandidate[],
): ContactIdentityMergePlan {
  const primary =
    candidates.find(
      (candidate) => Boolean(input.whatsAppId) && candidate.whatsapp_id === input.whatsAppId,
    ) ??
    candidates.find(
      (candidate) => Boolean(input.phoneE164) && candidate.phone_e164 === input.phoneE164,
    ) ??
    candidates[0] ??
    null;
  const duplicates = primary ? candidates.filter((candidate) => candidate.id !== primary.id) : [];

  return {
    primary,
    duplicateContactIds: duplicates.map((candidate) => candidate.id),
    duplicateCompanyId: duplicates.find((candidate) => candidate.company_id)?.company_id ?? null,
    duplicateDisplayName:
      duplicates.find((candidate) => candidate.display_name)?.display_name ?? null,
  };
}

function contactIdentityLockKeys(input: {
  whatsAppId: string | null;
  phoneE164: string | null;
}): string[] {
  const keys = [
    input.whatsAppId ? `woztell:whatsapp_id:${input.whatsAppId}` : null,
    input.phoneE164 ? `woztell:phone_e164:${input.phoneE164}` : null,
  ];

  return Array.from(new Set(keys.filter((key): key is string => Boolean(key)))).sort();
}

async function lockContactIdentities(
  client: QueryClient,
  input: {
    whatsAppId: string | null;
    phoneE164: string | null;
  },
): Promise<void> {
  for (const lockKey of contactIdentityLockKeys(input)) {
    await client`
      select pg_advisory_xact_lock(hashtext('whatsapp_contacts'), hashtext(${lockKey}))
    `;
  }
}

export function createWhatsAppRepository(
  options?: CreateWhatsAppRepositoryOptions,
): WhatsAppRepository;
export function createWhatsAppRepository(
  databaseUrl: string | undefined,
  options?: CreateWhatsAppRepositoryOptions,
): WhatsAppRepository;
export function createWhatsAppRepository(
  databaseUrlOrOptions?: string | CreateWhatsAppRepositoryOptions,
  maybeOptions?: CreateWhatsAppRepositoryOptions,
): WhatsAppRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function upsertContact(
    client: QueryClient,
    input: {
      whatsAppId: string | null;
      phoneE164: string | null;
      displayName: string | null;
      companyId?: string | null;
    },
  ): Promise<ContactRecord> {
    await lockContactIdentities(client, input);

    const existingRows = await client<ContactRow[]>`
      select id, company_id, display_name, phone_e164, whatsapp_id
      from whatsapp_contacts
      where provider = 'woztell'
        and (
          (${input.whatsAppId}::text is not null and whatsapp_id = ${input.whatsAppId})
          or (${input.phoneE164}::text is not null and phone_e164 = ${input.phoneE164})
        )
      order by
        case
          when ${input.whatsAppId}::text is not null
            and whatsapp_id = ${input.whatsAppId}
          then 0
          when ${input.phoneE164}::text is not null
            and phone_e164 = ${input.phoneE164}
          then 1
          else 2
        end,
        id asc
    `;
    const mergePlan = planContactIdentityMerge(input, existingRows);
    const existing = mergePlan.primary;

    if (existing) {
      if (mergePlan.duplicateContactIds.length > 0) {
        await client`
          update whatsapp_messages
          set contact_id = ${existing.id},
              updated_at = now()
          where contact_id = any(${mergePlan.duplicateContactIds}::uuid[])
        `;
        await client`
          delete from whatsapp_contacts
          where id = any(${mergePlan.duplicateContactIds}::uuid[])
        `;
      }

      const updatedRows = await client<ContactRow[]>`
        update whatsapp_contacts
        set whatsapp_id = coalesce(whatsapp_contacts.whatsapp_id, ${input.whatsAppId}),
            phone_e164 = coalesce(whatsapp_contacts.phone_e164, ${input.phoneE164}),
            display_name = coalesce(
              ${input.displayName},
              whatsapp_contacts.display_name,
              ${mergePlan.duplicateDisplayName}
            ),
            company_id = coalesce(
              ${input.companyId ?? null},
              whatsapp_contacts.company_id,
              ${mergePlan.duplicateCompanyId}
            ),
            last_seen_at = now(),
            updated_at = now()
        where id = ${existing.id}
        returning id, company_id, display_name, phone_e164, whatsapp_id
      `;

      return mapContact(updatedRows[0]);
    }

    const insertedRows = await client<ContactRow[]>`
      insert into whatsapp_contacts (
        provider,
        whatsapp_id,
        phone_e164,
        display_name,
        company_id,
        metadata
      )
      values (
        'woztell',
        ${input.whatsAppId},
        ${input.phoneE164},
        ${input.displayName},
        ${input.companyId ?? null},
        ${client.json({})}
      )
      returning id, company_id, display_name, phone_e164, whatsapp_id
    `;

    return mapContact(insertedRows[0]);
  }

  async function upsertTemplate(
    client: QueryClient,
    input: {
      templateName: string;
      languageCode: string;
      category: WhatsAppTemplateCategory;
      body: string;
      actorId: string;
    },
  ): Promise<string> {
    const rows = await client<TemplateRow[]>`
      insert into whatsapp_templates (
        provider,
        template_name,
        language_code,
        category,
        status,
        body,
        created_by
      )
      values (
        'woztell',
        ${input.templateName},
        ${input.languageCode},
        ${input.category},
        'active',
        ${input.body},
        ${input.actorId}
      )
      on conflict (provider, template_name, language_code)
      do update set category = excluded.category,
                    status = excluded.status,
                    body = excluded.body,
                    updated_at = now()
      returning id
    `;

    return rows[0].id;
  }

  async function resolveInboundMatch(
    client: QueryClient,
    contact: ContactRecord,
  ): Promise<InboundMatch> {
    let companyId: string | null = null;
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
    const outboundCompanyId = outbound ? (outbound.company_id ?? outbound.case_company_id) : null;

    companyId = outboundCompanyId ?? contact.companyId;

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

  async function recordInboundMessage(
    input: NormalizedInboundWhatsAppMessage,
  ): Promise<InboundWhatsAppMessageRecord> {
    return withTransaction(sql, async (tx) => {
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
        on conflict (provider, provider_message_id)
        where provider_message_id is not null
        do nothing
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
      const [inserted] = rows;

      if (!inserted) {
        const conflictRows = await tx<MessageRow[]>`
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

        return {
          ...mapMessage(conflictRows[0]),
          timelineEventCreated: false,
        };
      }

      const message = mapMessage(inserted);
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

  /**
   * The fields `getAnnualReturnActionPermission` needs to decide whether this
   * actor may message this case's client. Sending a WhatsApp message to a client
   * is an action on the case, so it is scoped like every other case action rather
   * than being open to any staff member who knows a case id.
   */
  async function getCaseAuthorizationContext(
    caseId: string,
  ): Promise<WhatsAppCaseAuthorizationContext | null> {
    const rows = await sql<CaseAuthorizationRow[]>`
      select arc.id, c.company_name, c.assigned_team_id, arc.owner_id, arc.reviewer_id
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      where arc.id = ${caseId}
      limit 1
    `;
    const [row] = rows;
    if (!row) return null;

    return {
      id: row.id,
      companyName: row.company_name,
      companyTeamId: row.assigned_team_id,
      ownerId: row.owner_id,
      reviewerId: row.reviewer_id,
    };
  }

  async function queueOutboundTemplateMessage(
    input: QueueOutboundTemplateMessageInput,
  ): Promise<WhatsAppMessageRecord> {
    return withTransaction(sql, async (tx) => {
      const caseRows = await tx<AnnualReturnCaseRow[]>`
        select arc.company_id, c.company_name
        from annual_return_cases arc
        join companies c on c.id = arc.company_id
        where arc.id = ${input.caseId}
        limit 1
      `;
      const [caseRow] = caseRows;

      if (!caseRow) {
        throw new Error("Annual return case not found for WhatsApp template message.");
      }

      if (input.idempotencyKey) {
        await tx`
          select pg_advisory_xact_lock(
            hashtext('whatsapp_follow_up'),
            hashtext(${input.idempotencyKey})
          )
        `;
        const existingOutbox = await tx<{ payload: postgres.JSONValue | null }[]>`
          select payload
          from notification_outbox
          where idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const existingMessageId = resolveWhatsAppReplayMessageId(existingOutbox[0]);
        if (existingMessageId) {
          const existingMessages = await tx<MessageRow[]>`
            select
              id, provider, provider_message_id, direction, status, contact_id, company_id,
              case_id, template_id, phone_e164, whatsapp_id, body, payload, sent_by,
              received_at::text as received_at, sent_at::text as sent_at,
              created_at::text as created_at
            from whatsapp_messages
            where id = ${existingMessageId}
            limit 1
          `;
          if (existingMessages[0]) {
            return { ...mapMessage(existingMessages[0]), idempotentReplay: true };
          }
          throw new Error("Existing WhatsApp follow-up cannot be replayed safely.");
        }
      }

      const phoneE164 = normalizePhone(input.toPhone);
      const contact = await upsertContact(tx, {
        whatsAppId: input.toWhatsAppId ?? null,
        phoneE164,
        displayName: input.contactName ?? null,
        companyId: caseRow.company_id,
      });
      const templateId = await upsertTemplate(tx, {
        templateName: input.templateName,
        languageCode: input.languageCode ?? "en",
        category: input.category,
        body: input.body,
        actorId: input.actorId,
      });
      const payload = {
        source: "phase2-whatsapp-test",
        templateName: input.templateName,
        languageCode: input.languageCode ?? "en",
        category: input.category,
        followUpId: input.followUpId ?? null,
        ...input.metadata,
      };
      const messageRows = await tx<MessageRow[]>`
        insert into whatsapp_messages (
          provider,
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
          sent_by
        )
        values (
          'woztell',
          'outbound',
          'queued',
          ${contact.id},
          ${caseRow.company_id},
          ${input.caseId},
          ${templateId},
          ${phoneE164},
          ${input.toWhatsAppId ?? null},
          ${input.body},
          ${tx.json(payload)},
          ${input.actorId}
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
      const descriptionTarget = input.contactName ?? phoneE164;

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
          ${caseRow.company_id},
          ${input.caseId},
          'whatsapp_message_queued',
          'user',
          ${input.actorId},
          ${`Queued WhatsApp template ${input.templateName} for ${descriptionTarget}.`},
          ${tx.json({ ...payload, messageId: messageRows[0].id })}
        )
      `;

      await enqueueNotification(tx, {
        companyId: caseRow.company_id,
        channel: "whatsapp",
        notificationType: "whatsapp_template",
        idempotencyKey: input.idempotencyKey ?? `whatsapp-message:${messageRows[0].id}`,
        recipient: phoneE164,
        payload: {
          ...payload,
          body: input.body,
          toPhone: phoneE164,
          toWhatsAppId: input.toWhatsAppId ?? null,
          caseId: input.caseId,
          whatsappMessageId: messageRows[0].id,
        },
      });
      return { ...mapMessage(messageRows[0]), idempotentReplay: false };
    });
  }

  async function recordWebhookEvent(
    input: RecordWebhookEventInput,
  ): Promise<WhatsAppWebhookEventRecord> {
    const processedAt = input.processingStatus === "received" ? null : new Date().toISOString();
    const rows = await sql<WebhookEventRow[]>`
      insert into whatsapp_webhook_events (
        provider,
        provider_event_id,
        signature_valid,
        payload,
        normalized_message_id,
        processing_status,
        error_message,
        processed_at
      )
      values (
        'woztell',
        ${input.providerEventId},
        ${input.signatureValid},
        ${sql.json(toJsonValue(input.payload))},
        ${input.normalizedMessageId},
        ${input.processingStatus},
        ${input.errorMessage},
        ${processedAt}
      )
      on conflict (provider, provider_event_id)
      where provider_event_id is not null
      do update set signature_valid = excluded.signature_valid,
                    payload = excluded.payload,
                    normalized_message_id = excluded.normalized_message_id,
                    processing_status = excluded.processing_status,
                    error_message = excluded.error_message,
                    processed_at = excluded.processed_at
      returning
        id,
        provider,
        provider_event_id,
        signature_valid,
        payload,
        normalized_message_id,
        processing_status,
        error_message,
        received_at::text as received_at,
        processed_at::text as processed_at
    `;

    return mapWebhookEvent(rows[0]);
  }

  async function recordMessageStatusEvent(
    input: NormalizedWoztellStatusEvent,
  ): Promise<WhatsAppStatusUpdateResult> {
    const rank = WHATSAPP_STATUS_RANK[input.status] ?? 0;
    // The timestamp column is set with coalesce so the *first* receipt of a kind
    // wins; the status column only moves forward. WOZTELL gives no ordering
    // guarantee, and a redelivered DELIVERED after a READ must be a no-op.
    const rows = await sql<{ id: string; status: WhatsAppMessageStatus }[]>`
      update whatsapp_messages
      set
        status = case
          when ${rank}::int > coalesce(
            case status
              when 'read' then 3
              when 'delivered' then 2
              when 'sent' then 1
              else 0
            end, 0)
          then ${input.status}
          else status
        end,
        sent_at = case
          when ${input.status} = 'sent' then coalesce(sent_at, ${input.occurredAt}::timestamptz)
          else sent_at
        end,
        delivered_at = case
          when ${input.status} = 'delivered'
            then coalesce(delivered_at, ${input.occurredAt}::timestamptz)
          else delivered_at
        end,
        read_at = case
          when ${input.status} = 'read' then coalesce(read_at, ${input.occurredAt}::timestamptz)
          else read_at
        end,
        updated_at = now()
      where provider = 'woztell'
        and provider_message_id = ${input.providerMessageId}
      returning id, status
    `;
    const [updated] = rows;

    if (!updated) {
      return { matched: false, messageId: null, status: null };
    }

    return { matched: true, messageId: updated.id, status: updated.status };
  }

  /**
   * Links a queued outbound row to the id WOZTELL assigned when it was actually
   * sent. Without this the row's provider_message_id stays null forever and no
   * DELIVERED or READ receipt can ever match it.
   */
  async function attachProviderMessageId(input: {
    messageId: string;
    providerMessageId: string;
  }): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      update whatsapp_messages
      set provider_message_id = ${input.providerMessageId},
          status = case when status = 'queued' then 'sent' else status end,
          sent_at = coalesce(sent_at, now()),
          updated_at = now()
      where id = ${input.messageId}
        and provider_message_id is null
      returning id
    `;

    return rows.length > 0;
  }

  // `coalesce(sent_at, received_at, created_at)` here has to stay in step with
  // conversationMessageOccurredAt() in ./conversations — the same rule decides
  // which rows a limit keeps and how the thread reads once it reaches the browser.
  async function listConversations(
    input: ListConversationsInput = {},
  ): Promise<WhatsAppConversation[]> {
    const limit = input.limit ?? CONVERSATION_PAGE_SIZE;
    const rows = await sql<ConversationRow[]>`
      -- One pass over whatsapp_messages. Two distinct-on CTEs read the same rows
      -- twice, and the ordering expression is not cheap.
      with ranked as (
        select
          m.contact_id,
          m.body,
          m.direction,
          m.company_id,
          coalesce(m.sent_at, m.received_at, m.created_at) as occurred_at,
          row_number() over (
            partition by m.contact_id
            order by coalesce(m.sent_at, m.received_at, m.created_at) desc, m.id desc
          ) as recency,
          -- The case of the most recent message that HAS one, so a single
          -- unmatched inbound reply cannot make the annual-return link vanish
          -- from a thread that is plainly about it. A null case sorts last, so
          -- rows carrying a case win the window regardless of recency.
          first_value(m.case_id) over (
            partition by m.contact_id
            order by
              (m.case_id is null),
              coalesce(m.sent_at, m.received_at, m.created_at) desc,
              m.id desc
          ) as case_id,
          -- Taken from that same row, so the company shown never belongs to a
          -- different case than the one the link points at.
          first_value(m.company_id) over (
            partition by m.contact_id
            order by
              (m.case_id is null),
              coalesce(m.sent_at, m.received_at, m.created_at) desc,
              m.id desc
          ) as case_company_id
        from whatsapp_messages m
        where m.contact_id is not null
      ),
      latest as (
        select
          contact_id,
          body,
          direction,
          occurred_at,
          case_id,
          coalesce(
            case when case_id is not null then case_company_id end,
            company_id
          ) as company_id
        from ranked
        where recency = 1
      )
      select
        contact.id as contact_id,
        contact.display_name,
        contact.phone_e164,
        coalesce(latest.company_id, contact.company_id) as company_id,
        company.company_name,
        latest.case_id,
        latest.body as last_message_body,
        latest.direction as last_message_direction,
        latest.occurred_at::text as last_message_at
      from latest
      join whatsapp_contacts contact on contact.id = latest.contact_id
      left join companies company on company.id = coalesce(latest.company_id, contact.company_id)
      order by latest.occurred_at desc, contact.id asc
      limit ${limit}
    `;

    return rows.map(mapConversation);
  }

  async function listConversationMessages(
    input: ListConversationMessagesInput,
  ): Promise<WhatsAppConversationMessage[]> {
    const limit = input.limit ?? CONVERSATION_MESSAGE_PAGE_SIZE;
    // Newest first so the limit keeps the most recent slice of a long thread;
    // sortConversationMessagesOldestFirst() restores reading order for display.
    const rows = await sql<ConversationMessageRow[]>`
      select
        id,
        direction,
        status,
        body,
        case_id,
        created_at::text as created_at,
        received_at::text as received_at,
        sent_at::text as sent_at
      from whatsapp_messages
      where contact_id = ${input.contactId}::uuid
      order by coalesce(sent_at, received_at, created_at) desc, id desc
      limit ${limit}
    `;

    return rows.map(mapConversationMessage);
  }

  return {
    recordInboundMessage,
    getCaseAuthorizationContext,
    queueOutboundTemplateMessage,
    recordWebhookEvent,
    recordMessageStatusEvent,
    attachProviderMessageId,
    listConversations,
    listConversationMessages,
    async close() {
      if (ownsClient && "end" in sql) {
        await sql.end();
      }
    },
  };
}
