import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { DocumentCategory } from "@/features/documents/types";
import type { PersistedFollowUpEvidence } from "./follow-ups";
import { paymentProofReturnQuery } from "./payment-evidence-state";
type Query = SqlClient | postgres.TransactionSql;
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

export function followUpEvidenceQuery(sql: Query, caseIds: string[] | null) {
  return sql<EvidenceRow[]>`
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
          where (${caseIds}::uuid[] is null or d.case_id = any(${caseIds}::uuid[]))
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
          where (${caseIds}::uuid[] is null or d.case_id = any(${caseIds}::uuid[]))
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
}
/** Shared draft-case membership for the list, count, snapshot and preview. */
export function whatsappDraftCasesSql(sql: Query) {
  return sql`c.data_origin='client' and arc.current_status not in ('Filed','Completed')
    and arc.locked_at is null and arc.completed_at is null
    and (not exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id)
      or exists(select 1 from annual_return_checklist_items i where i.case_id=arc.id and i.required and i.status in ('Missing','Rejected'))
      or exists(select 1 from (${followUpEvidenceQuery(sql, null)}) draft
        where draft.case_id=arc.id and draft.company_id=arc.company_id and draft.review_status='rejected'))`;
}
