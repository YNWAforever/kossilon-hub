/**
 * Why a reviewer refused a document.
 *
 * The production review buttons sent the fixed string "Rejected during staff
 * review" for every rejection, so the record could not say what was wrong and
 * the client could not be told what to send instead.
 *
 * These are stable codes plus a Traditional Chinese label, composed into the
 * existing free-text `reason` field rather than migrated into a new column: the
 * server already validates that field and several consumers already read it, and
 * Phase A is not the place to change what every one of them means. The code
 * leads the string so it stays machine-readable for the durable model in B/C.
 */

export const DOCUMENT_REJECTION_REASONS = [
  { code: "missing-page", label: "缺頁" },
  { code: "missing-signature", label: "缺少必要簽署" },
  { code: "unreadable", label: "無法辨認／影像不清" },
  { code: "wrong-person", label: "並非該人士的文件" },
  { code: "wrong-company", label: "並非該公司的文件" },
  { code: "wrong-year", label: "並非該年度的文件" },
  { code: "outdated-proof", label: "證明文件已過期" },
  { code: "incomplete-fields", label: "內容未填妥" },
  { code: "other", label: "其他（請說明）" },
] as const;

export type DocumentRejectionReasonCode = (typeof DOCUMENT_REJECTION_REASONS)[number]["code"];

export function rejectionReasonLabel(code: DocumentRejectionReasonCode): string {
  return DOCUMENT_REJECTION_REASONS.find((reason) => reason.code === code)?.label ?? code;
}

/**
 * The stored reason.
 *
 * The note is the reviewer's own words to the client and is kept verbatim, so a
 * precise "第 2 頁未有董事簽署" survives instead of being flattened into the
 * category. `other` without a note would record nothing useful, which is why the
 * caller is expected to require one -- this function still composes something
 * honest if it does not.
 *
 * Capped to the 500 characters the server accepts, truncating the note rather
 * than the code so the structured half always survives.
 */
export function composeRejectionReason(code: DocumentRejectionReasonCode, note?: string): string {
  const head = `${code}: ${rejectionReasonLabel(code)}`;
  const trimmed = note?.trim();
  if (!trimmed) return head;
  const composed = `${head} — ${trimmed}`;
  return composed.length <= 500 ? composed : `${composed.slice(0, 499)}…`;
}
