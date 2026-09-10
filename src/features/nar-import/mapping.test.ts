import { describe, expect, it } from "vitest";
import { dispositionFor, readNarSheet, type NarSourceRow } from "./mapping";
import type { WorkbookCell, WorkbookSheet } from "./xlsx/workbook";

/**
 * Sheets are built directly here rather than through the ZIP reader: these tests
 * are about what the mapping makes of a sheet, and workbook.test.ts already
 * proves the sheet is read correctly from real bytes.
 */

type CellSpec = string | number | { text: string; formula?: boolean };

function makeCell(column: string, row: number, spec: CellSpec): WorkbookCell {
  if (typeof spec === "number") {
    return {
      ref: `${column}${row}`,
      column,
      row,
      type: "n",
      raw: String(spec),
      text: String(spec),
      numeric: spec,
      dateFormatted: true,
      fromFormula: false,
    };
  }
  const value = typeof spec === "string" ? spec : spec.text;
  return {
    ref: `${column}${row}`,
    column,
    row,
    type: "s",
    raw: value,
    text: value,
    dateFormatted: false,
    fromFormula: typeof spec === "object" && Boolean(spec.formula),
  };
}

function sheet(rows: Record<number, Record<string, CellSpec>>): WorkbookSheet {
  const map = new Map<number, Map<string, WorkbookCell>>();
  for (const [rowNumber, columns] of Object.entries(rows)) {
    const cells = new Map<string, WorkbookCell>();
    for (const [column, spec] of Object.entries(columns)) {
      cells.set(column, makeCell(column, Number(rowNumber), spec));
    }
    map.set(Number(rowNumber), cells);
  }
  return { name: "8.2025", dimension: "A1:CO65", rows: map };
}

const HEADER = {
  B: "Client ID",
  C: "Name",
  D: "Date of Incorp",
  E: "Invoice no. ",
  F: "Payment \r\nRcvd Date",
  G: "AR \r\nDue Date ",
  H: "BR \r\nDue Date",
};

function baseSheet(extraRows: Record<number, Record<string, CellSpec>> = {}) {
  return sheet({
    1: { A: "Annual Return 2025" },
    2: HEADER,
    3: {
      A: 1,
      B: "X10001",
      C: "SUNRISE HOLDINGS LIMITED",
      D: "02/08",
      E: "INV-1",
      F: 45940,
      G: 45913,
      H: 45905,
    },
    ...extraRows,
  });
}

function rowFor(result: ReturnType<typeof readNarSheet>, clientId: string): NarSourceRow {
  const row = result.rows.find((candidate) => candidate.externalClientId === clientId);
  if (!row) throw new Error(`no row for ${clientId}`);
  return row;
}

