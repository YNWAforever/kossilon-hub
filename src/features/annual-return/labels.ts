// Display labels for the annual-return enum values. The values themselves are
// database contracts (and are compared in code), so screens keep passing the
// English value around and only render it through these maps.
import type { AnnualReturnStatus, ChecklistStatus, PaymentStatus, RiskLevel } from "./types";

export const annualReturnStatusLabels: Record<AnnualReturnStatus, string> = {
  Upcoming: "即將開始",
  "Client reminder sent": "已提醒客戶",
  "Documents pending": "待收文件",
  "Documents received": "已收文件",
  "Payment pending": "待付款",
  "Payment received": "已付款",
  "NAR1 prepared": "NAR1 已擬備",
  "Signature pending": "待簽署",
  "Ready to file": "可遞交",
  Filed: "已遞交",
  Completed: "已完成",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  "Not invoiced": "未發單",
  "Payment pending": "待付款",
  "Payment received": "已付款",
  Overdue: "逾期未付",
};

export const riskLevelLabels: Record<RiskLevel, string> = {
  red: "紅色",
  orange: "橙色",
  yellow: "黃色",
  green: "綠色",
};

export const checklistStatusLabels: Record<ChecklistStatus, string> = {
  Missing: "缺少",
  Received: "已收到",
  Verified: "已核對",
  Rejected: "已退回",
};

/** Falls back to the raw value so an unexpected status is still shown. */
export function annualReturnStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return annualReturnStatusLabels[status as AnnualReturnStatus] ?? status;
}

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return paymentStatusLabels[status as PaymentStatus] ?? status;
}

export function riskLevelLabel(risk: string | null | undefined): string {
  if (!risk) return "—";
  return riskLevelLabels[risk as RiskLevel] ?? risk;
}

export function checklistStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return checklistStatusLabels[status as ChecklistStatus] ?? status;
}
