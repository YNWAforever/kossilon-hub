import { openZipArchive, ZipFormatError } from "./zip";

/**
 * A minimal, read-only OOXML workbook reader.
 *
 * It reads five entries and nothing else. Most of what a general spreadsheet
 * library does is exactly what must not happen to an untrusted file arriving
 * from another firm's system: evaluate formulas, follow external workbook links,
 * run macros, or interpret embedded content.
 *
 * Formulas are the clearest case. A `<c>` element can carry both an `<f>` and a
 * cached `<v>`. This reader never looks at `<f>` -- there is no evaluator here to
 * misuse -- and it marks any cell that carried one, because a value the workbook
 * computed is not a value the source system asserted, and a staff member
 * confirming an import should be told the difference.
 *
 * Everything is returned with its OOXML type intact. Nothing is coerced: a date
 * that arrived as text stays text, a serial stays a number, and the caller
 * decides what either means. That is deliberate -- the supplied Kossilon
 * worksheet has a text date sitting in a date-formatted column beside real
 * serials, and a reader that silently normalised both would destroy the evidence
 * that they differ.
 */

export const XLSX_PARSER_VERSION = "kossilon-xlsx-1";

export class XlsxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxFormatError";
  }
}

export type WorkbookCellType = "s" | "n" | "b" | "str" | "inlineStr" | "e";

export type WorkbookCell = {
  /** e.g. "F23" */
  ref: string;
  /** e.g. "F" */
  column: string;
  row: number;
  type: WorkbookCellType;
  /** The literal `<v>` text, or the assembled inline string. Never coerced. */
  raw: string;
  /** Resolved through sharedStrings for `t="s"`; otherwise the same as raw. */
  text: string;
  /** Present only when the cell is numeric and the value parses finitely. */
  numeric?: number;
  /** The cell's style applies a date/time number format. */
  dateFormatted: boolean;
  /** The cell carried an `<f>`; this value was computed, not asserted. */
  fromFormula: boolean;
};

export type WorkbookSheet = {
  name: string;
  /** The sheet's declared dimension, e.g. "A1:CO65". Advisory only. */
  dimension?: string;
  /** Row number to its non-empty cells, keyed by column letter. */
  rows: Map<number, Map<string, WorkbookCell>>;
};

export type Workbook = {
  parserVersion: string;
  /** The 1904 date system flag. Read, never assumed. */
  date1904: boolean;
  sheets: WorkbookSheet[];
  sheet(name: string): WorkbookSheet | undefined;
};

const decoder = new TextDecoder("utf-8");

/**
 * Only the five predefined XML entities are expanded.
 *
 * Numeric character references are decoded, but anything else -- a custom or
 * external entity -- is left as literal text rather than resolved. That closes
 * XXE and billion-laughs by not implementing them at all.
 */
function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        break;
    }
    const codePoint = entity.startsWith("#x")
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match;
  });
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeXmlText(match[1]) : undefined;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // A shared string is split across <t> runs when parts of it are formatted
    // differently. Concatenating the runs is the whole string; taking the first
    // would silently truncate a company name at a bold character.
    const runs = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((run) =>
      decodeXmlText(run[1]),
    );
    strings.push(runs.join(""));
  }
  return strings;
}

/**
 * Which style indices carry a date/time number format.
 *
 * Built-in numFmtIds 14-22 and 45-47 are dates and times; anything else is a
 * date only if its custom format code contains an unquoted d, m or y. This is
 * what tells a bare serial like 45905 apart from a quantity.
 */
function parseDateFormattedStyles(xml: string): Set<number> {
  const customDateFormats = new Set<number>();
  for (const format of xml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const id = Number(attribute(format[0], "numFmtId"));
    const code = attribute(format[0], "formatCode") ?? "";
    // Strip quoted literals before looking for date letters, so a currency
    // format carrying a quoted "d" is not mistaken for a date.
    const withoutLiterals = code.replace(/"[^"]*"/g, "").replace(/\\./g, "");
    if (Number.isFinite(id) && /[dmy]/i.test(withoutLiterals)) customDateFormats.add(id);
  }

  const cellXfsBlock = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  const dateStyles = new Set<number>();
  let styleIndex = 0;
  for (const xf of cellXfsBlock.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const numFmtId = Number(attribute(xf[0], "numFmtId") ?? "0");
    const isBuiltInDate = (numFmtId >= 14 && numFmtId <= 22) || (numFmtId >= 45 && numFmtId <= 47);
    if (isBuiltInDate || customDateFormats.has(numFmtId)) dateStyles.add(styleIndex);
    styleIndex += 1;
  }
  return dateStyles;
}

