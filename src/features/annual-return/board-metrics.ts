import type { AnnualReturnCase } from "./types";
import { daysBetween, hasRequiredChecklistEvidence } from "./workflow";

/**
 * No "assigned to me" tile. The board is already scoped to the actor, and the
 * client holds an auth user id rather than the staff uuid that `ownerId` carries,
 * so the count could not be derived here honestly.
 */
export type AnnualReturnBoardMetrics = {
  dueIn7: number;
  dueIn30: number;
  overdue: number;
  highRisk: number;
  missingDocuments: number;
  paymentPending: number;
};

/**
 * Filed and Completed cases are finished work and are excluded from every tile —
 * matching repository.dashboardMetrics, and necessary because riskForCase returns
 * "red" for a filed case past its due date whenever completionBlockers is
 * non-empty. Counting those as overdue would report finished work as outstanding.
 */
function isOpen(case_: AnnualReturnCase): boolean {
  return case_.currentStatus !== "Filed" && case_.currentStatus !== "Completed";
}

function isMissingRequiredEvidence(case_: AnnualReturnCase): boolean {
  return case_.checklist.some((item) => item.required && !hasRequiredChecklistEvidence(item));
}

export function boardMetrics(
  cases: readonly AnnualReturnCase[],
  today: string,
): AnnualReturnBoardMetrics {
  const metrics: AnnualReturnBoardMetrics = {
    dueIn7: 0,
    dueIn30: 0,
    overdue: 0,
    highRisk: 0,
    missingDocuments: 0,
    paymentPending: 0,
  };

  for (const case_ of cases) {
    if (!isOpen(case_)) continue;

    const daysRemaining = daysBetween(today, case_.filingDueDate);

    if (daysRemaining < 0) metrics.overdue += 1;
    if (daysRemaining >= 0 && daysRemaining <= 7) metrics.dueIn7 += 1;
    if (daysRemaining >= 0 && daysRemaining <= 30) metrics.dueIn30 += 1;
    if (case_.riskLevel === "red" || case_.riskLevel === "orange") metrics.highRisk += 1;
    if (isMissingRequiredEvidence(case_)) metrics.missingDocuments += 1;
    if (case_.payment?.status === "Payment pending" || case_.payment?.status === "Overdue") {
      metrics.paymentPending += 1;
    }
  }

  return metrics;
}
