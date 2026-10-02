import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
type Query = SqlClient | postgres.TransactionSql;
export type PaymentProofReturn = {
  id: string;
  paymentId: string;
  documentId: string;
  proofVersionId: string;
  reasonCode: string;
  reasonText: string;
  reviewedBy: string;
  reviewedAt: string;
};
/** A payment return is an attributed business decision; it never invents receipt values. */
export function paymentProofReturnQuery(
  sql: Query,
  documentId: string | postgres.Fragment,
  proofVersionId: string | postgres.Fragment,
) {
  return sql`select rp.id payment_id,ra.metadata->>'reasonText' reason_text
    from annual_return_audit_events ra
    join payments rp on rp.id::text=ra.metadata->>'paymentId' and rp.case_id=ra.case_id and rp.company_id=ra.company_id
    join documents rd on rd.id::text=ra.metadata->>'documentId' and rd.case_id=rp.case_id and rd.company_id=rp.company_id and rd.file_type='payment'
    join document_versions rv on rv.id::text=ra.metadata->>'proofVersionId' and rv.document_id=rd.id
    where rd.id=${documentId} and rv.id=${proofVersionId} and ra.actor_id is not null and ra.result='succeeded' and ra.action='update_payment'
      and ra.metadata->>'command'='review' and ra.metadata->>'decision'='rejected'
      and ra.metadata->>'reasonCode' in ('unreadable','amount_mismatch','date_mismatch','duplicate_proof','wrong_account','other')
      and length(btrim(ra.metadata->>'reasonText'))>0 order by ra.created_at desc,ra.id desc limit 1`;
}
export async function paymentProofWasReturned(
  sql: Query,
  documentId: string,
  proofVersionId: string,
) {
  const [row] = await sql<
    { returned: boolean }[]
  >`select exists(${paymentProofReturnQuery(sql, documentId, proofVersionId)}) returned`;
  return row?.returned === true;
}
export type PaymentEvidenceEntry = {
  id: string;
  paymentId: string;
  documentId: string;
  proofVersionId: string;
  amount: number;
  receivedOn: string;
  reference: string | null;
  status: "pending" | "verified" | "rejected";
  reasonCode: string | null;
  reasonText: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};
/** Credit requires the exact reviewed bytes to remain current and genuinely scanned. */
export function creditedPaymentEvidenceSql(sql: Query) {
  return sql`
  e.status='verified' and e.reviewed_by is not null and e.reviewed_at is not null
  and e.case_id=p.case_id and d.company_id=p.company_id and d.case_id=p.case_id
  and d.verification_status='verified' and d.verified_by is not null and d.verified_at>=v.created_at
  and d.reviewed_document_version_id=v.id and i.scan_document_version_id=v.id
  and v.document_id=e.document_id and v.superseded_by_version_id is null
  and v.verified_checksum_sha256=e.proof_sha256 and v.declared_checksum_sha256=e.proof_sha256 and v.verified_byte_size>0
  and i.document_id=d.id and i.company_id=d.company_id and i.case_id=d.case_id
  and i.status='available' and i.scan_verdict_source='provider' and i.object_key=v.storage_url and d.storage_url=v.storage_url
  and i.checksum_sha256=e.proof_sha256 and i.expected_size_bytes=v.verified_byte_size`;
}
export async function verifiedPaymentCredit(sql: Query, paymentId: string) {
  const rows = await sql<
    { received_amount: string; last_received_on: string | null; proof_document_ids: string[] }[]
  >`
  select coalesce(sum(e.amount),0)::text received_amount,max(e.received_on)::text last_received_on,
    coalesce(array_agg(e.document_id order by e.received_on,e.recorded_at,e.id) filter(where e.id is not null),'{}'::uuid[]) proof_document_ids
  from payments p join payment_evidence_entries e on e.payment_id=p.id
  join documents d on d.id=e.document_id join document_versions v on v.id=e.proof_version_id
  join document_upload_intents i on i.id=v.intent_id
  where p.id=${paymentId} and ${creditedPaymentEvidenceSql(sql)}`;
  return {
    receivedAmount: Number(rows[0]?.received_amount ?? 0),
    lastReceivedOn: rows[0]?.last_received_on ?? null,
    proofDocumentIds: rows[0]?.proof_document_ids ?? [],
  };
}
