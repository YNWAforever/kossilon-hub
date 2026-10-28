import { buildZip } from "../../test/xlsx-fixture";

export type MixedNarWorkbook = {
  bytes: Uint8Array;
  companyKeys: string[];
  validRowNumbers: number[];
  duplicateRowNumbers: number[];
  invalidRowNumbers: number[];
  keyForRow: Record<number, string>;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textCell(column: string, row: number, text: string): string {
  return `<c r="${column}${row}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/**
 * Test-only OOXML source for R26.4 parser-to-persistence acceptance. Every name
 * and identifier is invented; this function performs no I/O beyond ZIP compression.
 *
 * Rows 3..352: 350 distinct valid keys; 353..452: 50 duplicate pairs;
 * 453..477: 25 blank names; 478..502: 25 absent AR due dates. Keys use zero-based
 * indexes within their category. Duplicate keys are never shared with valid rows.
 * All 450 keys are exposed for explicit mapping by the isolated SQL test.
 */
export async function buildMixedNarWorkbook(tag: string): Promise<MixedNarWorkbook> {
  const companyKeys: string[] = [];
  const validRowNumbers: number[] = [];
  const duplicateRowNumbers: number[] = [];
  const invalidRowNumbers: number[] = [];
  const keyForRow: Record<number, string> = {};
  const rows = [
    `<row r="1">${textCell("A", 1, "Synthetic Annual Return 2025")}</row>`,
    `<row r="2">${[
      ["B", "Client ID"],
      ["C", "Name"],
      ["D", "Date of Incorp"],
      ["E", "Invoice no."],
      ["F", "Payment Rcvd Date"],
      ["G", "AR Due Date"],
      ["H", "BR Due Date"],
    ]
      .map(([column, header]) => textCell(column, 2, header))
      .join("")}</row>`,
  ];

  for (let index = 0; index < 500; index += 1) {
    const rowNumber = index + 3;
    let key: string;
    if (index < 350) {
      key = `${tag}-v-${index}`;
      validRowNumbers.push(rowNumber);
      companyKeys.push(key);
    } else if (index < 450) {
      key = `${tag}-d-${Math.floor((index - 350) / 2)}`;
      duplicateRowNumbers.push(rowNumber);
      if (index % 2 === 0) companyKeys.push(key);
    } else if (index < 475) {
      key = `${tag}-n-${index - 450}`;
      invalidRowNumbers.push(rowNumber);
      companyKeys.push(key);
    } else {
      key = `${tag}-a-${index - 475}`;
      invalidRowNumbers.push(rowNumber);
      companyKeys.push(key);
    }
    keyForRow[rowNumber] = key;

    // Give both rows in a duplicate pair the same invented name. The invalid
    // name rows still carry IDs and all other cells, so the parser must retain them.
    const nameIndex = index >= 350 && index < 450 ? 351 + Math.floor((index - 350) / 2) : index + 1;
    const companyName = index >= 450 && index < 475 ? "" : `Synthetic 企業 & Co <${nameIndex}>`;
    rows.push(
      `<row r="${rowNumber}">${[
        textCell("B", rowNumber, key),
        textCell("C", rowNumber, companyName),
        textCell("D", rowNumber, "01/01"),
        textCell("E", rowNumber, "SHARED-XLSX-INVOICE"),
        textCell("F", rowNumber, "1/3/2025 (credit note)"),
        ...(index < 475 ? [textCell("G", rowNumber, "15/2/2025")] : []),
      ].join("")}</row>`,
    );
  }

  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const spreadsheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const officeRelsNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageRelsNs = "http://schemas.openxmlformats.org/package/2006/relationships";
  const bytes = await buildZip([
    {
      name: "[Content_Types].xml",
      content: `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `${declaration}<Relationships xmlns="${packageRelsNs}"><Relationship Id="rId1" Type="${officeRelsNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `${declaration}<workbook xmlns="${spreadsheetNs}" xmlns:r="${officeRelsNs}"><workbookPr date1904="0"/><sheets><sheet name="8.2025" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `${declaration}<Relationships xmlns="${packageRelsNs}"><Relationship Id="rId1" Type="${officeRelsNs}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `${declaration}<worksheet xmlns="${spreadsheetNs}"><dimension ref="A1:H502"/><sheetData>${rows.join("")}</sheetData></worksheet>`,
    },
  ]);

  return {
    bytes,
    companyKeys,
    validRowNumbers,
    duplicateRowNumbers,
    invalidRowNumbers,
    keyForRow,
  };
}
