import type postgres from "postgres";
import { z } from "zod";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { createDocumentRepository } from "@/features/documents/repository";
import { canApproveDocument, documentSafetyOf } from "@/features/documents/safety";
import { createAnnualReturnRepository } from "./repository";
import { ReadinessConflictError } from "./readiness";
import { verifiedPaymentCredit, paymentProofWasReturned } from "./payment-evidence-state";

import {
  recordPaymentEvidenceSchema,
  paymentReviewSchema,
  type PaymentReviewInput,
} from "./payment-review-input";
type Query = SqlClient | postgres.TransactionSql;
type Base = z.infer<typeof recordPaymentEvidenceSchema> | PaymentReviewInput;
export function createPaymentEvidenceService({ sql = getSqlClient() }: { sql?: Query } = {}) {
  async function execute(input: Base & { actorId: string }, decision: "record" | "review") {
    const parsed =
      decision === "record"
        ? recordPaymentEvidenceSchema.parse(inputWithoutActor(input))
        : paymentReviewSchema.parse(inputWithoutActor(input));
    const run = async (tx: postgres.TransactionSql) => {
      const annualReturns = createAnnualReturnRepository({ sql: tx }),
        documents = createDocumentRepository({ sql: tx });
      await annualReturns.assertCanMutateCase(parsed.caseId, input.actorId, "update_payment");
      const [payment] = await tx<
        { id: string; amount: number }[]
      >`select id,amount from payments where id=${parsed.paymentId} and case_id=${parsed.caseId} for update`;
      if (!payment) throw new Error("Payment not found in case.");
      await tx`select id from documents where id=${parsed.documentId} for update`;
      await tx`select i.id from document_upload_intents i join document_versions v on v.intent_id=i.id where v.document_id=${parsed.documentId} order by i.id for update of i`;
      await tx`select id from document_versions where document_id=${parsed.documentId} order by id for update`;
      const current = await annualReturns.getCase(parsed.caseId);
      if (current?.readiness?.sourceVersion !== parsed.expectedVersion)
        throw new ReadinessConflictError();
      const document = await documents.getDocument(parsed.documentId);
      const [version] = await tx<
        { id: string; checksum: string | null; declared: string | null; size: number | null }[]
      >`select id,verified_checksum_sha256 checksum,declared_checksum_sha256 declared,verified_byte_size size from document_versions where document_id=${parsed.documentId} and superseded_by_version_id is null`;
      if (!version || version.id !== parsed.proofVersionId) throw new ReadinessConflictError();
      if (
        !document ||
        document.category !== "payment" ||
        document.companyId !== current.companyId ||
        document.caseId !== parsed.caseId ||
        !canApproveDocument(documentSafetyOf(document)) ||
        !version.checksum ||
        version.checksum !== version.declared ||
        !version.size
      )
        throw new Error("Payment proof needs current same-case bytes and genuine scan evidence.");
      if (await paymentProofWasReturned(tx, document.id, version.id))
        throw new ReadinessConflictError();
      if (decision === "record") {
        const data = parsed as z.infer<typeof recordPaymentEvidenceSchema>;
        const existing =
          await tx`select id from payment_evidence_entries where proof_version_id=${version.id} or (proof_sha256=${version.checksum} and status in ('pending','verified'))`;
        if (existing.length)
          throw new Error("Duplicate payment proof cannot create additional credit.");
        try {
          await tx`insert into payment_evidence_entries(payment_id,case_id,document_id,proof_version_id,proof_sha256,amount,received_on,reference,recorded_by) values(${payment.id},${parsed.caseId},${document.id},${version.id},${version.checksum},${data.amount},${data.receivedOn},${data.reference ?? null},${input.actorId})`;
        } catch (error) {
          if ((error as { code?: string }).code === "23505")
            throw new Error("Duplicate payment proof cannot create additional credit.");
          throw error;
        }
      } else {
        const data = parsed as PaymentReviewInput;
        const [entry] = await tx<
          { id: string; status: string }[]
        >`select id,status from payment_evidence_entries where payment_id=${payment.id} and case_id=${parsed.caseId} and document_id=${document.id} and proof_version_id=${version.id} for update`;
        if ((entry && entry.status !== "pending") || (!entry && data.decision !== "rejected"))
          throw new ReadinessConflictError();
        if (document.reviewStatus === "pending")
          await documents.reviewDocument({
            documentId: document.id,
            expectedVersionId: version.id,
            reviewerId: input.actorId,
            decision: data.decision,
            reason: data.reasonText,
          });
        else if (document.reviewStatus !== "verified")
          throw new Error("Returned proof requires an additive replacement before review.");
        if (entry)
          await tx`update payment_evidence_entries set status=${data.decision},reviewed_by=${input.actorId},reviewed_at=now(),reason_code=${data.reasonCode ?? null},reason_text=${data.reasonText ?? null} where id=${entry.id}`;
        const credit = await verifiedPaymentCredit(tx, payment.id);
        await annualReturns.updatePayment({
          caseId: parsed.caseId,
          status:
            credit.receivedAmount >= Number(payment.amount)
              ? "Payment received"
              : "Payment pending",
          paymentProofDocumentId:
            credit.receivedAmount >= Number(payment.amount)
              ? (credit.proofDocumentIds.at(-1) ?? null)
              : null,
          actorId: input.actorId,
        });
      }
      const [actor] = await tx<
        { role: "Admin" | "Manager" | "Staff" }[]
      >`select role from users where id=${input.actorId}`;
      const metadata = {
        paymentId: payment.id,
        documentId: document.id,
        proofVersionId: version.id,
        command: decision,
        ...(decision === "review"
          ? {
              decision: (parsed as PaymentReviewInput).decision,
              reasonCode: (parsed as PaymentReviewInput).reasonCode ?? null,
              reasonText: (parsed as PaymentReviewInput).reasonText ?? null,
            }
          : {
              amount: (parsed as z.infer<typeof recordPaymentEvidenceSchema>).amount,
              receivedOn: (parsed as z.infer<typeof recordPaymentEvidenceSchema>).receivedOn,
            }),
      };
      await tx`insert into annual_return_audit_events(case_id,company_id,actor_id,actor_role,action,result,summary,metadata) values(${parsed.caseId},${current.companyId},${input.actorId},${actor.role},'update_payment','succeeded',${`Payment evidence ${decision}.`},${tx.json(metadata)})`;
      await tx`insert into timeline_events(company_id,case_id,event_type,actor_type,actor_id,description,metadata) values(${current.companyId},${parsed.caseId},'payment_evidence_review','user',${input.actorId},${`Payment evidence ${decision}.`},${tx.json(metadata)})`;
      return (await annualReturns.getCase(parsed.caseId))!;
    };
    return "begin" in sql ? sql.begin(run) : run(sql);
  }
  return {
    record: (input: z.infer<typeof recordPaymentEvidenceSchema> & { actorId: string }) =>
      execute(input, "record"),
    review: (input: PaymentReviewInput & { actorId: string }) => execute(input, "review"),
  };
}
function inputWithoutActor(input: Base & { actorId: string }) {
  const { actorId: _actor, ...rest } = input;
  return rest;
}
