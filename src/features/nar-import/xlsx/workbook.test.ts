import { describe, expect, it } from "vitest";
import { readXlsxWorkbook, XlsxFormatError } from "./workbook";
import { openZipArchive, ZipFormatError } from "./zip";

/**
 * The fixtures here are built as genuine ZIP/OOXML bytes rather than committed as
 * a binary, for two reasons: the real Kossilon worksheet carries client names and
 * client ids that must never enter the repository, and a fixture written as code
 * shows a reviewer exactly which edge case each byte is for.
 *
 * The structure mirrors the supplied worksheet exactly -- shared strings, a
 * `d/m/yyyy;@` custom style, serial dates, a text date living in that same
 * date-formatted column, a date carrying a trailing note, `(Nil)` markers, blank
 * cells, and trailing rows that exist only to carry formatting. Only the names
 * and identifiers are invented.
 */

// ---------------------------------------------------------------------------
// A minimal ZIP writer, test-only.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type ZipInput = { name: string; content: string; store?: boolean };

async function buildZip(files: ZipInput[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = encoder.encode(file.content);
    const compressed = file.store ? raw : await deflateRaw(raw);
    const method = file.store ? 0 : 8;
    const nameBytes = encoder.encode(file.name);
    const checksum = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A workbook shaped like the supplied one, with invented identifiers.
// ---------------------------------------------------------------------------

const SHARED = [
  "Annual Return 2025",
  "Client ID",
  "Name",
  "Date of Incorp",
  "Invoice no. ",
  "Payment \r\nRcvd Date",
  "AR \r\nDue Date ",
  "BR \r\nDue Date",
  "X10001",
  "SUNRISE HOLDINGS LIMITED",
  "02/08",
  "INV-25-0001",
  " ",
  "X10002",
  "HARBOUR LIGHT LIMITED",
  "08/08",
  "5/9/2025",
  "(Nil)",
  "X10003",
  "EVERGREEN TRADING LIMITED",
  "22/08",
  "INV-25-0003",
  "27/8/2025 (Ceredit fr deposit)",
  "X10004",
  "NORTH POINT VENTURES LIMITED",
  "30/8",
  "INV-25-0004",
];

const sharedStringsXml = `<?xml version="1.0"?><sst count="${SHARED.length}" uniqueCount="${SHARED.length}">${SHARED.map(
  (value) => `<si><t xml:space="preserve">${value.replace(/&/g, "&amp;")}</t></si>`,
).join("")}</sst>`;

/**
 * Style 1 is the custom `d/m/yyyy;@` format the supplied worksheet uses for its
 * due-date columns. The `;@` section is why a text date survives in a
 * date-formatted cell rather than being coerced.
 */
const stylesXml = `<?xml version="1.0"?><styleSheet>
  <numFmts count="1"><numFmt numFmtId="164" formatCode="d/m/yyyy;@"/></numFmts>
  <cellXfs count="4">
    <xf numFmtId="0"/>
    <xf numFmtId="164" applyNumberFormat="1"/>
    <xf numFmtId="14" applyNumberFormat="1"/>
    <xf numFmtId="7" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

const s = (index: number) => `t="s"><v>${index}</v>`;

const sheetXml = `<?xml version="1.0"?><worksheet><dimension ref="A1:CO65"/><sheetData>
<row r="1"><c r="A1" ${s(0)}</c></row>
<row r="2"><c r="B2" ${s(1)}</c><c r="C2" ${s(2)}</c><c r="D2" ${s(3)}</c><c r="E2" ${s(4)}</c><c r="F2" s="2" ${s(5)}</c><c r="G2" s="2" ${s(6)}</c><c r="H2" s="2" ${s(7)}</c></row>
<row r="3"><c r="A3"><v>1</v></c><c r="B3" ${s(8)}</c><c r="C3" ${s(9)}</c><c r="D3" ${s(10)}</c><c r="E3" ${s(11)}</c><c r="F3" s="2"><v>45940</v></c><c r="G3" s="1"><v>45913</v></c><c r="H3" s="1"><v>45905</v></c></row>
<row r="4"><c r="A4" ${s(12)}</c><c r="B4" ${s(13)}</c><c r="C4" ${s(14)}</c><c r="D4" ${s(15)}</c><c r="E4" ${s(17)}</c><c r="F4" ${s(17)}</c><c r="G4" s="1"><v>45919</v></c><c r="H4" s="1" t="s"><v>16</v></c></row>
<row r="5"><c r="A5"><v>3</v></c><c r="B5" ${s(18)}</c><c r="C5" ${s(19)}</c><c r="D5" ${s(20)}</c><c r="E5" ${s(21)}</c><c r="F5" s="2" t="s"><v>22</v></c><c r="G5" s="1"><v>45933</v></c></row>
<row r="6"><c r="A6"><v>4</v></c><c r="B6" ${s(23)}</c><c r="C6" ${s(24)}</c><c r="D6" ${s(25)}</c><c r="E6" ${s(26)}</c><c r="F6" s="2"><v>45875</v></c><c r="G6" s="1"><f>G5+8</f><v>45941</v></c><c r="H6" s="1"><v>45925</v></c></row>
<row r="7"><c r="A7" s="0"/><c r="B7" s="0"/></row>
<row r="8"><c r="A8" s="0"/></row>
</sheetData></worksheet>`;

const workbookXml = `<?xml version="1.0"?><workbook><workbookPr/><sheets><sheet name="8.2025" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const relsXml = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`;
const contentTypesXml = `<?xml version="1.0"?><Types/>`;

function workbookFiles(overrides: ZipInput[] = []): ZipInput[] {
  return [
    { name: "[Content_Types].xml", content: contentTypesXml },
    { name: "xl/workbook.xml", content: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml },
    { name: "xl/sharedStrings.xml", content: sharedStringsXml },
    { name: "xl/styles.xml", content: stylesXml },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
    ...overrides,
  ];
}

async function readFixture(overrides: ZipInput[] = []) {
  return readXlsxWorkbook(await buildZip(workbookFiles(overrides)));
}

describe("readXlsxWorkbook", () => {
  it("reads the sheet name and the 1900 date system the workbook declares", async () => {
    const workbook = await readFixture();
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["8.2025"]);
    expect(workbook.date1904).toBe(false);
    expect(workbook.parserVersion).toBe("kossilon-xlsx-1");
  });

  it("reads the 1904 flag rather than assuming it", async () => {
    const workbook = await readXlsxWorkbook(
      await buildZip(
        workbookFiles().map((file) =>
          file.name === "xl/workbook.xml"
            ? {
                ...file,
                content: workbookXml.replace("<workbookPr/>", '<workbookPr date1904="1"/>'),
              }
            : file,
        ),
      ),
    );
    expect(workbook.date1904).toBe(true);
  });

  // The defect this guards: rows 38-65 of the supplied worksheet exist and carry
  // formatting only. A reader that counts <row> elements reports 65 records.
  it("does not report a row whose cells carry only formatting", async () => {
    const sheet = (await readFixture()).sheet("8.2025");
    expect([...(sheet?.rows.keys() ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the declared dimension without trusting it for the record count", async () => {
    const sheet = (await readFixture()).sheet("8.2025");
    expect(sheet?.dimension).toBe("A1:CO65");
    expect(sheet?.rows.size).toBe(6);
  });

  it("resolves shared strings", async () => {
    const sheet = (await readFixture()).sheet("8.2025");
    expect(sheet?.rows.get(3)?.get("C")?.text).toBe("SUNRISE HOLDINGS LIMITED");
    expect(sheet?.rows.get(3)?.get("B")?.text).toBe("X10001");
  });

  it("keeps a serial date as a number and marks it date-formatted", async () => {
    const cell = (await readFixture()).sheet("8.2025")?.rows.get(3)?.get("G");
    expect(cell).toMatchObject({ type: "n", raw: "45913", numeric: 45913, dateFormatted: true });
  });

  // The supplied worksheet has exactly this: a text date in a d/m/yyyy;@ column,
  // beside real serials. Coercing it here would destroy the evidence they differ.
  it("keeps a text date as text, still marked date-formatted", async () => {
    const cell = (await readFixture()).sheet("8.2025")?.rows.get(4)?.get("H");
    expect(cell).toMatchObject({ type: "s", text: "5/9/2025", dateFormatted: true });
    expect(cell?.numeric).toBeUndefined();
  });

  it("keeps a date carrying a trailing note verbatim", async () => {
    const cell = (await readFixture()).sheet("8.2025")?.rows.get(5)?.get("F");
    expect(cell?.text).toBe("27/8/2025 (Ceredit fr deposit)");
  });

  it("keeps (Nil) as a literal marker in both the invoice and payment columns", async () => {
    const row = (await readFixture()).sheet("8.2025")?.rows.get(4);
    expect(row?.get("E")?.text).toBe("(Nil)");
    expect(row?.get("F")?.text).toBe("(Nil)");
  });

  it("omits a blank cell rather than inventing an empty value for it", async () => {
    const row = (await readFixture()).sheet("8.2025")?.rows.get(5);
    expect(row?.has("H")).toBe(false);
  });

  it("preserves a whitespace-only cell as the whitespace it is", async () => {
    // Column A of the supplied worksheet has a single space where a row ordinal
    // belongs; the mapper has to see that rather than a tidied empty string.
    const cell = (await readFixture()).sheet("8.2025")?.rows.get(4)?.get("A");
    expect(cell?.text).toBe(" ");
  });

  // A value the workbook computed is not a value the source system asserted.
  it("flags a cell whose value came from a formula, without reading the formula", async () => {
    const cell = (await readFixture()).sheet("8.2025")?.rows.get(6)?.get("G");
    expect(cell).toMatchObject({ fromFormula: true, numeric: 45941 });
    expect(cell?.raw).toBe("45941");
  });

  it("does not flag an ordinary literal cell as computed", async () => {
    const cell = (await readFixture()).sheet("8.2025")?.rows.get(3)?.get("G");
    expect(cell?.fromFormula).toBe(false);
  });

  it("does not treat a non-date number format as a date", async () => {
    const sheet = (await readFixture()).sheet("8.2025");
    expect(sheet?.rows.get(3)?.get("A")?.dateFormatted).toBe(false);
  });
});

describe("readXlsxWorkbook refusals", () => {
  it("refuses a macro-enabled workbook by name rather than ignoring the macro", async () => {
    await expect(
      readFixture([{ name: "xl/vbaProject.bin", content: "MZ", store: true }]),
    ).rejects.toThrow(/contains macros/i);
  });

  it("refuses a workbook that links to other workbooks", async () => {
    await expect(
      readFixture([{ name: "xl/externalLinks/externalLink1.xml", content: "<x/>" }]),
    ).rejects.toThrow(/links to other workbooks/i);
  });

  it("names a legacy or encrypted .xls instead of reporting a generic ZIP error", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(readXlsxWorkbook(ole)).rejects.toThrow(/legacy .xls or an encrypted workbook/i);
  });

  it("refuses a file that is not a workbook at all", async () => {
    await expect(
      readXlsxWorkbook(new TextEncoder().encode("company,due\n")),
    ).rejects.toBeInstanceOf(XlsxFormatError);
  });

  it("refuses an empty file", async () => {
    await expect(readXlsxWorkbook(new Uint8Array())).rejects.toThrow(/empty/i);
  });
});

describe("openZipArchive", () => {
  it("reads both stored and deflated entries", async () => {
    const bytes = await buildZip([
      { name: "stored.txt", content: "kept as-is", store: true },
      { name: "deflated.txt", content: "compressed".repeat(50) },
    ]);
    const archive = openZipArchive(bytes);
    expect(new TextDecoder().decode(await archive.read("stored.txt"))).toBe("kept as-is");
    expect(new TextDecoder().decode(await archive.read("deflated.txt"))).toBe(
      "compressed".repeat(50),
    );
  });

  it("reports a missing entry by name", async () => {
    const archive = openZipArchive(await buildZip([{ name: "a.txt", content: "a" }]));
    await expect(archive.read("absent.xml")).rejects.toThrow(/absent\.xml is missing/);
  });

  it("refuses something that is not a ZIP", async () => {
    expect(() => openZipArchive(new TextEncoder().encode("plain text"))).toThrow(ZipFormatError);
  });
});