describe("readNarSheet", () => {
  it("finds the header row and maps every column, despite embedded newlines", () => {
    const result = readNarSheet(baseSheet(), false);
    expect(result.headerRowNumber).toBe(2);
    expect(result.columns).toEqual({
      clientId: "B",
      companyName: "C",
      incorporation: "D",
      invoice: "E",
      paymentReceived: "F",
      arDue: "G",
      brDue: "H",
    });
  });

  it("reads one record per row that carries a client id", () => {
    const result = readNarSheet(baseSheet(), false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 3,
      externalClientId: "X10001",
      companyName: "SUNRISE HOLDINGS LIMITED",
    });
  });

  // Column A of the supplied worksheet holds a single space on one row. A row
  // like that must not read as a record, and must not vanish silently either.
  it("reports a row with content but no client id rather than dropping it", () => {
    const result = readNarSheet(baseSheet({ 4: { A: " " } }), false);
    expect(result.rows).toHaveLength(1);
    expect(result.skippedRowNumbers).toEqual([4]);
  });

  it("keeps every cell verbatim so a mapping decision can be revisited", () => {
    const row = readNarSheet(baseSheet(), false).rows[0];
    expect(row.raw.G).toMatchObject({ ref: "G3", type: "n", numeric: 45913, dateFormatted: true });
    expect(row.raw.C.text).toBe("SUNRISE HOLDINGS LIMITED");
  });

  it("resolves a serial due date and keeps its provenance", () => {
    const row = readNarSheet(baseSheet(), false).rows[0];
    expect(row.arDue).toMatchObject({ kind: "serial", iso: "2025-09-13", serial: 45913 });
  });

  it("records a day-and-month incorporation without inventing a year", () => {
    const row = readNarSheet(baseSheet(), false).rows[0];
    expect(row.incorporation).toMatchObject({ kind: "dayMonth", day: 2, month: 8 });
    expect(row.issues.map((issue) => issue.code)).toContain("incorporation-year-unknown");
  });

  it('keeps "(Nil)" as its own kind in both the invoice and payment columns', () => {
    const result = readNarSheet(
      baseSheet({
        4: { B: "X10002", C: "HARBOUR LIGHT LIMITED", E: "(Nil)", F: "(Nil)", G: 45919 },
      }),
      false,
    );
    const row = rowFor(result, "X10002");
    expect(row.invoice).toEqual({ kind: "nil", raw: "(Nil)" });
    expect(row.paymentReceived).toMatchObject({ kind: "nil" });
    expect(row.issues.filter((issue) => issue.code === "nil-marker")).toHaveLength(2);
  });

  it("parses a text date and says it arrived as text", () => {
    const result = readNarSheet(
      baseSheet({ 4: { B: "X10002", C: "HARBOUR LIGHT LIMITED", G: 45919, H: "5/9/2025" } }),
      false,
    );
    const row = rowFor(result, "X10002");
    expect(row.brDue).toMatchObject({ kind: "text", iso: "2025-09-05" });
    expect(row.issues.map((issue) => issue.code)).toContain("date-arrived-as-text");
  });

  it("keeps a payment note verbatim and surfaces it for confirmation", () => {
    const result = readNarSheet(
      baseSheet({
        4: {
          B: "X10003",
          C: "EVERGREEN TRADING LIMITED",
          F: "27/8/2025 (Ceredit fr deposit)",
          G: 45933,
        },
      }),
      false,
    );
    const row = rowFor(result, "X10003");
    expect(row.paymentReceived).toMatchObject({ kind: "text", iso: "2025-08-27" });
    const note = row.issues.find((issue) => issue.code === "date-carries-note");
    expect(note?.message).toContain("(Ceredit fr deposit)");
  });

  it("treats an absent BR due date as unknown rather than as no obligation", () => {
    const result = readNarSheet(
      baseSheet({ 4: { B: "X10002", C: "HARBOUR LIGHT LIMITED", G: 45919 } }),
      false,
    );
    expect(rowFor(result, "X10002").brDue).toEqual({ kind: "absent" });
  });

  it("blocks a row that has no AR due date, which is the deadline the case is built on", () => {
    const result = readNarSheet(
      baseSheet({ 4: { B: "X10002", C: "HARBOUR LIGHT LIMITED" } }),
      false,
    );
    const row = rowFor(result, "X10002");
    expect(row.issues).toContainEqual(
      expect.objectContaining({ code: "ar-due-missing", severity: "blocking" }),
    );
  });

  // The supplied worksheet has one invoice number on two different companies, so
  // the invoice number can never be an identity or a dedupe key.
  it("flags a duplicate invoice number for attention without treating it as a match", () => {
    const result = readNarSheet(
      baseSheet({
        4: { B: "X10002", C: "HARBOUR LIGHT LIMITED", E: "INV-1", G: 45919 },
      }),
      false,
    );
    for (const clientId of ["X10001", "X10002"]) {
      const issue = rowFor(result, clientId).issues.find(
        (candidate) => candidate.code === "duplicate-invoice-number",
      );
      expect(issue?.severity).toBe("attention");
    }
  });

  // A client id identifies one company, so two rows claiming it cannot both be
  // right and neither may be applied.
  it("blocks both rows when a client id appears twice", () => {
    const result = readNarSheet(
      baseSheet({ 4: { B: "X10001", C: "SUNRISE HOLDINGS LIMITED", G: 45919 } }),
      false,
    );
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.issues).toContainEqual(
        expect.objectContaining({ code: "duplicate-client-id", severity: "blocking" }),
      );
    }
  });

  it("records a payment after the AR due date as observed, not as late filing", () => {
    const result = readNarSheet(
      baseSheet({ 4: { B: "X10004", C: "NORTH POINT VENTURES LIMITED", F: 45966, G: 45929 } }),
      false,
    );
    const issue = rowFor(result, "X10004").issues.find(
      (candidate) => candidate.code === "payment-after-ar-due",
    );
    expect(issue?.severity).toBe("attention");
    expect(issue?.message).toContain("does not establish late filing");
  });

  it("flags a value the workbook computed rather than one the source asserted", () => {
    const result = readNarSheet(
      baseSheet({
        4: { B: "X10005", C: "PEAK ROAD LIMITED", G: 45919, E: { text: "INV-9", formula: true } },
      }),
      false,
    );
    expect(rowFor(result, "X10005").issues.map((issue) => issue.code)).toContain(
      "value-computed-by-workbook",
    );
  });

  it("refuses a sheet with no recognisable header instead of guessing columns", () => {
    const result = readNarSheet(sheet({ 1: { A: "some notes" }, 2: { A: "more notes" } }), false);
    expect(result.rows).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "header-not-found", severity: "blocking" }),
    );
  });
});

