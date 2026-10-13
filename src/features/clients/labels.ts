import type {
  ClientPaymentStatus,
  CompanyStatus,
  ControlBasis,
  IdentificationType,
  OfficerType,
} from "./types";

// Display labels for client-register enum values. The keys are database values and
// must stay in English; only the right-hand side is shown to staff (docs/ui-language.md).

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  active: "有效",
  inactive: "已停用",
};

export const PAYMENT_STATUS_LABELS: Record<ClientPaymentStatus, string> = {
  "Not invoiced": "未開發票",
  "Payment pending": "待付款",
  "Payment received": "已付款",
  Overdue: "逾期未付",
};

export const OFFICER_TYPE_LABELS: Record<OfficerType, string> = {
  director: "董事",
  secretary: "公司秘書",
  designated_representative: "指定代表",
};

export const IDENTIFICATION_TYPE_LABELS: Record<IdentificationType, string> = {
  hkid: "香港身份證",
  passport: "護照",
  br_number: "BR 號碼（法人）",
};

export const CONTROL_BASIS_LABELS: Record<ControlBasis, string> = {
  shares_over_25pct: "持有超過 25% 股份",
  votes_over_25pct: "持有超過 25% 表決權",
  board_appointment_right: "有權委任或罷免董事會大多數成員",
  significant_influence: "行使重大影響力或控制權",
};

export const DOCUMENT_VERIFICATION_LABELS: Record<"pending" | "verified" | "rejected", string> = {
  pending: "待核對",
  verified: "已核對",
  rejected: "已退回",
};
