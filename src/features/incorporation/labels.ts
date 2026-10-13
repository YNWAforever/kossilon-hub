import type { ChecklistItemStatus, IncorporationStatus } from "./types";

// Display labels for incorporation enum values. Keys are database values and stay in
// English; only the values are shown to staff (docs/ui-language.md).

export const INCORPORATION_STATUS_LABELS: Record<IncorporationStatus, string> = {
  Intake: "受理中",
  "Documents pending": "待收文件",
  "Ready to file": "可遞交",
  "Filed with Registrar": "已遞交公司註冊處",
  Completed: "已完成",
};

export const CHECKLIST_ITEM_STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  Missing: "缺少",
  Received: "已收到",
  Verified: "已核對",
  Rejected: "已退回",
};
