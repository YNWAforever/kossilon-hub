import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildApprovedPackageArchive, manifestEvidence } from "./package-archive";
const version = "11111111-1111-4111-8111-111111111111",
  doc = "22222222-2222-4222-8222-222222222222";
const body = new TextEncoder().encode("synthetic safe bytes only");
const checksum = createHash("sha256").update(body).digest("hex");
const payload = JSON.stringify({
  manifest: { entries: [{ documentId: doc, documentVersionId: version, contentSha256: checksum }] },
  paymentEvidence: {
    proofDocumentId: doc,
    proofVersionId: version,
    verifiedChecksum: checksum,
    receipts: [{ proofVersionId: version }],
  },
});
describe("approved package archive byte contract", () => {
  it("includes the exact manifest and each verified version once, using server generated paths", async () => {
    const read = vi
      .fn()
      .mockResolvedValue({ body: body.buffer, checksum, documentId: doc, versionId: version });
    const zip = await buildApprovedPackageArchive(payload, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(manifestEvidence(payload)).toHaveLength(1);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength),
      names: string[] = [],
      contents: string[] = [];
    let offset = 0;
    // Independent ZIP local-header parsing, including stored size and CRC.
    while (view.getUint32(offset, true) === 0x04034b50) {
      expect(view.getUint16(offset + 8, true)).toBe(0);
      const size = view.getUint32(offset + 18, true),
        nameLen = view.getUint16(offset + 26, true),
        extra = view.getUint16(offset + 28, true);
      names.push(new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLen)));
      const start = offset + 30 + nameLen + extra,
        bytes = zip.subarray(start, start + size);
      let crc = 0xffffffff;
      for (const b of bytes) {
        crc ^= b;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      expect(view.getUint32(offset + 14, true)).toBe((crc ^ 0xffffffff) >>> 0);
      contents.push(new TextDecoder().decode(bytes));
      offset = start + size;
    }
    expect(names).toEqual(["manifest.json", "README.txt", `documents/${version}.bin`]);
    expect(contents[0]).toBe(payload);
    expect(contents[2]).toBe("synthetic safe bytes only");
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(3);
  });
  it("rejects changed hash/version or traversal and stops before exceeding the byte limit", async () => {
    await expect(
      buildApprovedPackageArchive(payload, async () => ({
        body: body.buffer,
        checksum: "b".repeat(64),
        documentId: doc,
        versionId: version,
      })),
    ).rejects.toThrow(/identity|checksum/);
    await expect(
      buildApprovedPackageArchive(payload, async () => ({
        body: body.buffer,
        checksum,
        documentId: doc,
        versionId: doc,
      })),
    ).rejects.toThrow(/identity|version/);
    expect(() => manifestEvidence(payload.replaceAll(version, "../../private"))).toThrow();
    await expect(
      buildApprovedPackageArchive(
        payload,
        async () => ({ body: body.buffer, checksum, documentId: doc, versionId: version }),
        { maxBytes: 4 },
      ),
    ).rejects.toThrow(/limit/);
  });
});
