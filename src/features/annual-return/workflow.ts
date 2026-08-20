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

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

/**
 * The firm's operational "today". Lives here rather than in the repository so the
 * board can derive deadline tiles against the same calendar day the server used to
 * compute `riskLevel` — a browser-local date drifts for anyone outside HKT.
 */
export function hongKongBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasRequiredChecklistEvidence(item: AnnualReturnChecklistItem): boolean {
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

/** Positive `days` moves forward, negative moves backward. */
export function offsetDateOnly(date: string, days: number): string {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDateOnly(value);
}

export function calculateFilingDueDate(annualReturnBasisDate: string): string {
  return offsetDateOnly(annualReturnBasisDate, 42);
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

  // indexOf returns -1 for a status outside the enum, which made `toIndex ===
  // fromIndex + 1` true for an unknown `from` and the very first status — moving
  // a case with a drifted status backwards to the start of the workflow.
  if (fromIndex < 0 || toIndex < 0) return false;

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
  } else if (!hasText(case_.payment.paymentProofDocumentId)) {
    blockers.push({
      code: "payment_proof_missing",
      message: "Verified payment proof document is required.",
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

export function buildReminderDraft(
  case_: AnnualReturnCase,
  contactName: string,
  today: string,
): string {
  const missingItems = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );
  const daysRemaining = daysBetween(today, case_.filingDueDate);
  const daysRemainingText =
    daysRemaining >= 0 ? `距離現時尚餘 ${daysRemaining} 天` : `已逾期 ${-daysRemaining} 天`;

  const missingSection =
    missingItems.length > 0
      ? [
          "我們已為貴公司準備申報文件，現需要您提供以下資料以便如期遞交：",
          ...missingItems.map((item) => `- ${item.itemLabel}`),
          "",
          "如所有文件已齊備，我們會即時安排遞交，並在完成後把回條發送給您。",
        ].join("\n")
      : "貴公司提供的文件已經齊備，我們將繼續為貴公司準備及跟進申報事宜。";

  return [
    `${contactName} 您好，我是高仕輪企業服務。`,
    `提提您，${case_.companyName} 的周年申報表（NAR1）申報限期為 ${case_.filingDueDate}，${daysRemainingText}。`,
    missingSection,
    "請留意：若周年申報表在申報日起計 42 天後才遞交，會按逾期時間產生罰款，最低 HK$870，最高 HK$3,480。",
    "如有任何疑問，歡迎隨時聯絡我們。",
    "高仕輪企業服務",
  ].join("\n\n");
}
