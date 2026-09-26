import { daysBetween, hasRequiredChecklistEvidence } from "./workflow";
import type { AnnualReturnCase } from "./types";

export type OperationalMetrics = {
  activeCases: number;
  overdueCases: number;
  missingEvidenceCases: number;
  missingEvidenceItems: number;
  paymentPendingCases: number;
  assignedToMe: number;
  scopeLabel: string;
  asOf: string;
};

/** Domain oracle for repository SQL aggregates and stable metric meaning. */
export function summarizeOperationalCases(
  cases: readonly AnnualReturnCase[],
  asOf: string,
  currentUserId: string | null,
  scopeLabel = "可見案件",
): OperationalMetrics {
  const result: OperationalMetrics = {
    activeCases: 0,
    overdueCases: 0,
    missingEvidenceCases: 0,
    missingEvidenceItems: 0,
    paymentPendingCases: 0,
    assignedToMe: 0,
    scopeLabel,
    asOf,
  };

  for (const case_ of cases) {
    if (case_.currentStatus === "Filed" || case_.currentStatus === "Completed") continue;
    result.activeCases += 1;
    if (daysBetween(asOf, case_.filingDueDate) < 0) result.overdueCases += 1;
    const missing = case_.checklist.filter(
      (item) => item.required && !hasRequiredChecklistEvidence(item),
    ).length;
    if (missing > 0) result.missingEvidenceCases += 1;
    result.missingEvidenceItems += missing;
    if (case_.payment?.status !== "Payment received" || !case_.payment.paymentProofDocumentId)
      result.paymentPendingCases += 1;
    if (currentUserId && case_.ownerId === currentUserId) result.assignedToMe += 1;
  }

  return result;
}