function parseSheet(
  name: string,
  xml: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
): WorkbookSheet {
  const rows = new Map<number, Map<string, WorkbookCell>>();
  const dimension = attribute(/<dimension\b[^>]*\/?>/.exec(xml)?.[0] ?? "", "ref");

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attribute(`<row${rowMatch[1]}>`, "r"));
    if (!Number.isInteger(rowNumber)) continue;
    const cells = new Map<string, WorkbookCell>();

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = `<c${cellMatch[1]}>`;
      const inner = cellMatch[2] ?? "";
      const ref = attribute(attributes, "r");
      if (!ref) continue;
      const column = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase();
      if (!column) continue;

      const type = (attribute(attributes, "t") ?? "n") as WorkbookCellType;
      const styleIndex = Number(attribute(attributes, "s") ?? "0");
      // `<f>` is located only so its presence can be recorded. Its content is
      // never read, and there is no evaluator in this module to read it with.
      const fromFormula = /<f\b/.test(inner);

      const valueText = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const inlineText = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((run) => decodeXmlText(run[1]))
        .join("");

      let raw: string;
      let text: string;
      if (type === "inlineStr") {
        raw = inlineText;
        text = inlineText;
      } else if (valueText === undefined) {
        // No value at all. Rows 38-65 of the supplied worksheet are exactly this:
        // cells that exist to carry formatting. Skipping them here is what stops
        // a record count of 65 where the truth is 35.
        continue;
      } else if (type === "s") {
        const index = Number(decodeXmlText(valueText));
        raw = decodeXmlText(valueText);
        text = sharedStrings[index] ?? "";
      } else {
        raw = decodeXmlText(valueText);
        text = raw;
      }

      const numericCandidate = type === "n" || type === "b" ? Number(raw) : Number.NaN;
      cells.set(column, {
        ref,
        column,
        row: rowNumber,
        type,
        raw,
        text,
        ...(Number.isFinite(numericCandidate) ? { numeric: numericCandidate } : {}),
        dateFormatted: dateStyles.has(styleIndex),
        fromFormula,
      });
    }

    if (cells.size > 0) rows.set(rowNumber, cells);
  }

  return { name, ...(dimension ? { dimension } : {}), rows };
}

export async function readXlsxWorkbook(bytes: Uint8Array): Promise<Workbook> {
  let archive;
  try {
    archive = openZipArchive(bytes);
  } catch (error) {
    if (error instanceof ZipFormatError) throw new XlsxFormatError(error.message);
    throw error;
  }

  const names = [...archive.entries.keys()];

  // Refused outright rather than ignored, so an operator knows the file they
  // handed over is not the file that was read.
  if (names.some((name) => name.toLowerCase().includes("vbaproject.bin"))) {
    throw new XlsxFormatError(
      "This workbook contains macros. Save it as a plain .xlsx and try again.",
    );
  }
  if (names.some((name) => name.toLowerCase().startsWith("xl/externallinks/"))) {
    throw new XlsxFormatError(
      "This workbook links to other workbooks. Those links are not followed; save a copy with values only.",
    );
  }
  if (!archive.entries.has("[Content_Types].xml")) {
    throw new XlsxFormatError("Not an Office Open XML workbook.");
  }
  if (!archive.entries.has("xl/workbook.xml")) {
    throw new XlsxFormatError("Workbook part is missing.");
  }

  const workbookXml = decoder.decode(await archive.read("xl/workbook.xml"));

  // Read, never assumed. A workbook saved on a Mac before 2016 counts days from
  // 1904, and treating its serials as 1900 shifts every date by four years.
  const date1904 = /date1904="(1|true)"/i.test(workbookXml);

  const relationships = new Map<string, string>();
  if (archive.entries.has("xl/_rels/workbook.xml.rels")) {
    const relsXml = decoder.decode(await archive.read("xl/_rels/workbook.xml.rels"));
    for (const rel of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = attribute(rel[0], "Id");
      const target = attribute(rel[0], "Target");
      if (id && target) relationships.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  const sharedStrings = archive.entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(decoder.decode(await archive.read("xl/sharedStrings.xml")))
    : [];
  const dateStyles = archive.entries.has("xl/styles.xml")
    ? parseDateFormattedStyles(decoder.decode(await archive.read("xl/styles.xml")))
    : new Set<number>();

  const sheets: WorkbookSheet[] = [];
  const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)];
  for (const [index, tag] of sheetTags.entries()) {
    const sheetName = attribute(tag[0], "name") ?? `Sheet${index + 1}`;
    const relationshipId = attribute(tag[0], "r:id") ?? attribute(tag[0], "id");
    const target = relationshipId ? relationships.get(relationshipId) : undefined;
    const entryName = target ? `xl/${target}` : `xl/worksheets/sheet${index + 1}.xml`;
    if (!archive.entries.has(entryName)) continue;
    const sheetXml = decoder.decode(await archive.read(entryName));
    sheets.push(parseSheet(sheetName, sheetXml, sharedStrings, dateStyles));
  }

  if (sheets.length === 0) throw new XlsxFormatError("Workbook contains no readable sheets.");

  return {
    parserVersion: XLSX_PARSER_VERSION,
    date1904,
    sheets,
    sheet: (name: string) => sheets.find((candidate) => candidate.name === name),
  };
}
