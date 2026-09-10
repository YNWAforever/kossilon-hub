import type { WorkbookCell } from "./xlsx/workbook";

/**
 * Turning workbook cells into dates, without inventing anything.
 *
 * Every function here reports what it could not determine rather than choosing a
 * plausible value. That is the whole point: the supplied worksheet carries a
 * day-and-month with no year, a text date beside real serials, a date with a
 * bookkeeping note stuck to it, and a `(Nil)` marker that means something only
 * the firm can tell us. Guessing at any of them would put a fabricated date in
 * front of a filing deadline.
 *
 * Nothing here calls `new Date(string)`. Its behaviour on `5/9/2025` depends on
 * the host locale -- September 5th in Hong Kong, May 9th in the United States --
 * and a silent six-week error on an annual-return deadline is exactly the class
 * of bug this module exists to prevent.
 */

/** The literal the supplied worksheet uses where a value is deliberately absent. */
export const NIL_MARKER = "(Nil)";

export function isNilMarker(value: string): boolean {
  return value.trim().toLowerCase() === NIL_MARKER.toLowerCase();
}

const MS_PER_DAY = 86_400_000;

/**
 * Excel's 1900 system pretends 1900 was a leap year, so serial 60 denotes
 * 1900-02-29, a date that does not exist. Serials at or above 61 are therefore
 * one day ahead of a naive count and are anchored to 1899-12-30; serials 1..59
 * are anchored to 1899-12-31. Serial 60 itself is refused rather than mapped to
 * a real day it does not mean.
 *
 * The 1904 system has no such quirk: serial 0 is 1904-01-01.
 */
export function excelSerialToIsoDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  // The fractional part is a time of day; whole days are all this domain uses.
  const days = Math.floor(serial);
  if (days < 0) return null;

  let epochUtc: number;
  if (date1904) {
    epochUtc = Date.UTC(1904, 0, 1);
  } else {
    if (days === 60) return null;
    if (days < 1) return null;
    epochUtc = days > 60 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31);
  }

  const date = new Date(epochUtc + days * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export type DayMonth = { day: number; month: number };

/**
 * `02/08`, `8/8`, `30/8` -- a day and a month, with no year anywhere.
 *
 * The year is not returned because the workbook does not contain it. The
 * supplied sheet's incorporation column is exactly this, and inferring a year
 * from the return period would manufacture an incorporation date.
 *
 * Day-first because the source is a Hong Kong firm's worksheet whose companion
 * columns are formatted `d/m/yyyy`. An ambiguous pair is still parsed day-first
 * but the caller is told it was ambiguous.
 */
export function parseDayMonthText(value: string): (DayMonth & { ambiguous: boolean }) | null {
  const match = /^\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // A leap-year check needs a year, which we do not have; 29/2 is accepted as a
  // day-month pair and left for the caller to resolve when a year appears.
  if (month === 2 && day > 29) return null;
  if ([4, 6, 9, 11].includes(month) && day > 30) return null;
  return { day, month, ambiguous: day <= 12 };
}

export type SlashDate = { iso: string; note?: string; ambiguous: boolean };

/**
 * `5/9/2025`, and `27/8/2025 (Ceredit fr deposit)`.
 *
 * The trailing note is kept verbatim rather than discarded: it is a bookkeeping
 * fact about how the payment arrived, and only the firm can say what it means
 * for the payment's status.
 */
export function parseSlashDateText(value: string): SlashDate | null {
  const match = /^\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})\s*(.*)$/.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const trailing = match[4].trim();

  // A two-digit year is a guess whichever way it is resolved, so it is refused
  // rather than windowed into a century.
  if (match[3].length < 4) return null;
  if (!isRealCalendarDate(year, month, day)) return null;

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
  return {
    iso,
    ...(trailing ? { note: trailing } : {}),
    ambiguous: day <= 12 && month <= 12 && day !== month,
  };
}

