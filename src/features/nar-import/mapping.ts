import {
  anniversaryPlus42,
  isNilMarker,
  isoOf,
  normalizeDateCell,
  normalizeDayMonthCell,
  type NormalizedDate,
  type NormalizedDayMonth,
} from "./normalize";
import type { WorkbookCell, WorkbookSheet } from "./xlsx/workbook";

/**
 * Turning a worksheet into candidate records, and deciding what each one means.
 *
 * Two rules run through all of it. Nothing is invented -- a value the workbook
 * does not contain stays absent, and every doubt becomes an issue a person
 * resolves rather than a default the importer picks. And nothing is discarded --
 * `raw` carries every cell verbatim, so a mapping decision can be revisited
 * later without re-reading the file.
 */

export type IssueSeverity = "blocking" | "attention";

export type RowIssue = {
  code: string;
  message: string;
  column?: string;
  severity: IssueSeverity;
};

export type RawCell = {
  ref: string;
  type: string;
  text: string;
  numeric?: number;
  dateFormatted: boolean;
  fromFormula: boolean;
};

export type NarSourceRow = {
  rowNumber: number;
  externalClientId: string;
  companyName: string;
  incorporation: NormalizedDayMonth;
  /** `(Nil)` is its own kind; it is never read as "no invoice" or "not billed". */
  invoice: { kind: "value" | "nil" | "absent"; raw: string };
  paymentReceived: NormalizedDate;
  arDue: NormalizedDate;
  brDue: NormalizedDate;
  raw: Record<string, RawCell>;
  issues: RowIssue[];
};

export type NarColumnKey =
  | "clientId"
  | "companyName"
  | "incorporation"
  | "invoice"
  | "paymentReceived"
  | "arDue"
  | "brDue";

// Display names for issue messages only; the keys are the parser's contract.
const NAR_COLUMN_LABELS: Record<NarColumnKey, string> = {
  clientId: "客戶編號",
  companyName: "公司名稱",
  incorporation: "成立日期",
  invoice: "發票編號",
  paymentReceived: "收款日期",
  arDue: "周年申報到期日",
  brDue: "BR 到期日",
};

const NAR_FIELD_LABELS: Record<string, string> = {
  filingDueDate: "申報到期日",
};

export type NarSheetReadResult = {
  sheetName: string;
  headerRowNumber: number;
  /** Column letter for each recognised header, e.g. { clientId: "B" }. */
  columns: Record<NarColumnKey, string>;
  rows: NarSourceRow[];
  /** Rows that carried something but no client id, reported rather than dropped. */
  skippedRowNumbers: number[];
  issues: RowIssue[];
};

/**
 * Header text is matched loosely because the supplied worksheet's own headers
 * carry embedded newlines and trailing spaces ("Payment \r\nRcvd Date",
 * "AR \r\nDue Date "). Matching on a normalised form is what makes the mapping
 * survive a file someone has retyped.
 */
const HEADER_PATTERNS: ReadonlyArray<{ key: NarColumnKey; test: (value: string) => boolean }> = [
  { key: "clientId", test: (v) => v === "clientid" },
  { key: "companyName", test: (v) => v === "name" || v === "companyname" },
  { key: "incorporation", test: (v) => v.startsWith("dateofincorp") },
  { key: "invoice", test: (v) => v.startsWith("invoiceno") },
  { key: "paymentReceived", test: (v) => v.startsWith("payment") && v.includes("date") },
  { key: "arDue", test: (v) => v.startsWith("ar") && v.includes("due") },
  { key: "brDue", test: (v) => v.startsWith("br") && v.includes("due") },
];

function normalizeHeader(value: string): string {
  return value.replace(/[\s .]+/g, "").toLowerCase();
}

function toRawCell(cell: WorkbookCell): RawCell {
  return {
    ref: cell.ref,
    type: cell.type,
    text: cell.text,
    ...(cell.numeric === undefined ? {} : { numeric: cell.numeric }),
    dateFormatted: cell.dateFormatted,
    fromFormula: cell.fromFormula,
  };
}

