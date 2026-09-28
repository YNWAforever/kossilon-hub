import { getSqlClient, type SqlClient } from "@/server/db/client";
import { notificationPayload, type NotificationOutboxRecord } from "@/features/notifications/types";

/** Final persisted-contact and case check before a live provider call. */
export async function validateQueuedFollowUpPreview(
  notification: NotificationOutboxRecord,
  sql: SqlClient = getSqlClient(),
): Promise<void> {
  try {
    const payload = notificationPayload(notification);
    const fields = [
      payload.contactId,
      payload.contactVersion,
      payload.companyId,
      payload.caseId,
      payload.recipientName,
      payload.recipientE164,
      payload.languageCode,
      payload.previewHash,
      payload.renderedText,
    ];
    if (fields.some((value) => typeof value !== "string" || !value)) {
      throw new Error("Follow-up approval metadata is incomplete.");
    }
    if (
      payload.frozenSendMode !== "text" ||
      notification.companyId !== payload.companyId ||
      notification.recipient !== payload.recipientE164 ||
      payload.body !== payload.renderedText
    ) {
      throw new Error("Follow-up differs from its approved recipient or text.");
    }
    const rows = await sql<
      {
        phone_e164: string | null;
        phone_verified_at: string | null;
        name: string;
        preferred_language: string | null;
        updated_at: string;
        current_status: string;
        data_origin: string;
      }[]
    >`
      select cc.phone_e164, cc.phone_verified_at::text as phone_verified_at,
        cc.name, cc.preferred_language, cc.updated_at::text as updated_at,
        arc.current_status, c.data_origin
      from company_contacts cc
      join companies c on c.id = cc.company_id
      join annual_return_cases arc on arc.company_id = c.id
      where cc.id = ${payload.contactId as string}
        and c.id = ${payload.companyId as string}
        and arc.id = ${payload.caseId as string}
      limit 1
    `;
    const row = rows[0];
    if (
      !row ||
      row.data_origin !== "client" ||
      row.current_status === "Completed" ||
      row.current_status === "Filed" ||
      !row.phone_verified_at ||
      row.phone_e164 !== payload.recipientE164 ||
      row.name !== payload.recipientName ||
      row.preferred_language !== payload.languageCode ||
      row.updated_at !== payload.contactVersion
    ) {
      throw new Error("Follow-up contact or case changed since approval.");
    }
  } catch (cause) {
    throw Object.assign(new Error("Follow-up preview requires fresh approval.", { cause }), {
      code: "whatsapp_preview_stale",
    });
  }
}
