/**
 * Tiny synthetic PDFs for extraction tests.
 *
 * Built in code rather than committed as binaries so every fixture is reviewable
 * text, and so no client document can ever end up in the repository posing as
 * a fixture. Objects are numbered from 1 in array order; the xref offsets are
 * computed, so the files are well-formed rather than merely tolerated.
 */

function buildPdf(objects: string[], options: { encrypt?: boolean } = {}): ArrayBuffer {
  const all = [...objects];
  let trailerExtra = "";
  if (options.encrypt) {
    // Standard security handler with an O/U pair that matches no password, so
    // the empty user password fails and pdf.js raises PasswordException.
    all.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${"11".repeat(32)}> /U <${"22".repeat(32)}> >>`,
    );
    trailerExtra = ` /Encrypt ${all.length} 0 R /ID [<${"33".repeat(16)}> <${"33".repeat(16)}>]`;
  }

  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  all.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character written above is ASCII, so string offsets are byte offsets.
  return new TextEncoder().encode(out).buffer as ArrayBuffer;
}

const stream = (content: string) =>
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

/** Layout: 1 catalog, 2 page tree, then (page, contents) pairs, then fonts. */
function document(
  pages: string[],
  fonts: (firstFontObject: number) => string[],
  resources: (firstFontObject: number) => string,
): string[] {
  const firstFont = 3 + pages.length * 2;
  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
  ];
  for (const content of pages) {
    const self = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${self + 1} 0 R /Resources << ${resources(firstFont)} >> >>`,
    );
    objects.push(stream(content));
  }
  return [...objects, ...fonts(firstFont)];
}

const helvetica = () => ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
const fontResource = (font: number) => `/Font << /F1 ${font} 0 R >>`;
const line = (text: string) => `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;

export const ENGLISH_PHRASE = "Kossilon synthetic fixture annual return 2026";
export const CHINESE_PHRASE = "周年申報表測試";

export function englishPdf(text: string = ENGLISH_PHRASE): ArrayBuffer {
  return buildPdf(document([line(text)], helvetica, fontResource));
}

/**
 * One line of `length` characters at a 0.001pt font size. pdf.js drops glyphs
 * positioned outside the page, so a long line at 12pt would lose everything
 * past the right edge; at this size the whole string stays on the page.
 */
export function longTextPdf(length: number): ArrayBuffer {
  return buildPdf(
    document([`BT /F1 0.001 Tf 1 720 Td (${"A".repeat(length)}) Tj ET`], helvetica, fontResource),
  );
}

export function threePagePdf(): ArrayBuffer {
  return buildPdf(
    document([line("Page one"), line("Page two"), line("Page three")], helvetica, fontResource),
  );
}

/** One page with a filled rectangle and no text operators: what a scan looks like. */
export function imageOnlyPdf(): ArrayBuffer {
  return buildPdf(
    document(
      ["q 0 0 1 rg 72 600 100 100 re f Q"],
      () => [],
      () => "",
    ),
  );
}

export function encryptedPdf(): ArrayBuffer {
  return buildPdf(document([line("secret")], helvetica, fontResource), { encrypt: true });
}

/** The first 200 bytes of a valid PDF: header present, everything else gone. */
export function truncatedPdf(): ArrayBuffer {
  return englishPdf().slice(0, 200);
}

/**
 * Traditional Chinese through a Type0 / Identity-H font with a ToUnicode map.
 *
 * No glyph program is embedded: extraction needs only the map, and this is the
 * shape system-generated Chinese PDFs take. It proves the text comes back as
 * characters rather than as CIDs.
 */
export function chinesePdf(): ArrayBuffer {
  const codePoints = [...CHINESE_PHRASE].map((character) =>
    character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
  );
  const cid = (index: number) => (index + 1).toString(16).toUpperCase().padStart(4, "0");
  const bfchar = codePoints.map((codePoint, index) => `<${cid(index)}> <${codePoint}>`).join("\n");
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap " +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def " +
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def " +
    "1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
    `${codePoints.length} beginbfchar\n${bfchar}\nendbfchar\n` +
    "endcmap CMapName currentdict /CMap defineresource pop end end";
  const content = `BT /F1 12 Tf 72 720 Td <${codePoints.map((_, index) => cid(index)).join("")}> Tj ET`;
  const fonts = (font: number) => [
    `<< /Type /Font /Subtype /Type0 /BaseFont /KossilonCJK /Encoding /Identity-H /DescendantFonts [${font + 1} 0 R] /ToUnicode ${font + 2} 0 R >>`,
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KossilonCJK /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity >>",
    stream(cmap),
  ];
  return buildPdf(document([content], fonts, fontResource));
}

/** Real PNG magic followed by filler: sniffed as an image, never parsed. */
export function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;
}
