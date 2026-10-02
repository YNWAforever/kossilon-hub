import { createHash } from "node:crypto";
import { z } from "zod";
const uuid = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
  manifest: z.object({
    entries: z
      .array(
        z.object({
          documentId: uuid.nullable(),
          documentVersionId: uuid.nullable(),
          contentSha256: hash.nullable(),
        }),
      )
      .max(200),
  }),
  paymentEvidence: z
    .object({
      proofDocumentId: uuid.nullable(),
      proofVersionId: uuid.nullable(),
      verifiedChecksum: hash.nullable(),
      receipts: z.array(z.object({ proofVersionId: uuid })).max(200),
    })
    .nullable(),
});
export type ArchiveEvidence = {
  documentId: string | null;
  versionId: string;
  checksum: string | null;
};
export function manifestEvidence(payload: string): ArchiveEvidence[] {
  if (new TextEncoder().encode(payload).byteLength > 1024 * 1024)
    throw new Error("Manifest exceeds archive limit.");
  const p = manifestSchema.parse(JSON.parse(payload)),
    refs = new Map<string, ArchiveEvidence>();
  function add(documentId: string | null, versionId: string | null, checksum: string | null) {
    if (!versionId) return;
    const previous = refs.get(versionId);
    if (
      previous &&
      ((documentId && previous.documentId && documentId !== previous.documentId) ||
        (checksum && previous.checksum && checksum !== previous.checksum))
    )
      throw new Error("Manifest version identity conflicts.");
    refs.set(versionId, {
      documentId: documentId ?? previous?.documentId ?? null,
      versionId,
      checksum: checksum ?? previous?.checksum ?? null,
    });
  }
  for (const e of p.manifest.entries) add(e.documentId, e.documentVersionId, e.contentSha256);
  if (p.paymentEvidence) {
    const e = p.paymentEvidence;
    add(e.proofDocumentId, e.proofVersionId, e.verifiedChecksum);
    for (const r of e.receipts) add(null, r.proofVersionId, null);
  }
  if (refs.size > 200) throw new Error("Too many versions for one bounded archive.");
  return [...refs.values()].sort((a, b) => a.versionId.localeCompare(b.versionId));
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Minimal ZIP STORE format: UTF-8, no paths from clients, no compression/ZIP64. */
function storeZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name),
      crc = crc32(file.bytes),
      header = new Uint8Array(30 + name.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, file.bytes.length, true);
    v.setUint32(22, file.bytes.length, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    const c = new Uint8Array(46 + name.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.bytes.length, true);
    cv.setUint32(24, file.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    locals.push(header, file.bytes);
    central.push(c);
    offset += header.length + file.bytes.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...central, end]) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
export async function buildApprovedPackageArchive(
  payload: string,
  read: (
    ref: ArchiveEvidence,
  ) => Promise<{ body: ArrayBuffer; checksum: string; documentId: string; versionId: string }>,
  limits: { maxBytes?: number } = {},
) {
  const maxBytes = limits.maxBytes ?? 25 * 1024 * 1024;
  const files = [
    { name: "manifest.json", bytes: new TextEncoder().encode(payload) },
    {
      name: "README.txt",
      bytes: new TextEncoder().encode(
        "Approved evidence archive. Export is not submission. documents/<version UUID>.bin maps to manifest versions. File safety does not prove external/regulatory acceptance.\n",
      ),
    },
  ];
  let total = files.reduce((n, f) => n + f.bytes.length + f.name.length * 2 + 76, 22);
  if (total > maxBytes) throw new Error("Archive exceeds byte limit.");
  for (const ref of manifestEvidence(payload)) {
    const current = await read(ref),
      bytes = new Uint8Array(current.body),
      actual = createHash("sha256").update(bytes).digest("hex");
    if (
      current.versionId !== ref.versionId ||
      (ref.documentId && current.documentId !== ref.documentId) ||
      current.checksum !== actual ||
      (ref.checksum && ref.checksum !== actual)
    )
      throw new Error("Approved version identity or checksum changed.");
    const name = `documents/${ref.versionId}.bin`;
    total += bytes.length + name.length * 2 + 76;
    if (total > maxBytes) throw new Error("Archive exceeds byte limit.");
    files.push({ name, bytes });
  }
  return storeZip(files);
}
