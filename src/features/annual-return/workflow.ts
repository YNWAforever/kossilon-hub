import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnChecklistItem,
  type AnnualReturnStatus,
  type CompletionBlocker,
  type RiskLevel,
} from "./types";

export { ANNUAL_RETURN_STATUSES };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(date: string): Date {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRequiredChecklistEvidence(item: AnnualReturnChecklistItem): boolean {
  return (
    item.status === "Verified" &&
    hasText(item.receivedAt) &&
    hasText(item.verifiedAt) &&
    hasText(item.documentId)
  );
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
}

export function calculateFilingDueDate(annualReturnBasisDate: string): string {
  const due = parseDateOnly(annualReturnBasisDate);
  due.setUTCDate(due.getUTCDate() + 42);
  return formatDateOnly(due);
}

export function shouldGenerateCase(filingDueDate: string, today: string): boolean {
  return daysBetween(today, filingDueDate) <= 90;
}

export function riskForCase(case_: AnnualReturnCase, today: string): RiskLevel {
  const daysLeft = daysBetween(today, case_.filingDueDate);
  const isFiledOrCompleted = case_.currentStatus === "Filed" || case_.currentStatus === "Completed";

  if (isFiledOrCompleted && completionBlockers(case_).length === 0) {
    return "green";
  }

  const missingRequired = case_.checklist.some(
    (item) => item.required && !hasRequiredChecklistEvidence(item),
  );
  const paymentIncomplete = case_.payment?.status !== "Payment received";
  const filingIncomplete =
    !hasText(case_.filingReference) || !hasText(case_.confirmationDocumentId);

  if (daysLeft < 0) return "red";
  if (daysLeft <= 7 && (missingRequired || paymentIncomplete || filingIncomplete)) return "red";
  if (daysLeft <= 14 && missingRequired) return "orange";
  if (daysLeft <= 30 && (missingRequired || paymentIncomplete)) return "yellow";
  return "green";
}

export function isAllowedStatusTransition(
  from: AnnualReturnStatus,
  to: AnnualReturnStatus,
): boolean {
  const fromIndex = ANNUAL_RETURN_STATUSES.indexOf(from);
  const toIndex = ANNUAL_RETURN_STATUSES.indexOf(to);
  return toIndex === fromIndex + 1;
}

export function completionBlockers(case_: AnnualReturnCase): CompletionBlocker[] {
  const blockers: CompletionBlocker[] = [];
  const unverifiedRequired = case_.checklist.filter(
    (item) => item.required && !hasRequiredChecklistEvidence(item),
  );

  if (unverifiedRequired.length > 0) {
    blockers.push({
      code: "required_checklist_unverified",
      message: `${unverifiedRequired.length} required checklist item${
        unverifiedRequired.length === 1 ? " is" : "s are"
      } not verified.`,
    });
  }

  if (case_.payment?.status !== "Payment received") {
    blockers.push({
      code: "payment_not_received",
      message: "Payment must be marked as received.",
    });
  }

  if (!hasText(case_.filingReference)) {
    blockers.push({
      code: "filing_reference_missing",
      message: "Filing reference is required.",
    });
  }

  if (!hasText(case_.confirmationDocumentId)) {
    blockers.push({
      code: "confirmation_document_missing",
      message: "Filing confirmation document is required.",
    });
  }

  return blockers;
}

export function buildReminderDraft(case_: AnnualReturnCase): string {
  const missingItems = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );
  const missingItemList = missingItems.map((item) => `- ${item.itemLabel}`).join("\n");

  const missingSection =
    missingItemList.length > 0
      ? `We are still waiting for:\n${missingItemList}`
      : "All required documents are recorded. We will continue preparing the filing.";
  const closing =
    missingItems.length > 0
      ? "Please send the outstanding items as soon as possible so we can avoid late filing risk."
      : "We will continue preparing the filing and follow up if anything else is needed.";

  return [
    `Hello, this is Kossilon following up on the annual return for ${case_.companyName}.`,
    `The filing deadline is ${case_.filingDueDate}.`,
    missingSection,
    closing,
    "Thank you.",
  ].join("\n\n");
}
