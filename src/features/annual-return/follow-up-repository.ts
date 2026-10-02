import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { DocumentCategory } from "@/features/documents/types";
import type { NotificationStatus } from "@/features/notifications/types";
import { paymentProofReturnQuery } from "./payment-evidence-state";
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
  document_version_id: string;
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
      const evidence = await sql<EvidenceRow[]>`
        with referenced_evidence as (
          select distinct
            d.id as document_id,
            v.id as document_version_id,
            d.case_id,
            d.company_id,
            'document-review'::text as source,
            d.file_type as category,
            d.file_name,
            d.verification_status as review_status,
            d.uploaded_at,
            null::text business_rejection_reason
          from documents d
          join annual_return_checklist_items checklist
            on checklist.document_id = d.id
            and checklist.case_id = d.case_id
          join document_versions v on v.document_id=d.id and v.superseded_by_version_id is null
          join document_upload_intents intent on intent.id=v.intent_id and intent.document_id=d.id
          where d.case_id = any(${caseIds}::uuid[])
            and intent.status = 'available'
            and intent.scan_verdict_source='provider' and intent.scan_document_version_id=v.id
            and (d.verification_status<>'rejected' or d.reviewed_document_version_id=v.id)

          union

          select distinct
            d.id as document_id,
            v.id as document_version_id,
            d.case_id,
            d.company_id,
            'payment-proof-review'::text as source,
            d.file_type as category,
            d.file_name,
            case when proof_return.reason_text is not null then 'rejected' else d.verification_status end as review_status,
            d.uploaded_at,
            proof_return.reason_text business_rejection_reason
          from documents d
          join payments payment
            on payment.case_id = d.case_id and payment.company_id=d.company_id
          join document_versions v on v.document_id=d.id and v.superseded_by_version_id is null
          join document_upload_intents intent on intent.id=v.intent_id and intent.document_id=d.id
          left join lateral (${paymentProofReturnQuery(sql, sql`d.id`, sql`v.id`)}) proof_return on true
          where d.case_id = any(${caseIds}::uuid[])
            and (payment.payment_proof_document_id=d.id or proof_return.payment_id=payment.id)
            and intent.status = 'available'
            and intent.scan_verdict_source='provider' and intent.scan_document_version_id=v.id
            and (d.verification_status<>'rejected' or d.reviewed_document_version_id=v.id)
        )
        select
          evidence.*,
          coalesce(evidence.business_rejection_reason,review.rejection_reason) rejection_reason
        from referenced_evidence evidence
        left join lateral (
          select timeline.metadata ->> 'reason' as rejection_reason
          from timeline_events timeline
          where timeline.case_id = evidence.case_id
            and timeline.event_type = 'document_reviewed'
            and timeline.metadata ->> 'documentId' = evidence.document_id::text
            and timeline.metadata ->> 'documentVersionId' = evidence.document_version_id::text
          order by timeline.created_at desc, timeline.id desc
          limit 1
        ) review on true
        order by evidence.uploaded_at asc, evidence.document_id asc
      `;
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
