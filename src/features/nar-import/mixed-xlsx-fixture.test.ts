import { beforeAll, describe, expect, it } from "vitest";
import { dispositionFor, readNarSheet, type NarSheetReadResult } from "./mapping";
import { buildMixedNarWorkbook } from "./mixed-xlsx-fixture";
import { readXlsxWorkbook, type Workbook } from "./xlsx/workbook";
import { openZipArchive } from "./xlsx/zip";

const TAG = "cosec-parser-500";
const rowRange = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => start + index);

describe("R26.4 mixed 500-row XLSX through the real workbook and NAR readers", () => {
  let fixture: Awaited<ReturnType<typeof buildMixedNarWorkbook>>;
  let workbook: Workbook;
  let read: NarSheetReadResult;
  let sheetXml: string;

  beforeAll(async () => {
    fixture = await buildMixedNarWorkbook(TAG);
    workbook = await readXlsxWorkbook(fixture.bytes);
    const sheet = workbook.sheet("8.2025");
    if (!sheet) throw new Error("The generated OOXML workbook has no 8.2025 sheet.");
    read = readNarSheet(sheet, workbook.date1904);
    sheetXml = new TextDecoder().decode(
      await openZipArchive(fixture.bytes).read("xl/worksheets/sheet1.xml"),
    );
  });

  it("contains genuine compressed OOXML parts and exactly 500 physical data rows", () => {
    expect([...fixture.bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const archive = openZipArchive(fixture.bytes);
    expect([...archive.entries.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect([...archive.entries.values()].every((entry) => entry.compressionMethod === 8)).toBe(
      true,
    );
    expect(
      [...sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((match) => Number(match[1])),
    ).toEqual(rowRange(1, 502));
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["8.2025"]);
    expect(workbook.date1904).toBe(false);
    expect(workbook.sheet("8.2025")?.dimension).toBe("A1:H502");
    expect([...workbook.sheet("8.2025")!.rows.keys()].filter((row) => row >= 3)).toEqual(
      rowRange(3, 500),
    );
    expect(read.headerRowNumber).toBe(2);
    expect(read.columns).toEqual({
      clientId: "B",
      companyName: "C",
      incorporation: "D",
      invoice: "E",
      paymentReceived: "F",
      arDue: "G",
      brDue: "H",
    });
    expect(read.rows.map((row) => row.rowNumber)).toEqual(rowRange(3, 500));
    expect(read.skippedRowNumbers).toEqual([]);
    expect(read.issues).toEqual([]);
  });

  it("exposes 450 exact company keys with 50 duplicate pairs separate from 350 valid keys", () => {
    expect(fixture.validRowNumbers).toEqual(rowRange(3, 350));
    expect(fixture.duplicateRowNumbers).toEqual(rowRange(353, 100));
    expect(fixture.invalidRowNumbers).toEqual(rowRange(453, 50));
    expect(Object.keys(fixture.keyForRow).map(Number)).toEqual(rowRange(3, 500));
    expect(fixture.companyKeys).toHaveLength(450);
    expect(new Set(fixture.companyKeys).size).toBe(450);
    expect(fixture.companyKeys).toEqual([
      ...Array.from({ length: 350 }, (_, index) => `${TAG}-v-${index}`),
      ...Array.from({ length: 50 }, (_, index) => `${TAG}-d-${index}`),
      ...Array.from({ length: 25 }, (_, index) => `${TAG}-n-${index}`),
      ...Array.from({ length: 25 }, (_, index) => `${TAG}-a-${index}`),
    ]);
    const rowsByKey = new Map<string, number[]>();
    for (const row of read.rows) {
      expect(row.externalClientId).toBe(fixture.keyForRow[row.rowNumber]);
      rowsByKey.set(row.externalClientId, [
        ...(rowsByKey.get(row.externalClientId) ?? []),
        row.rowNumber,
      ]);
    }
    expect([...rowsByKey.keys()]).toEqual(fixture.companyKeys);
    expect([...rowsByKey.values()].filter((rows) => rows.length === 1)).toHaveLength(400);
    expect([...rowsByKey.values()].filter((rows) => rows.length === 2)).toHaveLength(50);
    for (let index = 0; index < 50; index += 1) {
      expect(rowsByKey.get(`${TAG}-d-${index}`)).toEqual([353 + index * 2, 354 + index * 2]);
    }
  });

  it("retains all invalid rows and flags precisely the duplicate IDs, blank names and missing AR dates", () => {
    const blocking = read.rows.flatMap((row) =>
      row.issues
        .filter((issue) => issue.severity === "blocking")
        .map((issue) => ({ rowNumber: row.rowNumber, code: issue.code })),
    );
    expect(blocking).toHaveLength(150);
    expect(blocking).toEqual([
      ...rowRange(353, 100).map((rowNumber) => ({ rowNumber, code: "duplicate-client-id" })),
      ...rowRange(453, 25).map((rowNumber) => ({ rowNumber, code: "company-name-missing" })),
      ...rowRange(478, 25).map((rowNumber) => ({ rowNumber, code: "ar-due-missing" })),
    ]);
    expect(read.rows.filter((row) => row.companyName === "").map((row) => row.rowNumber)).toEqual(
      rowRange(453, 25),
    );
    expect(
      read.rows.filter((row) => row.arDue.kind === "absent").map((row) => row.rowNumber),
    ).toEqual(rowRange(478, 25));
  });

  it("treats the shared invoice as attention rather than company identity or blocking valid rows", () => {
    expect(new Set(read.rows.map((row) => row.invoice.raw))).toEqual(
      new Set(["SHARED-XLSX-INVOICE"]),
    );
    for (const row of read.rows) {
      expect(row.invoice.kind).toBe("value");
      expect(row.issues.filter((issue) => issue.code === "duplicate-invoice-number")).toEqual([
        expect.objectContaining({ severity: "attention" }),
      ]);
      expect(
        dispositionFor(row, {
          matchedCompanyId: `mapped-${row.externalClientId}`,
          existingCase: null,
          returnYear: 2025,
        }).disposition,
      ).toBe(row.rowNumber <= 352 ? "new" : "invalid");
    }
  });

  it("preserves the credit note as source evidence with attention on every row", () => {
    for (const row of read.rows) {
      expect(row.incorporation).toMatchObject({
        kind: "dayMonth",
        day: 1,
        month: 1,
        raw: "01/01",
      });
      expect(row.paymentReceived).toEqual({
        kind: "text",
        iso: "2025-03-01",
        raw: "1/3/2025 (credit note)",
        note: "(credit note)",
        ambiguous: true,
      });
      expect(row.raw.F).toEqual({
        ref: `F${row.rowNumber}`,
        type: "inlineStr",
        text: "1/3/2025 (credit note)",
        dateFormatted: false,
        fromFormula: false,
      });
      expect(row.issues).toContainEqual(
        expect.objectContaining({
          code: "date-carries-note",
          column: "F",
          severity: "attention",
        }),
      );
      expect(row.issues).toContainEqual(
        expect.objectContaining({
          code: "date-arrived-as-text",
          column: "F",
          severity: "attention",
        }),
      );
      if (row.rowNumber < 478) {
        expect(row.arDue).toEqual({
          kind: "text",
          iso: "2025-02-15",
          raw: "15/2/2025",
          ambiguous: false,
        });
        expect(row.issues).toContainEqual(
          expect.objectContaining({ code: "payment-after-ar-due", severity: "attention" }),
        );
      }
      expect(row.brDue).toEqual({ kind: "absent" });
      expect(row.raw.H).toBeUndefined();
    }
  });

  it("round-trips UTF-8 and XML metacharacters through ZIP bytes without adding cells or rows", async () => {
    expect(sheetXml).toContain("Synthetic 企業 &amp; Co &lt;1&gt;");
    expect(read.rows[0].companyName).toBe("Synthetic 企業 & Co <1>");
    expect(read.rows[0].raw.C.text).toBe("Synthetic 企業 & Co <1>");
    const escapedTag = `cosec-parser-&<"'>`;
    const escaped = await buildMixedNarWorkbook(escapedTag);
    const escapedWorkbook = await readXlsxWorkbook(escaped.bytes);
    const escapedRead = readNarSheet(escapedWorkbook.sheet("8.2025")!, escapedWorkbook.date1904);
    expect(escapedRead.rows).toHaveLength(500);
    expect(escapedRead.rows.map((row) => row.externalClientId)).toEqual(
      Object.values(escaped.keyForRow),
    );
    expect(escapedRead.rows[0].externalClientId).toBe(`${escapedTag}-v-0`);
    expect(escapedRead.rows[0].raw.B.text).toBe(`${escapedTag}-v-0`);
    expect(escapedRead.rows[0].companyName).toBe("Synthetic 企業 & Co <1>");
    expect([...escapedWorkbook.sheet("8.2025")!.rows.get(3)!.keys()]).toEqual([
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
  });
});