/**
 * A date read from a cell, with its provenance.
 *
 * `serial` and `text` are held apart because they are different evidence: a
 * serial is a value the source system computed, while text is something a person
 * typed into a date-formatted cell, and a reviewer confirming an import should
 * see which one arrived.
 */
export type NormalizedDate =
  | { kind: "absent" }
  | { kind: "nil"; raw: string }
  | { kind: "serial"; iso: string; serial: number; raw: string }
  | { kind: "text"; iso: string; raw: string; note?: string; ambiguous: boolean }
  | { kind: "unparsed"; raw: string; reason: string };

export function normalizeDateCell(
  cell: WorkbookCell | undefined,
  date1904: boolean,
): NormalizedDate {
  if (!cell) return { kind: "absent" };
  const raw = cell.text;
  if (raw.trim() === "") return { kind: "absent" };
  if (isNilMarker(raw)) return { kind: "nil", raw };

  if (cell.numeric !== undefined && cell.type === "n") {
    const iso = excelSerialToIsoDate(cell.numeric, date1904);
    return iso
      ? { kind: "serial", iso, serial: cell.numeric, raw }
      : {
          kind: "unparsed",
          raw,
          reason:
            cell.numeric === 60 && !date1904
              ? "Excel serial 60 is 1900-02-29, which is not a real date."
              : "Number is not a usable date serial.",
        };
  }

  const parsed = parseSlashDateText(raw);
  if (parsed) {
    return {
      kind: "text",
      iso: parsed.iso,
      raw,
      ...(parsed.note ? { note: parsed.note } : {}),
      ambiguous: parsed.ambiguous,
    };
  }

  return { kind: "unparsed", raw, reason: "Not a recognised date." };
}

export type NormalizedDayMonth =
  | { kind: "absent" }
  | { kind: "nil"; raw: string }
  | { kind: "dayMonth"; day: number; month: number; raw: string; ambiguous: boolean }
  | { kind: "unparsed"; raw: string; reason: string };

/**
 * The incorporation column: a day and a month, and deliberately no year.
 *
 * A serial in this column is treated as a full date and rejected as
 * out-of-contract rather than truncated, because a serial here would mean the
 * source changed shape and a silent truncation would hide that.
 */
export function normalizeDayMonthCell(cell: WorkbookCell | undefined): NormalizedDayMonth {
  if (!cell) return { kind: "absent" };
  const raw = cell.text;
  if (raw.trim() === "") return { kind: "absent" };
  if (isNilMarker(raw)) return { kind: "nil", raw };

  if (cell.numeric !== undefined && cell.type === "n") {
    return {
      kind: "unparsed",
      raw,
      reason: "Expected a day/month like 02/08, found a date serial.",
    };
  }

  const parsed = parseDayMonthText(raw);
  if (!parsed) {
    return { kind: "unparsed", raw, reason: "Not a recognised day/month." };
  }
  return {
    kind: "dayMonth",
    day: parsed.day,
    month: parsed.month,
    raw,
    ambiguous: parsed.ambiguous,
  };
}

/** The ISO date this normalization settled on, if any. */
export function isoOf(value: NormalizedDate): string | null {
  return value.kind === "serial" || value.kind === "text" ? value.iso : null;
}

/**
 * The anniversary-plus-42-days rule, offered only as a cross-check.
 *
 * In the supplied worksheet this matches the source AR due date on 34 of 35 rows
 * and is one day out on the 35th. It is therefore never used to fill in or
 * correct a due date -- it exists so a reviewer can be shown "the source says X,
 * the usual rule would give Y" and decide.
 */
export function anniversaryPlus42(
  incorporation: DayMonth,
  returnYear: number,
): { iso: string } | null {
  if (!isRealCalendarDate(returnYear, incorporation.month, incorporation.day)) return null;
  const anniversary = Date.UTC(returnYear, incorporation.month - 1, incorporation.day);
  return { iso: new Date(anniversary + 42 * MS_PER_DAY).toISOString().slice(0, 10) };
}