describe("dispositionFor", () => {
  const row = readNarSheet(baseSheet(), false).rows[0];

  it("is invalid when the row itself has a blocking problem", () => {
    const broken = readNarSheet(baseSheet({ 4: { B: "X9", C: "NO DUE DATE LIMITED" } }), false);
    expect(
      dispositionFor(rowFor(broken, "X9"), {
        matchedCompanyId: "company-1",
        existingCase: null,
        returnYear: 2025,
      }).disposition,
    ).toBe("invalid");
  });

  // The workbook has a client id and a name; companies needs six more NOT NULL
  // fields and two globally unique ones. So an unmatched row waits for a person.
  it("needs a company mapping when the external id matches nothing", () => {
    expect(
      dispositionFor(row, { matchedCompanyId: null, existingCase: null, returnYear: 2025 })
        .disposition,
    ).toBe("needsCompanyMapping");
  });

  it("is new when the company is known and has no case for the year", () => {
    expect(
      dispositionFor(row, { matchedCompanyId: "company-1", existingCase: null, returnYear: 2025 })
        .disposition,
    ).toBe("new");
  });

  it("is unchanged when the source agrees with the existing case", () => {
    expect(
      dispositionFor(row, {
        matchedCompanyId: "company-1",
        existingCase: {
          caseId: "case-1",
          returnYear: 2025,
          filingDueDate: "2025-09-13",
          hasStaffProgress: false,
        },
        returnYear: 2025,
      }).disposition,
    ).toBe("unchanged");
  });

  it("is updated when the source differs and nobody has worked the case yet", () => {
    const result = dispositionFor(row, {
      matchedCompanyId: "company-1",
      existingCase: {
        caseId: "case-1",
        returnYear: 2025,
        filingDueDate: "2025-09-20",
        hasStaffProgress: false,
      },
      returnYear: 2025,
    });
    expect(result.disposition).toBe("updated");
    expect(result.changes).toEqual([
      { field: "filingDueDate", from: "2025-09-20", to: "2025-09-13" },
    ]);
  });

  // Source-owned fields may update, but never over the top of human work without
  // a person seeing it first.
  it("is a conflict when the source would overwrite a case someone has worked", () => {
    const result = dispositionFor(row, {
      matchedCompanyId: "company-1",
      existingCase: {
        caseId: "case-1",
        returnYear: 2025,
        filingDueDate: "2025-09-20",
        hasStaffProgress: true,
      },
      returnYear: 2025,
    });
    expect(result.disposition).toBe("conflict");
    expect(result.issues.map((issue) => issue.code)).toContain("source-differs-from-worked-case");
  });

  // On the supplied worksheet the anniversary rule is one day out on one of the
  // 35 rows, so it is only ever shown as a cross-check.
  it("notes a disagreement with the anniversary rule but keeps the source value", () => {
    // The shape of row 27 in the supplied worksheet: incorporation 27/08 with a
    // source AR due date of 2025-10-07, where the rule would give 2025-10-08.
    const offBySemantics = readNarSheet(
      baseSheet({ 4: { B: "X10099", C: "ASIA PACIFIC LIMITED", D: "27/08", G: 45937 } }),
      false,
    );
    const result = dispositionFor(rowFor(offBySemantics, "X10099"), {
      matchedCompanyId: "company-1",
      existingCase: null,
      returnYear: 2025,
    });
    const note = result.issues.find(
      (issue) => issue.code === "ar-due-differs-from-anniversary-rule",
    );
    expect(note?.message).toContain("The source value is kept.");
    expect(note?.message).toContain("2025-10-08");
    expect(note?.severity).toBe("attention");
  });

  it("says nothing about the rule on a row where the source already agrees with it", () => {
    // Row 3: incorporation 02/08, source AR due 2025-09-13, which is exactly
    // anniversary plus 42. Most rows look like this, and a note on every one of
    // them would bury the one that matters.
    const result = dispositionFor(row, {
      matchedCompanyId: "company-1",
      existingCase: null,
      returnYear: 2025,
    });
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "ar-due-differs-from-anniversary-rule",
    );
  });
});
