import type { EscalationState } from "./repository";
import type { WorkItemStatus } from "./types";

/**
 * Display labels for work-item enums. The enum values themselves are database
 * and URL contracts (`?sla=breach`, `status = 'in_progress'`) and stay English;
 * only what a person reads is translated (docs/ui-language.md).
 */
export const ESCALATION_STATE_LABELS: Record<EscalationState, string> = {
  none: "正常",
  warning: "有風險",
  breach: "已逾時",
  acknowledged: "已確認知悉",
};

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  open: "待處理",
  in_progress: "處理中",
  blocked: "受阻",
  completed: "已完成",
  cancelled: "已取消",
};

const WORK_TYPE_LABELS: Record<string, string> = {
  annual_return_case: "周年申報案件",
  corporate_change_request: "公司變更申請",
};

/** Unknown work types fall back to their stored value rather than disappearing. */
export function workTypeLabel(workType: string): string {
  return WORK_TYPE_LABELS[workType] ?? workType;
}
