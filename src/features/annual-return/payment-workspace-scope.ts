import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import { creditedPaymentEvidenceSql } from "./payment-evidence-state";
type Query = SqlClient | postgres.TransactionSql;
export function paymentCreditSql(sql: Query) {
  return sql`select coalesce(sum(e.amount),0) from payment_evidence_entries e join documents d on d.id=e.document_id join document_versions v on v.id=e.proof_version_id join document_upload_intents i on i.id=v.intent_id where e.payment_id=p.id and ${creditedPaymentEvidenceSql(sql)}`;
}
export function paymentWorkspaceCaseSql(sql: Query, context: string | undefined) {
  if (context === "payment_review_cases")
    return sql`exists(select 1 from documents proof where proof.case_id=arc.id and proof.company_id=arc.company_id and proof.file_type='payment') and exists(select 1 from payments p where p.case_id=arc.id and p.company_id=arc.company_id)`;
  if (context === "payment_outstanding_cases")
    return sql`exists(select 1 from payments p where p.case_id=arc.id and p.company_id=arc.company_id and p.amount>(${paymentCreditSql(sql)}))`;
  return sql`true`;
}