function dateIssues(
  value: NormalizedDate,
  column: string,
  label: string,
  issues: RowIssue[],
): void {
  if (value.kind === "unparsed") {
    issues.push({
      code: "date-unreadable",
      column,
      severity: "attention",
      message: `${label}無法讀取為日期：${value.raw}。${value.reason}`,
    });
  }
  if (value.kind === "nil") {
    issues.push({
      code: "nil-marker",
      column,
      severity: "attention",
      message: `${label}為「(Nil)」。須先確認其意思，才可視為已付款、未付款或已取消。`,
    });
  }
  if (value.kind === "text") {
    issues.push({
      code: "date-arrived-as-text",
      column,
      severity: "attention",
      message: `${label}以文字輸入（「${value.raw}」），而不是以日期儲存。`,
    });
    if (value.note) {
      issues.push({
        code: "date-carries-note",
        column,
        severity: "attention",
        message: `${label}附有備註 ${value.note}，已原文保留以待確認。`,
      });
    }
  }
}

export function readNarSheet(sheet: WorkbookSheet, date1904: boolean): NarSheetReadResult {
  const sheetIssues: RowIssue[] = [];
  const rowNumbers = [...sheet.rows.keys()].sort((a, b) => a - b);

  // The header is found rather than assumed to be row 2, so a file with a taller
  // title block still maps correctly instead of reading its own headers as data.
  let headerRowNumber = -1;
  const columns = {} as Record<NarColumnKey, string>;
  for (const rowNumber of rowNumbers) {
    const cells = sheet.rows.get(rowNumber);
    if (!cells) continue;
    const found = {} as Record<NarColumnKey, string>;
    for (const [column, cell] of cells) {
      const normalized = normalizeHeader(cell.text);
      const pattern = HEADER_PATTERNS.find((candidate) => candidate.test(normalized));
      if (pattern && !found[pattern.key]) found[pattern.key] = column;
    }
    if (found.clientId && found.companyName) {
      headerRowNumber = rowNumber;
      Object.assign(columns, found);
      break;
    }
  }

  if (headerRowNumber === -1) {
    return {
      sheetName: sheet.name,
      headerRowNumber: -1,
      columns,
      rows: [],
      skippedRowNumbers: [],
      issues: [
        {
          code: "header-not-found",
          severity: "blocking",
          message: "找不到標題行。工作表須有一行包含「Client ID」及「Name」。",
        },
      ],
    };
  }

  for (const key of ["incorporation", "invoice", "paymentReceived", "arDue", "brDue"] as const) {
    if (!columns[key]) {
      sheetIssues.push({
        code: "column-missing",
        severity: "attention",
        message: `找不到「${NAR_COLUMN_LABELS[key]}」欄；所有行都不會有這項資料。`,
      });
    }
  }

  const rows: NarSourceRow[] = [];
  const skippedRowNumbers: number[] = [];

  for (const rowNumber of rowNumbers) {
    if (rowNumber <= headerRowNumber) continue;
    const cells = sheet.rows.get(rowNumber);
    if (!cells) continue;

    const externalClientId = cells.get(columns.clientId)?.text.trim() ?? "";
    if (externalClientId === "") {
      // A row with content but no client id is reported, not silently dropped.
      // Column A of the supplied worksheet holds a single space on one row, which
      // is exactly the kind of thing that must not read as a record.
      skippedRowNumbers.push(rowNumber);
      continue;
    }

    const issues: RowIssue[] = [];
    const raw: Record<string, RawCell> = {};
    for (const [column, cell] of cells) raw[column] = toRawCell(cell);

    const companyName = cells.get(columns.companyName)?.text.trim() ?? "";
    if (companyName === "") {
      issues.push({
        code: "company-name-missing",
        column: columns.companyName,
        severity: "blocking",
        message: "此行有客戶編號，但沒有公司名稱。",
      });
    }

    const incorporation = normalizeDayMonthCell(cells.get(columns.incorporation));
    if (incorporation.kind === "unparsed") {
      issues.push({
        code: "incorporation-unreadable",
        column: columns.incorporation,
        severity: "attention",
        message: `無法讀取成立日期：${incorporation.raw}。${incorporation.reason}`,
      });
    }
    if (incorporation.kind === "dayMonth") {
      // Recorded on every row, because the workbook genuinely has no year and a
      // reviewer should not have to notice its absence for themselves.
      issues.push({
        code: "incorporation-year-unknown",
        column: columns.incorporation,
        severity: "attention",
        message: `成立日期為 ${incorporation.raw}，來源沒有年份；系統不會推斷年份。`,
      });
    }

    const invoiceRaw = cells.get(columns.invoice)?.text.trim() ?? "";
    const invoice: NarSourceRow["invoice"] =
      invoiceRaw === ""
        ? { kind: "absent", raw: "" }
        : isNilMarker(invoiceRaw)
          ? { kind: "nil", raw: invoiceRaw }
          : { kind: "value", raw: invoiceRaw };
    if (invoice.kind === "nil") {
      issues.push({
        code: "nil-marker",
        column: columns.invoice,
        severity: "attention",
        message: "發票編號為「(Nil)」。須先確認其意思；系統不會視之為未開發票。",
      });
    }

    const paymentReceived = normalizeDateCell(cells.get(columns.paymentReceived), date1904);
    const arDue = normalizeDateCell(cells.get(columns.arDue), date1904);
    const brDue = normalizeDateCell(cells.get(columns.brDue), date1904);

    dateIssues(paymentReceived, columns.paymentReceived, "收款日期", issues);
    dateIssues(arDue, columns.arDue, "周年申報到期日", issues);
    dateIssues(brDue, columns.brDue, "BR 到期日", issues);

    if (arDue.kind === "absent") {
      issues.push({
        code: "ar-due-missing",
        column: columns.arDue,
        severity: "blocking",
        message: "此行沒有周年申報到期日，而案件正是以此日期為限期。",
      });
    }

    // A payment recorded after the AR due date is a fact about bookkeeping, not
    // evidence of a late filing, and the plan is explicit that it must not be
    // read as one.
    const paymentIso = isoOf(paymentReceived);
    const arIso = isoOf(arDue);
    if (paymentIso && arIso && paymentIso > arIso) {
      issues.push({
        code: "payment-after-ar-due",
        column: columns.paymentReceived,
        severity: "attention",
        message: `收款日期 ${paymentIso} 晚於周年申報到期日 ${arIso}。只按來源記錄，不代表逾期遞交。`,
      });
    }

    for (const [column, cell] of cells) {
      if (cell.fromFormula) {
        issues.push({
          code: "value-computed-by-workbook",
          column,
          severity: "attention",
          message: `${cell.ref} 的數值由工作簿公式計算，並非來源系統提供。`,
        });
      }
    }

    rows.push({
      rowNumber,
      externalClientId,
      companyName,
      incorporation,
      invoice,
      paymentReceived,
      arDue,
      brDue,
      raw,
      issues,
    });
  }

  // Duplicates are found across the batch, so they can only be checked once
  // every row is known.
  const byClientId = new Map<string, number[]>();
  const byInvoice = new Map<string, number[]>();
  for (const row of rows) {
    byClientId.set(row.externalClientId, [
      ...(byClientId.get(row.externalClientId) ?? []),
      row.rowNumber,
    ]);
    if (row.invoice.kind === "value") {
      byInvoice.set(row.invoice.raw, [...(byInvoice.get(row.invoice.raw) ?? []), row.rowNumber]);
    }
  }
  for (const row of rows) {
    const sameClientId = byClientId.get(row.externalClientId) ?? [];
    if (sameClientId.length > 1) {
      row.issues.push({
        code: "duplicate-client-id",
        severity: "blocking",
        message: `客戶編號 ${row.externalClientId} 出現在第 ${sameClientId.join("、")} 行。一個編號只代表一間公司，這些行不可能同時正確。`,
      });
    }
    if (row.invoice.kind === "value") {
      const sameInvoice = byInvoice.get(row.invoice.raw) ?? [];
      // The supplied worksheet has exactly this: one invoice number on two
      // different companies. Flagged for attention rather than treated as a
      // match, because the invoice number is not an identity.
      if (sameInvoice.length > 1) {
        row.issues.push({
          code: "duplicate-invoice-number",
          severity: "attention",
          message: `發票 ${row.invoice.raw} 亦出現在第 ${sameInvoice
            .filter((candidate) => candidate !== row.rowNumber)
            .join("、")} 行。系統不會以發票編號配對記錄。`,
        });
      }
    }
  }

  return {
    sheetName: sheet.name,
    headerRowNumber,
    columns,
    rows,
    skippedRowNumbers,
    issues: sheetIssues,
  };
}

