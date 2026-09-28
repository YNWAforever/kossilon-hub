/** Synthetic OOXML fixture for import worker tests; never includes real client data. */
const encoder = new TextEncoder();
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStored(files: { name: string; content: string }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((total, bytes) => total + bytes.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}
function inlineCell(column: string, row: number, value: string): string {
  return `<c r="${column}${row}" t="inlineStr"><is><t>${value}</t></is></c>`;
}
/** Generate 10k real XLSX rows without a production workbook or company records. */
export function syntheticNarWorkbook(rowCount: number): Uint8Array {
  const headers = [
    ["B", "Client ID"],
    ["C", "Name"],
    ["D", "Date of Incorp"],
    ["E", "Invoice no."],
    ["F", "Payment Rcvd Date"],
    ["G", "AR Due Date"],
    ["H", "BR Due Date"],
  ];
  const rows = [
    `<row r="1">${headers.map(([column, label]) => inlineCell(column, 1, label)).join("")}</row>`,
  ];
  for (let index = 0; index < rowCount; index += 1) {
    const row = index + 2;
    rows.push(
      `<row r="${row}">${inlineCell("B", row, `T27-${index}`)}${inlineCell("C", row, `Fixture ${index}`)}<c r="G${row}"><v>45913</v></c></row>`,
    );
  }
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
  return zipStored([
    { name: "[Content_Types].xml", content: `<?xml version="1.0"?><Types/>` },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0"?><workbook><sheets><sheet name="Monthly" sheetId="1"/></sheets></workbook>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
  ]);
}
