import type { ImportPreviewRow } from "./preview";

export type ImportCaseState = {
  id: string;
  status: string;
  filingDueDate: string;
  updatedAt: string;
};
export type ImportRowPlan = {
  kind: "create" | "update" | "skip" | "conflict";
  filingDueDate: string | null;
  paymentObservedDate: string | null;
  reasonCode: string | null;
};
function fieldAfter(row: ImportPreviewRow, field: string): string | null {
  return row.fields.find((candidate) => candidate.field === field)?.after ?? null;
}
export function planImportedRow(
  row: ImportPreviewRow,
  current: ImportCaseState | null,
): ImportRowPlan {
  const paymentObservedDate = fieldAfter(row, "paymentObservedDate");
  const candidate = row.fields.find((field) => field.field === "filingDueDate");
  const conflict = (reasonCode: string): ImportRowPlan => ({
    kind: "conflict",
    filingDueDate: current?.filingDueDate ?? null,
    paymentObservedDate,
    reasonCode,
  });
  if (
    !row.matchedCompanyId ||
    ["invalid", "needsCompanyMapping", "conflict"].includes(row.disposition)
  )
    return conflict("ROW_NOT_APPROVABLE");
  if (!current) {
    if (row.caseSnapshot || row.matchedCaseId) return conflict("CASE_DISAPPEARED");
    if (row.disposition !== "new" || !candidate?.after || candidate.policy !== "candidate")
      return conflict("NEW_CASE_DUE_REQUIRED");
    return {
      kind: "create",
      filingDueDate: candidate.after,
      paymentObservedDate,
      reasonCode: null,
    };
  }
  if (!row.caseSnapshot || row.matchedCaseId !== current.id)
    return conflict("CASE_CREATED_AFTER_PREVIEW");
  if (
    row.caseSnapshot.updatedAt !== current.updatedAt ||
    row.caseSnapshot.status !== current.status ||
    row.caseSnapshot.filingDueDate !== current.filingDueDate
  )
    return conflict("CASE_CHANGED_AFTER_PREVIEW");
  if (current.status === "Filed" || current.status === "Completed")
    return {
      kind: "skip",
      filingDueDate: current.filingDueDate,
      paymentObservedDate,
      reasonCode: "TERMINAL_CASE_PRESERVED",
    };
  if (
    !candidate?.after ||
    candidate.policy !== "candidate" ||
    candidate.after === current.filingDueDate ||
    row.disposition === "unchanged"
  )
    return {
      kind: "skip",
      filingDueDate: current.filingDueDate,
      paymentObservedDate,
      reasonCode: "NO_SAFE_FIELD_CHANGE",
    };
  if (row.disposition !== "updated") return conflict("DISPOSITION_CHANGED");
  return { kind: "update", filingDueDate: candidate.after, paymentObservedDate, reasonCode: null };
}
export function assertDistinctImportTargets(
  rows: readonly ImportPreviewRow[],
  returnYear: number,
): void {
  const targets = new Set<string>();
  for (const row of rows) {
    if (!row.matchedCompanyId) continue;
    const key = `${row.matchedCompanyId}:${returnYear}`;
    if (targets.has(key))
      throw new Error("Two import rows target the same company and return year.");
    targets.add(key);
  }
}
export function importLogicalKey(semanticKey: string, previewHash: string): string {
  return JSON.stringify({ action: "importApply", semanticKey, previewHash });
}
