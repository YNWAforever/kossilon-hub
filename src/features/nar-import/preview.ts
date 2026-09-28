import { isoOf, type NormalizedDate, type NormalizedDayMonth } from "./normalize";
import type { NarImportBatch, NarImportRow } from "./repository";
import type { NarColumnKey, NarRowDisposition, RowIssue } from "./mapping";

export type ParsedImportRow = {
  incorporation: NormalizedDayMonth;
  invoice: { kind: "value" | "nil" | "absent"; raw: string };
  paymentReceived: NormalizedDate;
  arDue: NormalizedDate;
  brDue: NormalizedDate;
};
export type ImportFieldPreview = {
  field: string;
  before: string | null;
  after: string | null;
  source: string;
  policy: "candidate" | "preserve-human" | "observation-only" | "display-only";
};
export type ImportPreviewRow = {
  rowId: string;
  rowRevision: number;
  rowNumber: number;
  externalClientId: string;
  matchedCompanyId: string | null;
  matchedCaseId: string | null;
  disposition: NarRowDisposition;
  issues: RowIssue[];
  fields: ImportFieldPreview[];
};
export type ImportPreview = {
  id: string;
  batchId: string;
  revision: number;
  semanticKey: string;
  previewHash: string;
  counts: Record<NarRowDisposition, number>;
  rows: ImportPreviewRow[];
  expiresAt: string;
};
export function semanticKeyFor(
  batch: Pick<
    NarImportBatch,
    "sourceSha256" | "sheetName" | "returnYear" | "parserVersion" | "mappingRevision"
  >,
): string {
  if (batch.returnYear === null)
    throw new Error("Legacy import batch needs an explicit return year.");
  return [
    batch.sourceSha256,
    batch.sheetName,
    batch.returnYear,
    batch.parserVersion,
    batch.mappingRevision,
  ].join(":");
}
export function previewRowFor(
  row: NarImportRow,
  existingCase: { filingDueDate: string; hasStaffProgress: boolean } | null,
  columns: Record<NarColumnKey, string> | null,
): ImportPreviewRow {
  const parsed = row.parsed as ParsedImportRow;
  const due = isoOf(parsed.arDue);
  const source = (column: NarColumnKey) =>
    columns?.[column]
      ? `workbook:${columns[column]}${row.rowNumber}`
      : `workbook:row:${row.rowNumber}`;
  const fields: ImportFieldPreview[] = [
    {
      field: "companyName",
      before: null,
      after: row.companyName,
      source: source("companyName"),
      policy: "display-only",
    },
    {
      field: "filingDueDate",
      before: existingCase?.filingDueDate ?? null,
      after: due,
      source: source("arDue"),
      policy: !due || existingCase?.hasStaffProgress ? "preserve-human" : "candidate",
    },
    {
      field: "brDue",
      before: null,
      after: isoOf(parsed.brDue),
      source: source("brDue"),
      policy: "observation-only",
    },
    {
      field: "invoiceReference",
      before: null,
      after: parsed.invoice.kind === "value" ? parsed.invoice.raw : null,
      source: source("invoice"),
      policy: "observation-only",
    },
    {
      field: "paymentObservedDate",
      before: null,
      after: isoOf(parsed.paymentReceived),
      source: source("paymentReceived"),
      policy: "observation-only",
    },
    {
      field: "incorporationDayMonth",
      before: null,
      after: parsed.incorporation.kind === "dayMonth" ? parsed.incorporation.raw : null,
      source: source("incorporation"),
      policy: "observation-only",
    },
  ];
  return {
    rowId: row.id,
    rowRevision: row.revision,
    rowNumber: row.rowNumber,
    externalClientId: row.externalClientId,
    matchedCompanyId: row.matchedCompanyId,
    matchedCaseId: row.matchedCaseId,
    disposition: row.disposition,
    issues: row.issues,
    fields,
  };
}
export function emptyImportCounts(): Record<NarRowDisposition, number> {
  return { new: 0, updated: 0, unchanged: 0, conflict: 0, invalid: 0, needsCompanyMapping: 0 };
}
