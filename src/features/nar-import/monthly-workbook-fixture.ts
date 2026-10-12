import { buildZip } from "@/test/xlsx-fixture";
const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** No customer data: the monthly layout with 500 individually identifiable source rows. */
export async function monthlyWorkbookFixture(tag: string, n: number, edges = false) {
  const cells = (row: number, values: string[]) =>
    `<row r="${row}">${values.map((value, i) => `<c r="${String.fromCharCode(66 + i)}${row}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join("")}</row>`;
  const header = cells(2, [
    "Client ID",
    "Name",
    "Date of Incorp",
    "Invoice No",
    "Payment Rcvd Date",
    "AR Due Date",
    "BR Due Date",
  ]);
  const rows = Array.from({ length: n }, (_, i) =>
    cells(i + 3, [
      `${tag}-${edges && i === 1 ? 0 : i}`,
      edges && i === 3 ? "" : "Synthetic NAR company",
      "01/01",
      "DUPLICATE-INVOICE",
      "1/3/2025 (credit note)",
      edges && i === 2 ? "31/02/2025" : "15/2/2025",
      "",
    ]),
  );
  return buildZip([
    {
      name: "[Content_Types].xml",
      content:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: "xl/workbook.xml",
      content:
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="8.2025" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="B2:H${n + 2}"/><sheetData>${header}${rows.join("")}</sheetData></worksheet>`,
    },
  ]);
}
