import type postgres from "postgres";
import { dispositionFor, type NarSourceRow, type RawCell, type RowIssue } from "./mapping";
import type { ParsedImportRow } from "./preview";

const SOURCE_SYSTEM = "nar-monthly-workbook";
const DECISION_ISSUES = new Set([
  "ar-due-differs-from-anniversary-rule",
  "source-differs-from-worked-case",
]);
const DISPOSITION_COLUMN = {
  new: "new",
  updated: "updated",
  unchanged: "unchanged",
  conflict: "conflict",
  invalid: "invalid",
  needsCompanyMapping: "needs_company_mapping",
} as const;
type StoredRow = {
  id: string;
  row_number: number;
  external_client_id: string;
  company_name: string;
  raw: unknown;
  parsed: unknown;
  issues: RowIssue[];
  source_issues: RowIssue[] | null;
  disposition: string;
  matched_company_id: string | null;
  matched_case_id: string | null;
};
export async function refreshImportRows(
  tx: postgres.TransactionSql,
  batch: { id: string; return_year: number | null },
  onlyExternalId?: string,
): Promise<boolean> {
  if (batch.return_year === null) return false;
  const rows = await tx<StoredRow[]>`
    select id,row_number,external_client_id,company_name,raw,parsed,issues,source_issues,
      disposition,matched_company_id,matched_case_id
    from nar_import_rows where batch_id = ${batch.id} and applied_at is null
      and (${onlyExternalId ?? null}::text is null or external_client_id = ${onlyExternalId ?? null})
    order by row_number for update`;
  if (!rows.length) return false;
  const ids = [...new Set(rows.map((row) => row.external_client_id))];
  const refs = await tx<{ external_client_id: string; company_id: string }[]>`
    select external_client_id,company_id from company_external_references
    where source_system = ${SOURCE_SYSTEM} and external_client_id = any(${ids}::text[])`;
  const byExternal = new Map(refs.map((ref) => [ref.external_client_id, ref.company_id]));
  const companyIds = [...new Set(refs.map((ref) => ref.company_id))];
  const cases = companyIds.length
    ? await tx<
        {
          id: string;
          company_id: string;
          return_year: number;
          filing_due_date: string;
          has_progress: boolean;
        }[]
      >`
    select arc.id,arc.company_id,arc.return_year,arc.filing_due_date::text filing_due_date,
      (arc.current_status <> 'Upcoming' or arc.reminders_sent > 0 or arc.locked_at is not null
        or arc.completed_at is not null or arc.filing_reference is not null
        or exists (select 1 from annual_return_checklist_items i
          where i.case_id = arc.id and i.status <> 'Missing')) has_progress
    from annual_return_cases arc where arc.company_id = any(${companyIds}::uuid[])
      and arc.return_year = ${batch.return_year}`
    : [];
  const caseByCompany = new Map(cases.map((item) => [item.company_id, item]));
  let changed = false;
  for (const row of rows) {
    const parsed = row.parsed as ParsedImportRow;
    const sourceIssues = Array.isArray(row.source_issues)
      ? row.source_issues
      : row.issues.filter((issue) => !DECISION_ISSUES.has(issue.code));
    const source: NarSourceRow = {
      rowNumber: row.row_number,
      externalClientId: row.external_client_id,
      companyName: row.company_name,
      raw: row.raw as Record<string, RawCell>,
      incorporation: parsed.incorporation,
      invoice: parsed.invoice,
      paymentReceived: parsed.paymentReceived,
      arDue: parsed.arDue,
      brDue: parsed.brDue,
      issues: sourceIssues,
    };
    const companyId = byExternal.get(row.external_client_id) ?? null;
    const existing = companyId ? caseByCompany.get(companyId) : undefined;
    const decision = dispositionFor(source, {
      matchedCompanyId: companyId,
      returnYear: batch.return_year,
      existingCase: existing
        ? {
            caseId: existing.id,
            returnYear: existing.return_year,
            filingDueDate: existing.filing_due_date,
            hasStaffProgress: existing.has_progress,
          }
        : null,
    });
    const issues = [...sourceIssues, ...decision.issues];
    if (
      row.matched_company_id === companyId &&
      row.matched_case_id === (existing?.id ?? null) &&
      row.disposition === DISPOSITION_COLUMN[decision.disposition] &&
      JSON.stringify(row.issues) === JSON.stringify(issues)
    )
      continue;
    changed = true;
    await tx`update nar_import_rows set matched_company_id = ${companyId},
      matched_case_id = ${existing?.id ?? null},
      disposition = ${DISPOSITION_COLUMN[decision.disposition]},
      issues = ${tx.json(issues as never)}, source_issues = ${tx.json(sourceIssues as never)},
      revision = revision + 1, updated_at = now() where id = ${row.id}`;
  }
  return changed;
}
