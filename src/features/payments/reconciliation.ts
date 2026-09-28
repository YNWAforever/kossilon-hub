import type postgres from "postgres";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
import { entityIdSchema } from "@/features/runtime/entity-id";
import { getSqlClient, type SqlClient } from "@/server/db/client";

/** A human-confirmed allocation against the existing canonical payment row. */
export type PaymentMatchInput = {
  observation: { companyId: string; caseId: string };
  invoice: {
    companyId: string;
    caseId: string;
    invoiceRef: string;
    amountMinor: number;
    currency: string;
  };
  proof: {
    companyId: string;
    caseId: string | null;
    verifiedScan: boolean;
    reviewed: boolean;
  } | null;
  confirmation: { invoiceRef: string; amountMinor: number; currency: string } | null;
  duplicateInvoiceRef: boolean;
  proofAlreadyAllocated: boolean;
  paymentAlreadyAllocated: boolean;
};

export type PaymentMatchResult =
  | { kind: "pending"; reasonCode: "proof-missing" | "confirmation-missing" | "proof-unverified" }
  | {
      kind: "exception";
      reasonCode:
        | "observation-scope-mismatch"
        | "proof-scope-mismatch"
        | "duplicate-invoice-reference"
        | "proof-already-allocated"
        | "payment-already-allocated"
        | "invoice-reference-mismatch"
        | "currency-mismatch"
        | "invalid-amount"
        | "partial-payment"
        | "overpayment";
    }
  | { kind: "matched" };

/**
 * No fuzzy names, inferred money or conversion. All amounts are integer minor
 * units confirmed by a reviewer; a workbook date supplies neither amount nor
 * proof. Canonical `payments` remains the only source of invoice/payment state.
 */
export function classifyPaymentMatch(input: PaymentMatchInput): PaymentMatchResult {
  if (
    input.observation.companyId !== input.invoice.companyId ||
    input.observation.caseId !== input.invoice.caseId
  ) {
    return { kind: "exception", reasonCode: "observation-scope-mismatch" };
  }
  if (!input.proof) return { kind: "pending", reasonCode: "proof-missing" };
  if (
    input.proof.companyId !== input.observation.companyId ||
    input.proof.caseId !== input.observation.caseId
  ) {
    return { kind: "exception", reasonCode: "proof-scope-mismatch" };
  }
  if (!input.proof.verifiedScan || !input.proof.reviewed) {
    return { kind: "pending", reasonCode: "proof-unverified" };
  }
  if (!input.confirmation) return { kind: "pending", reasonCode: "confirmation-missing" };
  if (input.duplicateInvoiceRef) {
    return { kind: "exception", reasonCode: "duplicate-invoice-reference" };
  }
  if (input.proofAlreadyAllocated) {
    return { kind: "exception", reasonCode: "proof-already-allocated" };
  }
  if (input.paymentAlreadyAllocated) {
    return { kind: "exception", reasonCode: "payment-already-allocated" };
  }
  if (input.confirmation.invoiceRef.trim() !== input.invoice.invoiceRef) {
    return { kind: "exception", reasonCode: "invoice-reference-mismatch" };
  }
  if (input.confirmation.currency !== input.invoice.currency) {
    return { kind: "exception", reasonCode: "currency-mismatch" };
  }
  if (
    !Number.isSafeInteger(input.confirmation.amountMinor) ||
    input.confirmation.amountMinor <= 0 ||
    !Number.isSafeInteger(input.invoice.amountMinor) ||
    input.invoice.amountMinor <= 0
  ) {
    return { kind: "exception", reasonCode: "invalid-amount" };
  }
  if (input.confirmation.amountMinor < input.invoice.amountMinor) {
    return { kind: "exception", reasonCode: "partial-payment" };
  }
  if (input.confirmation.amountMinor > input.invoice.amountMinor) {
    return { kind: "exception", reasonCode: "overpayment" };
  }
  return { kind: "matched" };
}

type QueryClient = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

type ObservationRow = {
  id: string;
  source_row_id: string;
  company_id: string;
  case_id: string;
  observed_date: string | Date;
  status: "pending_review" | "matched" | "rejected" | "exception";
  revision: number;
  invoice_ref: string | null;
  amount_minor: string | number | null;
  currency: string | null;
  proof_version_id: string | null;
  decision_reason: string | null;
};
type PaymentRow = {
  id: string;
  company_id: string;
  case_id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: string;
  payment_proof_document_id: string | null;
};
type ProofRow = {
  id: string;
  document_id: string;
  company_id: string;
  case_id: string | null;
  file_type: string;
  verification_status: string;
  upload_status: string;
  scan_verdict_source: string | null;
  checksum_sha256: string;
  expected_size_bytes: number;
  verified_checksum_sha256: string | null;
  verified_byte_size: number | null;
};

export type PaymentObservation = {
  id: string;
  companyId: string;
  caseId: string;
  invoiceRef: string | null;
  amountMinor: number | null;
  currency: string | null;
  receivedOn: string;
  sourceRowId: string;
  proofVersionId: string | null;
  decisionReason: string | null;
  revision: number;
  status: ObservationRow["status"];
};

