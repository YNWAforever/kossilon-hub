import type { WorkViewKey, WorkViewRow } from "@/features/annual-return/work-views";
import type {
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "@/features/annual-return/types";

/** The work view is a server-derived decision, not a UI guess from status text. */
export type OperationalAction = {
  kind: "reminder" | "document-review" | "manual-submission" | "return-review";
  label: string;
  href?: string;
  disabledReason?: string;
};

export function operationalActionFor(
  viewKey: WorkViewKey,
  row: WorkViewRow,
  unavailableReason?: string,
): OperationalAction {
  const base = `/annual-returns/${encodeURIComponent(row.caseId)}`;
  const kindAndLabel = {
    chaseToday: { kind: "reminder", label: "草擬追件", hash: "reminders" },
    newlyReceived: {
      kind: "document-review",
      label: "覆核新文件",
      hash: row.documentId ? `document-${row.documentId}` : null,
    },
    awaitingMyReview: {
      kind: "document-review",
      label: "覆核文件",
      hash: row.documentId ? `document-${row.documentId}` : null,
    },
    readyToFile: { kind: "manual-submission", label: "記錄人手交件", hash: "filing" },
    returnsAndExceptions: { kind: "return-review", label: "核對回件", hash: "returns" },
  } as const;
  const action = kindAndLabel[viewKey];
  if (unavailableReason)
    return { kind: action.kind, label: action.label, disabledReason: unavailableReason };
  if (!action.hash)
    return {
      kind: action.kind,
      label: action.label,
      disabledReason: "暫未能定位最新文件；請開啟案件，由負責同事核對文件版本。",
    };
  return {
    kind: action.kind,
    label: action.label,
    href:
      action.kind === "document-review"
        ? `/documents?caseId=${encodeURIComponent(row.caseId)}#${action.hash}`
        : `${base}#${action.hash}`,
  };
}

const statusLabels: Record<AnnualReturnStatus, string> = {
  Upcoming: "將到期",
  "Client reminder sent": "已提醒客戶",
  "Documents pending": "待收文件",
  "Documents received": "已收文件",
  "Payment pending": "待付款",
  "Payment received": "已收付款",
  "NAR1 prepared": "已備妥 NAR1",
  "Signature pending": "待簽署",
  "Ready to file": "可交件",
  Filed: "已交件",
  Completed: "已結案",
};
const paymentLabels: Record<PaymentStatus, string> = {
  "Not invoiced": "尚未開單",
  "Payment pending": "待付款",
  "Payment received": "已核實付款",
  Overdue: "逾期未付",
};
const checklistLabels: Record<ChecklistStatus, string> = {
  Missing: "未收到",
  Received: "待內部覆核",
  Verified: "已核實",
  Rejected: "需重新提交",
};
const riskLabels: Record<RiskLevel, string> = {
  green: "低風險",
  yellow: "需留意",
  orange: "較高風險",
  red: "高風險",
};
export const annualReturnStatusLabel = (value: AnnualReturnStatus) => statusLabels[value];
export const paymentStatusLabel = (value: PaymentStatus) => paymentLabels[value];
export const checklistStatusLabel = (value: ChecklistStatus) => checklistLabels[value];
export const riskLevelLabel = (value: RiskLevel) => riskLabels[value];
