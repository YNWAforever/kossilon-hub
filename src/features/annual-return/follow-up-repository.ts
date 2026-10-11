import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";

import type { NotificationStatus } from "@/features/notifications/types";
import { followUpEvidenceQuery } from "./follow-up-scope";
import type {
  PersistedFollowUpDelivery,
  PersistedFollowUpEvidence,
  PersistedFollowUpRecipient,
  PersistedFollowUpState,
} from "./follow-ups";

type QueryClient = SqlClient | postgres.TransactionSql;

type RecipientRow = {
  case_id: string;
  recipient_name: string;
  recipient_phone: string;
  recorded_at: string | Date;
};

type DeliveryRow = {
  idempotency_key: string;
  status: NotificationStatus;
  delivery: "provider" | "simulated" | null;
  provider_message_id: string | null;
  message_status: PersistedFollowUpDelivery["messageStatus"];
  last_error_code: string | null;
  dispatch_started: boolean;
};

export type ProductionFollowUpRepository = {
  listPersistedState(caseIds: string[]): Promise<PersistedFollowUpState>;
  close(): Promise<void>;
};

export function createProductionFollowUpRepository(
  options?: CreateSqlClientOptions & { sql?: QueryClient },
): ProductionFollowUpRepository;
export function createProductionFollowUpRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): ProductionFollowUpRepository;
export function createProductionFollowUpRepository(
  databaseUrlOrOptions: string | (CreateSqlClientOptions & { sql?: QueryClient }) = {},
  maybeOptions: CreateSqlClientOptions = {},
): ProductionFollowUpRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options = typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    async listPersistedState(caseIds) {
      if (caseIds.length === 0) return { recipients: [], evidence: [], deliveries: [] };

      const recipients = await sql<RecipientRow[]>`
        select distinct on (case_id)
          case_id, recipient_name, recipient_phone, recorded_sent_at as recorded_at
        from reminder_logs
        where case_id = any(${caseIds}::uuid[])
        order by case_id, recorded_sent_at desc, created_at desc, id desc
      `;
      const evidence = await followUpEvidenceQuery(sql, caseIds);
      const deliveries = await sql<DeliveryRow[]>`
        select o.idempotency_key,o.status,o.delivery,o.provider_message_id,
          wm.status message_status,o.last_error_code,(o.dispatch_started_attempt is not null) dispatch_started
        from notification_outbox o
        left join whatsapp_messages wm on wm.id::text=o.payload->>'whatsappMessageId'
          and wm.provider='woztell' and wm.provider_message_id=o.provider_message_id
        where o.idempotency_key like 'follow-up:%'
          and o.payload ->> 'caseId' = any(${caseIds}::text[])
      `;

      return {
        recipients: recipients.map<PersistedFollowUpRecipient>((row) => ({
          caseId: row.case_id,
          recipientName: row.recipient_name,
          recipientPhone: row.recipient_phone,
          recordedAt: new Date(row.recorded_at).toISOString(),
        })),
        evidence: evidence.map<PersistedFollowUpEvidence>((row) => ({
          documentId: row.document_id,
          documentVersionId: row.document_version_id,
          caseId: row.case_id,
          companyId: row.company_id,
          source: row.source,
          category: row.category,
          fileName: row.file_name,
          reviewStatus: row.review_status,
          uploadStatus: "available",
          uploadedAt: new Date(row.uploaded_at).toISOString(),
          rejectionReason: row.rejection_reason,
        })),
        deliveries: deliveries.map<PersistedFollowUpDelivery>((row) => ({
          idempotencyKey: row.idempotency_key,
          status: row.status,
          delivery: row.delivery,
          providerMessageId: row.provider_message_id,
          messageStatus: row.message_status,
          lastErrorCode: row.last_error_code,
          dispatchStarted: row.dispatch_started,
        })),
      };
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