export type ReconcilePaymentInput = {
  observationId: string;
  caseId: string;
  proofVersionId?: string;
  expectedRevision: number;
  decision: "match" | "reject";
  reason?: string;
  confirmation?: { invoiceRef: string; amountMinor: number; currency: string };
};

export type PaymentReconciliationResult = {
  observationId: string;
  status: ObservationRow["status"];
  revision: number;
  paymentStatus: string;
  auditEventId: string | null;
  reasonCode: string | null;
};

function staffId(actor: AuthenticatedActor): string {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("Forbidden: a staff database identity is required.");
  return staff.userId;
}

function mapObservation(row: ObservationRow): PaymentObservation {
  return {
    id: row.id,
    companyId: row.company_id,
    caseId: row.case_id,
    invoiceRef: row.invoice_ref,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    currency: row.currency,
    receivedOn: new Date(row.observed_date).toISOString().slice(0, 10),
    sourceRowId: row.source_row_id,
    proofVersionId: row.proof_version_id,
    decisionReason: row.decision_reason,
    revision: row.revision,
    status: row.status,
  };
}

async function authorizedCase(
  tx: QueryClient,
  actor: AuthenticatedActor,
  caseId: string,
): Promise<void> {
  const repository = createAnnualReturnRepository({ sql: tx });
  try {
    await repository.assertCanMutateCase(caseId, staffId(actor), "update_payment");
  } finally {
    await repository.close();
  }
}

export async function listPaymentObservationsForActor(
  actor: AuthenticatedActor,
  caseId: string,
  sql: QueryClient = getSqlClient(),
): Promise<PaymentObservation[]> {
  entityIdSchema.parse(caseId);
  await authorizedCase(sql, actor, caseId);
  const rows = await sql<ObservationRow[]>`
    select * from nar_import_payment_observations
    where case_id = ${caseId}
    order by created_at desc, id desc limit 100`;
  return rows.map(mapObservation);
}

/**
 * One actor-scoped reconciliation. A bulk caller must call this service for
 * each item, preserving the same revision, allocation and permission checks.
 * Every decision and its canonical payment mutation share one transaction.
 */
