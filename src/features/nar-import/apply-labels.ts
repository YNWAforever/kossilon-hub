/**
 * Display labels for the NAR apply panel. The codes and states are server
 * contracts (stored in `nar_apply_job_items.state`, returned by the preview) and
 * stay English; only what a person reads is translated (docs/ui-language.md).
 * Unknown values fall back to the raw code rather than disappearing.
 */
const APPLY_STATE_LABELS: Record<string, string> = {
  queued: "排隊中",
  running: "處理中",
  partial: "部分完成",
  completed: "已完成",
  pending: "待處理",
  applied: "已套用",
  conflict: "衝突",
  failed: "失敗",
  cancelled: "已取消",
};

const APPLY_REQUIREMENT_LABELS: Record<string, string> = {
  existingPaymentRecord: "需要現有付款記錄",
  confirmedReturnYear: "需確認批次年度",
  confirmedCompanyMapping: "需確認公司對應",
  sourceFilingDueDate: "來源缺少申報到期日",
  templateId: "需選擇模板",
  ownerId: "需選擇負責同事",
  feeAmount: "需輸入實際費用",
  madeUpDate: "需輸入結算日期",
  invoiceNumber: "需輸入發票編號",
  acknowledgeDueDifference: "需確認到期日差異",
  acknowledgeYearDifference: "需確認年度差異",
  acknowledgeSourceIssues: "需確認來源注意事項",
  existing_invoice_or_fee_change_requires_separate_review: "更改現有發票或費用須另行覆核",
  source_invoice_change_requires_separate_review: "來源發票有變，須另行覆核",
  assignment_requires_separate_command: "更改負責同事須另行分配",
  applied_row_mapping_conflict: "已套用行的公司對應有衝突",
  company_inactive: "公司已停用",
  source_row_invalid: "來源行無法匯入",
  template_ineligible: "所選模板不適用",
  owner_ineligible: "所選同事不可負責",
  filing_due_before_made_up: "申報到期日早於結算日期",
  made_up_year_mismatch: "結算日期年度與批次不符",
  current_year_activation_required: "需確認啟用本年度正式案件",
  existing_case_origin_mismatch: "現有案件用途不符",
  non_client_company: "公司不是正式客戶",
};

export function narApplyStateLabel(state: string): string {
  return APPLY_STATE_LABELS[state] ?? state;
}

export function narApplyRequirementLabel(code: string): string {
  return APPLY_REQUIREMENT_LABELS[code] ?? code;
}
