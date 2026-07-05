import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import type {
  NormalizedInboundWhatsAppMessage,
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
};

export type RecordWebhookEventInput = {
  providerEventId: string | null;
  signatureValid: boolean;
  payload: unknown;
  processingStatus: WhatsAppWebhookProcessingStatus;
  normalizedMessageId: string | null;
  errorMessage: string | null;
};

export type CreateWhatsAppRepositoryOptions = CreateSqlClientOptions & {
  sql?: SqlClient;
};

export type WhatsAppRepository = {
  recordInboundMessage(
    input: NormalizedInboundWhatsAppMessage,
  ): Promise<InboundWhatsAppMessageRecord>;
  queueOutboundTemplateMessage(
    input: QueueOutboundTemplateMessageInput,
  ): Promise<WhatsAppMessageRecord>;
  recordWebhookEvent(input: RecordWebhookEventInput): Promise<WhatsAppWebhookEventRecord>;
  close(): Promise<void>;
};

type QueryClient = SqlClient | postgres.TransactionSql;

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

type AnnualReturnCaseRow = {
  company_id: string;
  company_name: string;
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
    const existingRows = await client<ContactRow[]>`
      select id, company_id, display_name, phone_e164, whatsapp_id
      from whatsapp_contacts
      where provider = 'woztell'
        and (
          (${input.whatsAppId}::text is not null and whatsapp_id = ${input.whatsAppId})
          or (${input.phoneE164}::text is not null and phone_e164 = ${input.phoneE164})
        )
      limit 1
    `;
    const [existing] = existingRows;

    if (existing) {
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

  async function queueOutboundTemplateMessage(
    input: QueueOutboundTemplateMessageInput,
  ): Promise<WhatsAppMessageRecord> {
    return sql.begin(async (tx) => {
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

      return mapMessage(messageRows[0]);
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

  return {
    recordInboundMessage,
    queueOutboundTemplateMessage,
    recordWebhookEvent,
    async close() {
      if (ownsClient) {
        await sql.end();
      }
    },
  };
}