export async function reconcilePaymentForActor(
  actor: AuthenticatedActor,
  input: ReconcilePaymentInput,
  sql: QueryClient = getSqlClient(),
): Promise<PaymentReconciliationResult> {
  entityIdSchema.parse(input.observationId);
  entityIdSchema.parse(input.caseId);
  if (input.proofVersionId) entityIdSchema.parse(input.proofVersionId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("Expected observation revision must be a positive integer.");
  }
  if (input.decision !== "match" && input.decision !== "reject") {
    throw new Error("Invalid payment reconciliation decision.");
  }
  if (input.reason && input.reason.length > 500) throw new Error("Reason is too long.");
  const actorId = staffId(actor);
  const run = async (tx: Tx): Promise<PaymentReconciliationResult> => {
    const observations = await tx<ObservationRow[]>`
      select * from nar_import_payment_observations
      where id = ${input.observationId} for update`;
    const observation = observations[0];
    if (!observation || observation.case_id !== input.caseId) {
      throw new Error("Payment observation not found for this case.");
    }
    if (observation.revision !== input.expectedRevision) {
      throw new Error("Payment observation revision changed; reload before reconciliation.");
    }
    if (observation.status === "matched" || observation.status === "rejected") {
      throw new Error("Payment observation has already been decided.");
    }
    await authorizedCase(tx, actor, input.caseId);
    // Serializes matched invoice-reference checks across cases of one company.
    await tx`select id from companies where id = ${observation.company_id} for update`;
    const payments = await tx<PaymentRow[]>`
      select id,company_id,case_id,invoice_number,amount,currency,status,payment_proof_document_id
      from payments where case_id = ${input.caseId} for update`;
    const payment = payments[0];
    if (!payment || payment.company_id !== observation.company_id) {
      throw new Error("Canonical payment does not belong to the observation.");
    }
    const before = {
      observation: mapObservation(observation),
      paymentStatus: payment.status,
      paymentProofDocumentId: payment.payment_proof_document_id,
    };
    let result: PaymentMatchResult | { kind: "rejected" };
    let proof: ProofRow | undefined;
    if (input.decision === "reject") {
      if (!input.reason?.trim()) throw new Error("Rejecting an observation requires a reason.");
      result = { kind: "rejected" };
    } else {
      if (!input.proofVersionId || !input.confirmation) {
        throw new Error(
          "Matching requires a proof version and explicit invoice, amount and currency.",
        );
      }
      if (
        !Number.isSafeInteger(input.confirmation.amountMinor) ||
        input.confirmation.amountMinor <= 0 ||
        !/^[A-Z]{3}$/.test(input.confirmation.currency) ||
        !input.confirmation.invoiceRef.trim()
      ) {
        throw new Error("Invalid confirmed payment details.");
      }
      const proofs = await tx<ProofRow[]>`
        select v.id,v.document_id,d.company_id,d.case_id,d.file_type,d.verification_status,
          i.status upload_status,i.scan_verdict_source,i.checksum_sha256,i.expected_size_bytes,
          v.verified_checksum_sha256,v.verified_byte_size
        from document_versions v
        join documents d on d.id = v.document_id
        join document_upload_intents i on i.id = v.intent_id
        where v.id = ${input.proofVersionId}
          and v.superseded_by_version_id is null for update of v`;
      proof = proofs[0];
      const duplicates = await tx<
        { invoice_used: boolean; proof_used: boolean; payment_used: boolean }[]
      >`
        select
          exists(select 1 from nar_import_payment_observations o
            where o.company_id = ${observation.company_id}
              and o.id <> ${observation.id}
              and o.status = 'matched'
              and o.invoice_ref = ${input.confirmation.invoiceRef.trim()}) invoice_used,
          exists(select 1 from payment_proof_allocations a
            where a.proof_version_id = ${input.proofVersionId}) proof_used,
          exists(select 1 from payment_proof_allocations a
            where a.payment_id = ${payment.id}) payment_used`;
      const canonicalAmountMinor = Number(payment.amount) * 100;
      result = classifyPaymentMatch({
        observation: { companyId: observation.company_id, caseId: observation.case_id },
        invoice: {
          companyId: payment.company_id,
          caseId: payment.case_id,
          invoiceRef: payment.invoice_number,
          amountMinor: canonicalAmountMinor,
          currency: payment.currency,
        },
        proof: proof
          ? {
              companyId: proof.company_id,
              caseId: proof.case_id,
              verifiedScan:
                proof.upload_status === "available" &&
                proof.scan_verdict_source === "provider" &&
                proof.verified_checksum_sha256 === proof.checksum_sha256 &&
                Number(proof.verified_byte_size) === Number(proof.expected_size_bytes) &&
                proof.file_type === "payment",
              reviewed: proof.verification_status === "verified",
            }
          : null,
        confirmation: input.confirmation,
        duplicateInvoiceRef: duplicates[0]?.invoice_used ?? false,
        proofAlreadyAllocated: duplicates[0]?.proof_used ?? false,
        paymentAlreadyAllocated: duplicates[0]?.payment_used ?? false,
      });
      if (result.kind === "pending") {
        throw new Error(`Payment proof is not ready: ${result.reasonCode}.`);
      }
    }
    const nextStatus =
      result.kind === "matched" ? "matched" : result.kind === "rejected" ? "rejected" : "exception";
    const reasonCode = result.kind === "exception" ? result.reasonCode : null;
    const decisionReason = reasonCode
      ? [reasonCode, input.reason?.trim()].filter(Boolean).join(": ")
      : input.reason?.trim() || null;
    const confirmed = input.confirmation;
    const updated = await tx<ObservationRow[]>`
      update nar_import_payment_observations
      set status = ${nextStatus}, revision = revision + 1,
        invoice_ref = ${confirmed?.invoiceRef.trim() ?? null},
        amount_minor = ${confirmed?.amountMinor ?? null},
        currency = ${confirmed?.currency ?? null},
        proof_version_id = ${proof?.id ?? null},
        reviewed_by = ${actorId}, reviewed_at = now(),
        decision_reason = ${decisionReason}
      where id = ${observation.id} and revision = ${input.expectedRevision}
      returning *`;
    if (updated.length !== 1) throw new Error("Payment observation revision changed.");
    let paymentStatus = payment.status;
    if (result.kind === "matched") {
      if (!proof || !confirmed) throw new Error("Matched payment lost proof or confirmation.");
      await tx`insert into payment_proof_allocations
        (observation_id,payment_id,proof_version_id,amount_minor,currency,invoice_ref,created_by)
        values (${observation.id},${payment.id},${proof.id},${confirmed.amountMinor},
          ${confirmed.currency},${confirmed.invoiceRef.trim()},${actorId})`;
      const repository = createAnnualReturnRepository({ sql: tx });
      try {
        const caseItem = await repository.updatePayment({
          caseId: input.caseId,
          status: "Payment received",
          paymentProofDocumentId: proof.document_id,
          actorId,
        });
        paymentStatus = caseItem.payment?.status ?? payment.status;
      } finally {
        await repository.close();
      }
    }
    const after = {
      observation: mapObservation(updated[0]),
      paymentStatus,
      paymentProofDocumentId:
        result.kind === "matched" ? proof?.document_id : payment.payment_proof_document_id,
      reasonCode,
    };
    const events = await tx<{ id: string }[]>`
      insert into payment_reconciliation_events
        (observation_id,payment_id,proof_version_id,actor_id,decision,result,
          observation_revision,reason,before_values,after_values)
      values (${observation.id},${payment.id},${proof?.id ?? null},${actorId},
        ${input.decision},${nextStatus},${input.expectedRevision},
        ${decisionReason},${tx.json(before)},${tx.json(after)})
      returning id`;
    return {
      observationId: observation.id,
      status: nextStatus,
      revision: updated[0].revision,
      paymentStatus,
      auditEventId: events[0]?.id ?? null,
      reasonCode,
    };
  };
  return "begin" in sql ? (sql.begin(run) as Promise<PaymentReconciliationResult>) : run(sql);
}
