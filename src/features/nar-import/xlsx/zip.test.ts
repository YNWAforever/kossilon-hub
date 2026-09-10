import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_ENTRY_BYTES, MAX_TOTAL_INFLATED_BYTES, openZipArchive, ZipFormatError } from "./zip";

/**
 * The archive is hostile input, and every number in it is a claim the archive
 * makes about itself.
 *
 * `stageNarImport` accepts a workbook received from another firm's system, so
 * `uncompressedSize` in the central directory is attacker-controlled. The guard
 * used to read that number, and separately used to buffer the whole inflated
 * entry before checking its real length -- which detects a lie but does not
 * defend against one, because the memory is already spent by then. On a Worker
 * the isolate hits its 128 MB limit and is killed, taking every other request
 * sharing it with it, and the error this code means to raise never runs.
 */

type Part = { name: string; data: Uint8Array; declaredUncompressed?: number };

/** A minimal, valid ZIP whose declared sizes can be made to lie. */
function buildZip(parts: Part[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBytes = Buffer.from(part.name, "utf-8");
    const compressed = deflateRawSync(Buffer.from(part.data));
    const declared = part.declaredUncompressed ?? part.data.byteLength;
    const crc = crc32(Buffer.from(part.data));

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);

  return new Uint8Array(Buffer.concat([localBlob, centralBlob, eocd]));
}

describe("openZipArchive decompression limits", () => {
  /**
   * The whole defect in one test. A 65 MB run of zeros deflates to well under a
   * megabyte, and the archive declares it as one byte.
   */
  it("refuses an entry that inflates past the limit however small it claims to be", async () => {
    const bomb = buildZip([
      {
        name: "big.bin",
        data: new Uint8Array(MAX_ENTRY_BYTES + 1024 * 1024),
        declaredUncompressed: 1,
      },
    ]);

    // Tiny on disk, and the declared size sails through every up-front check.
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);

    const archive = openZipArchive(bomb);
    expect(archive.entries.get("big.bin")?.uncompressedSize).toBe(1);

    await expect(archive.read("big.bin")).rejects.toThrow(ZipFormatError);
    await expect(archive.read("big.bin")).rejects.toThrow(/inflated past the allowed size/);
  }, 120_000);

  /**
   * The other half: a declared size that lies LOW must not truncate real
   * content either. The returned bytes come from the stream, never from the
   * number.
   */
  it("returns everything the stream produced, not what the archive claimed", async () => {
    const understated = buildZip([
      {
        name: "small.txt",
        data: new TextEncoder().encode("x".repeat(5000)),
        declaredUncompressed: 1,
      },
    ]);

    const archive = openZipArchive(understated);
    expect(archive.entries.get("small.txt")?.uncompressedSize).toBe(1);

    const body = await archive.read("small.txt");
    expect(body.byteLength).toBe(5000);
    expect(new TextDecoder().decode(body.subarray(0, 3))).toBe("xxx");
  });

  /**
   * The discriminating one.
   *
   * The two tests above pass with the old implementation too: on Node it
   * happily buffers 65 MB and then raises the same error. What actually changed
   * is WHERE the numbers come from -- the per-entry abort now counts real bytes,
   * and the shared budget is charged what came out rather than what was
   * declared.
   *
   * Seventeen 8 MB entries total 136 MB, past MAX_TOTAL_INFLATED_BYTES (128 MB),
   * while each one declares a single byte. Charging the declared size let all
   * seventeen through on a budget that had barely moved; charging the real size
   * exhausts it and the last read is refused.
   */
  it("exhausts the shared budget on real bytes, not on declared ones", async () => {
    const entryBytes = 8 * 1024 * 1024;
    const count = Math.ceil(MAX_TOTAL_INFLATED_BYTES / entryBytes) + 1;
    const chained = buildZip(
      Array.from({ length: count }, (_, i) => ({
        name: `part-${i}.bin`,
        data: new Uint8Array(entryBytes),
        declaredUncompressed: 1,
      })),
    );

    const archive = openZipArchive(chained);
    expect(archive.entries.get("part-0.bin")?.uncompressedSize).toBe(1);

    let refusedAt: number | null = null;
    for (let i = 0; i < count; i += 1) {
      try {
        // Length only; holding seventeen buffers would defeat the point.
        const { byteLength } = await archive.read(`part-${i}.bin`);
        expect(byteLength).toBe(entryBytes);
      } catch (error) {
        expect(error).toBeInstanceOf(ZipFormatError);
        refusedAt = i;
        break;
      }
    }

    // It must run out, and it must run out where the real total crosses the
    // budget -- not at the end, and not never.
    expect(refusedAt).not.toBeNull();
    expect(refusedAt).toBe(MAX_TOTAL_INFLATED_BYTES / entryBytes);
  }, 180_000);
});
