import type { ChecklistItemStatus, CorporateChangeStatus, CorporateChangeType } from "./types";

// Display labels for corporate-change enum values. Keys are database values and stay in
// English; only the values are shown to staff (docs/ui-language.md).

export const CORPORATE_CHANGE_TYPE_LABELS: Record<CorporateChangeType, string> = {
  name_change: "更改公司名稱",
  share_transfer: "股份轉讓",
  officer_change: "高級人員委任／辭任／資料變更",
  address_change: "更改註冊辦事處地址",
};

export const CORPORATE_CHANGE_STATUS_LABELS: Record<CorporateChangeStatus, string> = {
  Requested: "已提出",
  "Documents pending": "待收文件",
  "Ready to file": "可遞交",
  "Filed with Registrar": "已遞交公司註冊處",
  Completed: "已完成",
  Cancelled: "已取消",
};

export const CHECKLIST_ITEM_STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  Missing: "缺少",
  Received: "已收到",
  Verified: "已核對",
  Rejected: "已退回",
};