/**
 * How a row compares to what is already in the database.
 *
 * `needsCompanyMapping` is deliberately a first-class outcome rather than an
 * error. The workbook carries a client id and a name, and `companies` requires
 * cr_number, br_number, incorporation_date, annual_return_basis_date,
 * registered_office, company_secretary and two owning ids -- all NOT NULL, two of
 * them globally unique. A fabricated BR number would permanently burn a value the
 * real one later needs, so an unmatched row waits for a person.
 */
export type NarRowDisposition =
  | "new"
  | "updated"
  | "unchanged"
  | "conflict"
  | "invalid"
  | "needsCompanyMapping";

export type ExistingCaseSnapshot = {
  caseId: string;
  returnYear: number;
  filingDueDate: string;
  /** True once anyone has done work the source must not silently overwrite. */
  hasStaffProgress: boolean;
};

export type FieldChange = { field: string; from: string | null; to: string | null };

export type RowDispositionResult = {
  disposition: NarRowDisposition;
  changes: FieldChange[];
  issues: RowIssue[];
};

export function dispositionFor(
  row: NarSourceRow,
  context: {
    matchedCompanyId: string | null;
    existingCase: ExistingCaseSnapshot | null;
    returnYear: number;
  },
): RowDispositionResult {
  const issues: RowIssue[] = [];

  if (row.issues.some((issue) => issue.severity === "blocking")) {
    return { disposition: "invalid", changes: [], issues };
  }
  if (!context.matchedCompanyId) {
    return { disposition: "needsCompanyMapping", changes: [], issues };
  }

  const arIso = isoOf(row.arDue);
  if (!context.existingCase) {
    // Offered as a cross-check only. On the supplied worksheet this rule is one
    // day out on one row, so it can never be used to correct the source.
    if (row.incorporation.kind === "dayMonth" && arIso) {
      const derived = anniversaryPlus42(row.incorporation, context.returnYear);
      if (derived && derived.iso !== arIso) {
        issues.push({
          code: "ar-due-differs-from-anniversary-rule",
          severity: "attention",
          message: `來源的周年申報到期日為 ${arIso}；按成立周年日加 42 日計算應為 ${derived.iso}。已保留來源數值。`,
        });
      }
    }
    return { disposition: "new", changes: [], issues };
  }

  const changes: FieldChange[] = [];
  if (arIso && arIso !== context.existingCase.filingDueDate) {
    changes.push({ field: "filingDueDate", from: context.existingCase.filingDueDate, to: arIso });
  }

  if (changes.length === 0) return { disposition: "unchanged", changes, issues };

  // Source-owned fields may update, but never over the top of human work without
  // a person seeing it first.
  if (context.existingCase.hasStaffProgress) {
    issues.push({
      code: "source-differs-from-worked-case",
      severity: "attention",
      message: `來源與已有同事處理的案件不一致：${changes
        .map(
          (change) =>
            `${NAR_FIELD_LABELS[change.field] ?? change.field} 由 ${change.from} 改為 ${change.to}`,
        )
        .join("；")}。`,
    });
    return { disposition: "conflict", changes, issues };
  }

  return { disposition: "updated", changes, issues };
}
