import type postgres from "postgres";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { createWhatsAppRepository } from "./repository";
import { toPhoneDigits } from "./phone";
import {
  assertPreviewStillCurrent,
  type MessageContext,
  type MessagePreview,
  type MessagePreviewDependencies,
} from "./message-preview";

type QueryClient = SqlClient | postgres.TransactionSql;
type CaseRow = {
  id: string;
  company_id: string;
  company_name: string;
  assigned_team_id: string;
  owner_id: string;
  reviewer_id: string | null;
  current_status: string;
  data_origin: "client" | "fixture";
};
type ContactRow = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  phone_e164: string | null;
  phone_verified_at: string | null;
  preferred_language: string | null;
  updated_at: string;
};
type TemplateRow = {
  template_name: string;
  language_code: string;
  body: string;
  status: string;
  provider_approval_verified_at: string | null;
};
type PreviewRow = { payload: MessagePreview; queued_message_id: string | null };

async function loadContext(
  sql: QueryClient,
  input: {
    caseId: string;
    contactId: string;
    conversationId?: string | null;
    templateName?: string | null;
  },
  lock: boolean,
): Promise<MessageContext> {
  const cases = await sql<CaseRow[]>`
    select arc.id, arc.company_id, c.company_name, c.assigned_team_id,
      arc.owner_id, arc.reviewer_id, arc.current_status, c.data_origin
    from annual_return_cases arc
    join companies c on c.id = arc.company_id
    where arc.id = ${input.caseId}
    ${lock ? sql`for update of arc` : sql``}
  `;
  const row = cases[0];
  if (!row) throw new Error("Annual return case not found.");
  const contacts = await sql<ContactRow[]>`
    select id, company_id, name, role, phone_e164,
      phone_verified_at::text as phone_verified_at, preferred_language,
      updated_at::text as updated_at
    from company_contacts
    where id = ${input.contactId} and company_id = ${row.company_id}
    ${lock ? sql`for update` : sql``}
  `;
  const contact = contacts[0] ?? null;
  let conversationId: string | null = null;
  if (input.conversationId && contact?.phone_e164) {
    const matches = await sql<{ id: string }[]>`
      select id from whatsapp_contacts
      where id = ${input.conversationId}
        and regexp_replace(coalesce(phone_e164,''), '[^0-9]', '', 'g')
          = ${toPhoneDigits(contact.phone_e164)!}
      limit 1
    `;
    conversationId = matches[0]?.id ?? null;
  }
  let lastInboundAt: string | null = null;
  if (contact?.phone_e164) {
    const inbound = await sql<{ last_inbound_at: string | null }[]>`
      select max(received_at)::text as last_inbound_at
      from whatsapp_messages
      where direction = 'inbound'
        and regexp_replace(coalesce(phone_e164,''), '[^0-9]', '', 'g')
          = ${toPhoneDigits(contact.phone_e164)!}
    `;
    lastInboundAt = inbound[0]?.last_inbound_at ?? null;
  }
  let template: MessageContext["template"] = null;
  if (input.templateName && contact?.preferred_language) {
    const templates = await sql<TemplateRow[]>`
      select template_name, language_code, body, status,
        provider_approval_verified_at::text as provider_approval_verified_at
      from whatsapp_templates
      where provider = 'woztell'
        and template_name = ${input.templateName}
        and language_code = ${contact.preferred_language}
      limit 1
      ${lock ? sql`for share` : sql``}
    `;
    const t = templates[0];
    if (t) {
      template = {
        name: t.template_name,
        languageCode: t.language_code,
        body: t.body,
        active: t.status === "active",
        providerApprovalVerified: t.provider_approval_verified_at !== null,
      };
    }
  }
  return {
    case: {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      companyTeamId: row.assigned_team_id,
      ownerId: row.owner_id,
      reviewerId: row.reviewer_id,
      status: row.current_status,
      dataOrigin: row.data_origin,
    },
    contact: contact
      ? {
          id: contact.id,
          companyId: contact.company_id,
          name: contact.name,
          role: contact.role,
          phoneE164: contact.phone_e164,
          phoneVerifiedAt: contact.phone_verified_at,
          languageCode: contact.preferred_language,
          updatedAt: contact.updated_at,
        }
      : null,
    conversationId,
    lastInboundAt,
    template,
  };
}

export function createMessagePreviewRepository(
  sql: SqlClient = getSqlClient(),
): MessagePreviewDependencies["repository"] {
  return {
    getContext: (input) => loadContext(sql, input, false),
    async savePreview(preview) {
      await sql`
        insert into whatsapp_message_previews (
          id, case_id, company_id, contact_id, conversation_id, created_by,
          preview_hash, payload, created_at, expires_at
        ) values (
          ${preview.previewId}, ${preview.caseId}, ${preview.companyId},
          ${preview.contactId}, ${preview.conversationId}, ${preview.createdBy},
          ${preview.previewHash}, ${sql.json(preview)},
          ${preview.createdAt}, ${preview.expiresAt}
        )
      `;
    },
    queueIfCurrent(previewId, callback) {
      return sql.begin(async (tx) => {
        const rows = await tx<PreviewRow[]>`
          select payload, queued_message_id
          from whatsapp_message_previews where id = ${previewId}
          for update
        `;
        const stored = rows[0];
        if (!stored) throw new Error("Message preview not found.");
        const preview = stored.payload;
        if (stored.queued_message_id) {
          throw new Error("This preview was already queued; inspect its existing delivery.");
        }
        const context = await loadContext(
          tx,
          {
            caseId: preview.caseId,
            contactId: preview.contactId,
            conversationId: preview.conversationId,
            templateName: preview.templateName,
          },
          true,
        );
        const whatsApp = createWhatsAppRepository({ sql: tx });
        const result = await callback(preview, context, (input) =>
          whatsApp.queueOutboundTemplateMessage(input),
        );
        await tx`
          update whatsapp_message_previews
          set queued_message_id = ${result.messageId}
          where id = ${previewId} and queued_message_id is null
        `;
        return result;
      }) as Promise<Awaited<ReturnType<typeof callback>>>;
    },
  };
}

/** Fail closed on any mismatch or database error before a live provider call. */
export async function validateQueuedMessagePreview(
  input: { previewId: string; previewHash: string; messageId: string; now: string },
  sql: SqlClient = getSqlClient(),
): Promise<void> {
  try {
    const rows = await sql<
      {
        preview_hash: string;
        queued_message_id: string | null;
        payload: MessagePreview;
      }[]
    >`
      select preview_hash, queued_message_id, payload
      from whatsapp_message_previews where id = ${input.previewId}
      limit 1
    `;
    const row = rows[0];
    if (
      !row ||
      row.preview_hash !== input.previewHash ||
      row.payload.previewHash !== input.previewHash ||
      row.queued_message_id !== input.messageId
    ) {
      throw new Error("Queued message does not match its approved preview.");
    }
    const preview = row.payload;
    const context = await loadContext(
      sql,
      {
        caseId: preview.caseId,
        contactId: preview.contactId,
        conversationId: preview.conversationId,
        templateName: preview.templateName,
      },
      false,
    );
    assertPreviewStillCurrent(preview, context, new Date(input.now));
  } catch (cause) {
    throw Object.assign(new Error("Message preview requires fresh approval.", { cause }), {
      code: "whatsapp_preview_stale",
    });
  }
}
