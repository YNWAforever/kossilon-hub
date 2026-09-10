import { describe, expect, it } from "vitest";
import {
  anniversaryPlus42,
  excelSerialToIsoDate,
  isNilMarker,
  isoOf,
  normalizeDateCell,
  normalizeDayMonthCell,
  parseDayMonthText,
  parseSlashDateText,
} from "./normalize";
import type { WorkbookCell } from "./xlsx/workbook";

function cell(overrides: Partial<WorkbookCell> & { text: string }): WorkbookCell {
  return {
    ref: "F23",
    column: "F",
    row: 23,
    type: "s",
    raw: overrides.text,
    dateFormatted: true,
    fromFormula: false,
    ...overrides,
  };
}

function numericCell(value: number): WorkbookCell {
  return cell({ text: String(value), type: "n", raw: String(value), numeric: value });
}

describe("excelSerialToIsoDate", () => {
  // Anchored against values read from the supplied worksheet, cross-checked
  // independently before this code existed.
  it("converts the 1900-system serials the supplied worksheet actually contains", () => {
    expect(excelSerialToIsoDate(45913, false)).toBe("2025-09-13");
    expect(excelSerialToIsoDate(45905, false)).toBe("2025-09-05");
    expect(excelSerialToIsoDate(45941, false)).toBe("2025-10-11");
  });

  // Excel pretends 1900 was a leap year, so every serial above 60 is one day
  // ahead of a naive count and serial 60 denotes a day that never existed.
  it("refuses serial 60 rather than mapping it to a real day it does not mean", () => {
    expect(excelSerialToIsoDate(60, false)).toBeNull();
  });

  it("uses the pre-bug anchor below serial 60 and the post-bug anchor above it", () => {
    expect(excelSerialToIsoDate(1, false)).toBe("1900-01-01");
    expect(excelSerialToIsoDate(59, false)).toBe("1900-02-28");
    expect(excelSerialToIsoDate(61, false)).toBe("1900-03-01");
  });

  it("uses the 1904 epoch when the workbook declares it", () => {
    expect(excelSerialToIsoDate(0, true)).toBe("1904-01-01");
    // The same serial means a different day under each system; treating a 1904
    // workbook as 1900 shifts every date by more than four years.
    expect(excelSerialToIsoDate(45913, true)).not.toBe(excelSerialToIsoDate(45913, false));
  });

  it("drops a time-of-day fraction rather than rounding into the next day", () => {
    expect(excelSerialToIsoDate(45913.99, false)).toBe("2025-09-13");
  });

  it("refuses a negative or non-finite serial", () => {
    expect(excelSerialToIsoDate(-1, false)).toBeNull();
    expect(excelSerialToIsoDate(Number.NaN, false)).toBeNull();
  });
});

describe("parseDayMonthText", () => {
  it("parses the padded and unpadded forms the worksheet mixes", () => {
    expect(parseDayMonthText("02/08")).toMatchObject({ day: 2, month: 8 });
    // D37 in the supplied worksheet, the one row without a leading zero.
    expect(parseDayMonthText("30/8")).toMatchObject({ day: 30, month: 8, ambiguous: false });
  });

  it("reports a pair that could be read either way as ambiguous", () => {
    expect(parseDayMonthText("08/08")).toMatchObject({ day: 8, month: 8, ambiguous: true });
    expect(parseDayMonthText("05/09")).toMatchObject({ day: 5, month: 9, ambiguous: true });
  });

  it("refuses an impossible day for the month", () => {
    expect(parseDayMonthText("31/09")).toBeNull();
    expect(parseDayMonthText("30/02")).toBeNull();
  });

  it("refuses anything carrying a year, so a full date is never truncated", () => {
    expect(parseDayMonthText("30/8/2025")).toBeNull();
  });
});

describe("parseSlashDateText", () => {
  // H7 of the supplied worksheet: a text date in a date-formatted column.
  it("parses a day-first text date", () => {
    expect(parseSlashDateText("5/9/2025")).toMatchObject({ iso: "2025-09-05" });
  });

  // F23. The note is a bookkeeping fact about how the payment arrived and only
  // the firm can say what it means for the payment's status.
  it("keeps a trailing note verbatim beside the parsed date", () => {
    expect(parseSlashDateText("27/8/2025 (Ceredit fr deposit)")).toMatchObject({
      iso: "2025-08-27",
      note: "(Ceredit fr deposit)",
    });
  });

  it("refuses a two-digit year rather than windowing it into a century", () => {
    expect(parseSlashDateText("5/9/25")).toBeNull();
  });

  it("refuses a date that does not exist", () => {
    expect(parseSlashDateText("31/9/2025")).toBeNull();
    expect(parseSlashDateText("29/2/2025")).toBeNull();
  });

  it("accepts a real leap day", () => {
    expect(parseSlashDateText("29/2/2024")).toMatchObject({ iso: "2024-02-29" });
  });

  // The locale trap: new Date("5/9/2025") is September 5th in Hong Kong and
  // May 9th in the United States. This parser is day-first everywhere.
  it("reads day-first regardless of host locale", () => {
    expect(parseSlashDateText("5/9/2025")?.iso).toBe("2025-09-05");
    expect(parseSlashDateText("9/5/2025")?.iso).toBe("2025-05-09");
  });
});

