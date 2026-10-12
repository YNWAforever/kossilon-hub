import { z } from "zod";
import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { documentScopeForStaffActor } from "@/features/documents/authorization";
import {
  decodeTimestampCursor,
  encodeListCursor,
  literalContains,
  type ListPage,
} from "@/lib/list-page";
import {
  historyConversationsInput,
  historyMessagesInput,
  type HistoryThread,
} from "./history-page";
import type { WhatsAppConversationMessage } from "./conversations";
type Query = SqlClient | postgres.TransactionSql;

function actorKey(actor: AuthenticatedActor) {
  documentScopeForStaffActor(actor, "access");
  if (!actor.authUserId) throw Error("Forbidden: verified staff identity required.");
  return [actor.authUserId, actor.userId, actor.role, actor.teamId, actor.active];
}
/** Used before windows, count and boundary. A shared contact never grants message access. */
function messageScope(sql: Query, actor: AuthenticatedActor) {
  return sql`(${actor.role === "Admin"} or c.assigned_team_id=${actor.teamId}::uuid
    or a.owner_id=${actor.userId}::uuid or a.reviewer_id=${actor.userId}::uuid)`;
}
export function createWhatsAppHistoryRepository(sql: Query) {
  return {
    async conversations(
      actor: AuthenticatedActor,
      requested: z.input<typeof historyConversationsInput>,
    ): Promise<ListPage<HistoryThread>> {
      const input = historyConversationsInput.parse(requested),
        key = JSON.stringify(["threads", actorKey(actor), input.q, input.limit]);
      const cursor = decodeTimestampCursor(input.cursor, key);
      const scope = messageScope(sql, actor),
        q = literalContains(input.q);
      const filtered = sql`
        with authorized as materialized (
          select m.id,m.contact_id,m.body,m.direction,m.company_id,a.id authorized_case_id,c.company_name,
            coalesce(m.sent_at,m.received_at,m.created_at) occurred_at
          from whatsapp_messages m left join companies c on c.id=m.company_id
          left join annual_return_cases a on a.id=m.case_id and a.company_id=m.company_id
          where m.contact_id is not null and ${scope}
        ), ranked as (
          select *,row_number() over(partition by contact_id order by occurred_at desc,id desc) recency,
            first_value(authorized_case_id) over(partition by contact_id order by (authorized_case_id is null),occurred_at desc,id desc) linked_case,
            first_value(company_id) over(partition by contact_id order by (authorized_case_id is null),occurred_at desc,id desc) linked_company,
            count(*) over(partition by contact_id)::int message_count
          from authorized
        ), filtered as (
          select contact.id contact_id,contact.display_name,contact.phone_e164,
            coalesce(latest.linked_company,owned.id) company_id,
            coalesce(linked.company_name,owned.company_name) company_name,latest.linked_case case_id,
            coalesce(latest.body,'') last_message_body,latest.direction last_message_direction,
            latest.occurred_at::text last_message_at,coalesce(latest.message_count,0) message_count,
            coalesce(latest.occurred_at,contact.created_at) sort_at
          from whatsapp_contacts contact left join ranked latest on latest.contact_id=contact.id and latest.recency=1
          left join companies owned on owned.id=contact.company_id and (${actor.role === "Admin"} or owned.assigned_team_id=${actor.teamId}::uuid)
          left join companies linked on linked.id=latest.linked_company
          where (latest.contact_id is not null or owned.id is not null or ${actor.role === "Admin"})
            and (${input.q === ""} or contact.display_name ilike ${q} or contact.phone_e164 ilike ${q}
              or coalesce(linked.company_name,owned.company_name) ilike ${q}
              or exists(select 1 from authorized search where search.contact_id=contact.id and search.body ilike ${q}))
        )`;
      const [count] = await sql`${filtered} select count(*)::int total from filtered`;
      const rows = await sql`${filtered} select *,sort_at::text cursor_at from filtered
        where (${cursor === null} or sort_at<${cursor?.[0] ?? null}::text::timestamptz or (sort_at=${cursor?.[0] ?? null}::text::timestamptz and contact_id>${cursor?.[1] ?? null}::uuid))
        order by sort_at desc,contact_id limit ${input.limit + 1}`;
      const page = rows.slice(0, input.limit),
        last = page.at(-1);
      return {
        items: page.map((r) => ({
          contactId: r.contact_id,
          displayName: r.display_name,
          phoneE164: r.phone_e164,
          companyId: r.company_id,
          companyName: r.company_name,
          caseId: r.case_id,
          lastMessageBody: r.last_message_body,
          lastMessageDirection: r.last_message_direction,
          lastMessageAt: r.last_message_at,
          messageCount: r.message_count,
        })),
        total: count.total,
        observedAt: new Date().toISOString(),
        nextCursor:
          rows.length > input.limit && last
            ? encodeListCursor(key, [last.cursor_at, last.contact_id])
            : null,
      };
    },
    async messages(
      actor: AuthenticatedActor,
      requested: z.input<typeof historyMessagesInput>,
    ): Promise<ListPage<WhatsAppConversationMessage>> {
      const input = historyMessagesInput.parse(requested),
        key = JSON.stringify(["messages", actorKey(actor), input.contactId, input.limit]);
      const cursor = decodeTimestampCursor(input.cursor, key);
      const predicate = sql`m.contact_id=${input.contactId}::uuid and ${messageScope(sql, actor)}`;
      const [count] =
        await sql`select count(*)::int total from whatsapp_messages m left join companies c on c.id=m.company_id left join annual_return_cases a on a.id=m.case_id and a.company_id=m.company_id where ${predicate}`;
      const rows = await sql`with page as materialized (
        select m.*,a.id authorized_case_id,coalesce(m.sent_at,m.received_at,m.created_at) occurred_at from whatsapp_messages m
        left join companies c on c.id=m.company_id left join annual_return_cases a on a.id=m.case_id and a.company_id=m.company_id
        where ${predicate} and (${cursor === null} or (coalesce(m.sent_at,m.received_at,m.created_at),m.id)<(${cursor?.[0] ?? null}::text::timestamptz,${cursor?.[1] ?? null}::uuid))
        order by occurred_at desc,m.id desc limit ${input.limit + 1})
        select page.*,occurred_at::text cursor_at,created_at::text created_at,received_at::text received_at,sent_at::text sent_at,
          (select coalesce(json_agg(json_build_object('providerMediaId',media.provider_media_id,'mediaType',media.media_type,'hasDocument',media.document_id is not null) order by media.position),'[]'::json) from whatsapp_message_media media where media.message_id=page.id) attachments
        from page order by occurred_at desc,id desc`;
      const page = rows.slice(0, input.limit),
        last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: r.id,
          direction: r.direction,
          status: r.status,
          body: r.body,
          caseId: r.authorized_case_id,
          createdAt: r.created_at,
          receivedAt: r.received_at,
          sentAt: r.sent_at,
          sentAs: r.sent_as,
          sentTemplateName: r.sent_template_name,
          attachments: r.attachments,
        })),
        total: count.total,
        observedAt: new Date().toISOString(),
        nextCursor:
          rows.length > input.limit && last
            ? encodeListCursor(key, [last.cursor_at, last.id])
            : null,
      };
    },
  };
}
