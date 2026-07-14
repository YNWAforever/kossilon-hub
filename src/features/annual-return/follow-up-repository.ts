import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { DocumentCategory } from "@/features/documents/types";
import type { NotificationStatus } from "@/features/notifications/types";
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

type EvidenceRow = {
  document_id: string;
  case_id: string;
  company_id: string;
  source: PersistedFollowUpEvidence["source"];
  category: DocumentCategory;
  file_name: string;
  review_status: PersistedFollowUpEvidence["reviewStatus"];
  uploaded_at: string | Date;
  rejection_reason: string | null;
};

type DeliveryRow = {
  idempotency_key: string;
  status: NotificationStatus;
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
      const evidence = await sql<EvidenceRow[]>`
        with referenced_evidence as (
          select distinct
            d.id as document_id,
            d.case_id,
            d.company_id,
            'document-review'::text as source,
            d.file_type as category,
            d.file_name,
            d.verification_status as review_status,
            d.uploaded_at
          from documents d
          join annual_return_checklist_items checklist
            on checklist.document_id = d.id
            and checklist.case_id = d.case_id
          join document_upload_intents intent on intent.document_id = d.id
          where d.case_id = any(${caseIds}::uuid[])
            and intent.status = 'available'

          union

          select distinct
            d.id as document_id,
            d.case_id,
            d.company_id,
            'payment-proof-review'::text as source,
            d.file_type as category,
            d.file_name,
            d.verification_status as review_status,
            d.uploaded_at
          from documents d
          join payments payment
            on payment.payment_proof_document_id = d.id
            and payment.case_id = d.case_id
          join document_upload_intents intent on intent.document_id = d.id
          where d.case_id = any(${caseIds}::uuid[])
            and intent.status = 'available'
        )
        select
          evidence.*,
          review.rejection_reason
        from referenced_evidence evidence
        left join lateral (
          select timeline.metadata ->> 'reason' as rejection_reason
          from timeline_events timeline
          where timeline.case_id = evidence.case_id
            and timeline.event_type = 'document_reviewed'
            and timeline.metadata ->> 'documentId' = evidence.document_id::text
          order by timeline.created_at desc, timeline.id desc
          limit 1
        ) review on true
        order by evidence.uploaded_at asc, evidence.document_id asc
      `;
      const deliveries = await sql<DeliveryRow[]>`
        select idempotency_key, status
        from notification_outbox
        where idempotency_key like 'follow-up:%'
          and payload ->> 'caseId' = any(${caseIds}::text[])
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
        })),
      };
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