describe("normalizeDateCell", () => {
  it("reports an absent cell as absent, not as a zero date", () => {
    expect(normalizeDateCell(undefined, false)).toEqual({ kind: "absent" });
    expect(normalizeDateCell(cell({ text: "   " }), false)).toEqual({ kind: "absent" });
  });

  // Never paid, never unpaid, never cancelled -- the firm has not told us yet.
  it("preserves (Nil) as its own kind rather than mapping it to a payment state", () => {
    expect(normalizeDateCell(cell({ text: "(Nil)" }), false)).toEqual({
      kind: "nil",
      raw: "(Nil)",
    });
  });

  it("keeps a serial and its resolved date together", () => {
    expect(normalizeDateCell(numericCell(45905), false)).toMatchObject({
      kind: "serial",
      iso: "2025-09-05",
      serial: 45905,
    });
  });

  it("records a text date as text, so a reviewer can see which form arrived", () => {
    expect(normalizeDateCell(cell({ text: "5/9/2025" }), false)).toMatchObject({
      kind: "text",
      iso: "2025-09-05",
      raw: "5/9/2025",
    });
  });

  it("reports an unreadable value with a reason instead of dropping it", () => {
    expect(normalizeDateCell(cell({ text: "ask Iris" }), false)).toMatchObject({
      kind: "unparsed",
      raw: "ask Iris",
    });
  });

  it("names the 1900 leap-year bug when it is the reason", () => {
    expect(normalizeDateCell(numericCell(60), false)).toMatchObject({
      kind: "unparsed",
      reason: expect.stringContaining("1900-02-29"),
    });
  });

  it("exposes the settled date only for the kinds that have one", () => {
    expect(isoOf(normalizeDateCell(numericCell(45905), false))).toBe("2025-09-05");
    expect(isoOf(normalizeDateCell(cell({ text: "(Nil)" }), false))).toBeNull();
    expect(isoOf(normalizeDateCell(undefined, false))).toBeNull();
  });
});

describe("normalizeDayMonthCell", () => {
  it("parses the incorporation column and leaves the year unknown", () => {
    const result = normalizeDayMonthCell(cell({ text: "30/8" }));
    expect(result).toMatchObject({ kind: "dayMonth", day: 30, month: 8 });
    expect(result).not.toHaveProperty("year");
    expect(result).not.toHaveProperty("iso");
  });

  // A serial here would mean the source changed shape; truncating it silently
  // would hide that.
  it("refuses a date serial in the day/month column rather than truncating it", () => {
    expect(normalizeDayMonthCell(numericCell(45913))).toMatchObject({
      kind: "unparsed",
      reason: expect.stringContaining("day/month"),
    });
  });

  it("reports an absent incorporation cell as absent", () => {
    expect(normalizeDayMonthCell(undefined)).toEqual({ kind: "absent" });
  });
});

describe("anniversaryPlus42", () => {
  // Row 3 of the supplied worksheet: incorporation 02/08.
  it("computes the anniversary-plus-42 candidate", () => {
    expect(anniversaryPlus42({ day: 2, month: 8 }, 2025)?.iso).toBe("2025-09-13");
  });

  // The whole reason this is only ever a cross-check: on the supplied worksheet
  // the rule is one day out on row 27 (incorporation 27/08, source AR due
  // 2025-10-07, rule gives 2025-10-08). Recomputing column G from column D would
  // silently corrupt that record.
  it("gives the value that disagrees with the source on the one row it disagrees on", () => {
    expect(anniversaryPlus42({ day: 27, month: 8 }, 2025)?.iso).toBe("2025-10-08");
  });

  it("returns nothing rather than a wrong answer for an impossible anniversary", () => {
    expect(anniversaryPlus42({ day: 29, month: 2 }, 2025)).toBeNull();
  });
});

describe("isNilMarker", () => {
  it("matches the marker whatever its casing or padding", () => {
    expect(isNilMarker("(Nil)")).toBe(true);
    expect(isNilMarker("  (NIL) ")).toBe(true);
    expect(isNilMarker("nil")).toBe(false);
    expect(isNilMarker("")).toBe(false);
  });
});
