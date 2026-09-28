import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  reconcilePaymentForActor,
  type ReconcilePaymentInput,
  type PaymentReconciliationResult,
} from "@/features/payments/reconciliation";
import type { SqlClient } from "@/server/db/client";
import type { DomainItemResult } from "./domain-types";

export type PaymentBatchItem = ReconcilePaymentInput;
type ReconcilePayment = (
  actor: AuthenticatedActor,
  input: PaymentBatchItem,
) => Promise<PaymentReconciliationResult>;

/** The single-item service owns proof safety, actor scope, allocation and revision. */
export async function applyPaymentItem(
  actor: AuthenticatedActor,
  item: PaymentBatchItem,
  dependencies: {
    reconcilePayment?: ReconcilePayment;
    sql?: SqlClient | postgres.TransactionSql;
  } = {},
): Promise<DomainItemResult> {
  const service =
    dependencies.reconcilePayment ??
    ((currentActor, currentItem) =>
      reconcilePaymentForActor(currentActor, currentItem, dependencies.sql));
  const result = await service(actor, item);
  if (!result.auditEventId) throw new Error("Payment reconciliation audit is missing.");
  return {
    state: result.status === "exception" ? "conflict" : "succeeded",
    reasonCode: result.reasonCode,
    revision: result.revision,
    auditRef: result.auditEventId,
  };
}
