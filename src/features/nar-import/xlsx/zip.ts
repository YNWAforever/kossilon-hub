/**
 * A read-only ZIP reader, just enough for an OOXML package.
 *
 * There is no ZIP library in this repository and no spreadsheet reader either.
 * Rather than add one, this inflates with the platform's own
 * `DecompressionStream("deflate-raw")`, which both the Node and Workers runtimes
 * provide. That keeps a parser for untrusted third-party files out of the
 * dependency tree entirely -- the alternatives carry either a history of
 * prototype-pollution and ReDoS advisories or a large bundle, and neither is
 * worth it to read five XML entries.
 *
 * It reads the central directory rather than scanning for local headers, because
 * the central directory is the authoritative index and a local header can
 * disagree with it. It refuses anything it does not fully understand instead of
 * guessing, and it is bounded against a decompression bomb before inflating.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** A spreadsheet this large is not a monthly worksheet; it is an incident. */
export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
/** An OOXML workbook has tens of entries. Thousands means something else. */
export const MAX_ENTRIES = 512;
/** Any single entry inflating past this is refused rather than buffered. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** Total inflated budget across every entry actually read. */
export const MAX_TOTAL_INFLATED_BYTES = 128 * 1024 * 1024;

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

export type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export type ZipArchive = {
  entries: ReadonlyMap<string, ZipEntry>;
  /** Inflates one entry, enforcing the size budget. */
  read(name: string): Promise<Uint8Array>;
};

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD is last, but a trailing comment (up to 65535 bytes) can follow it,
  // so it has to be searched for backwards rather than read at a fixed offset.
  const maxCommentLength = 0xffff;
  const minimumEocdLength = 22;
  const searchStart = Math.max(0, view.byteLength - maxCommentLength - minimumEocdLength);
  for (let offset = view.byteLength - minimumEocdLength; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipFormatError("Not a ZIP archive: no end-of-central-directory record.");
}

export function openZipArchive(bytes: Uint8Array): ZipArchive {
  if (bytes.byteLength === 0) throw new ZipFormatError("File is empty.");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ZipFormatError(`File exceeds the ${MAX_ARCHIVE_BYTES} byte limit.`);
  }

  // A pre-2007 .xls, or an encrypted workbook, is an OLE compound file. Saying so
  // is far more useful than "not a ZIP archive".
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new ZipFormatError(
      "This is a legacy .xls or an encrypted workbook. Save it as .xlsx without a password and try again.",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);

  // ZIP64 is refused rather than half-supported: the 32-bit fields below would
  // otherwise read a 0xFFFFFFFF sentinel as a real size and produce nonsense.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new ZipFormatError("ZIP64 archives are not supported.");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const centralDirectorySize = view.getUint32(eocd + 12, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);

  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new ZipFormatError("ZIP64 archives are not supported.");
  }
  if (entryCount > MAX_ENTRIES) {
    throw new ZipFormatError(
      `Archive has ${entryCount} entries, more than the ${MAX_ENTRIES} allowed.`,
    );
  }
  if (centralDirectoryOffset + centralDirectorySize > bytes.byteLength) {
    throw new ZipFormatError("Central directory extends past the end of the file.");
  }

  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, ZipEntry>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength) {
      throw new ZipFormatError("Truncated central directory.");
    }
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_SIGNATURE) {
      throw new ZipFormatError("Corrupt central directory entry.");
    }
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    // The bomb guard is on the declared size, so an entry is rejected before a
    // single byte of it is inflated.
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipFormatError(`Archive entry ${name} declares an implausible size.`);
    }

    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  let inflatedBudget = MAX_TOTAL_INFLATED_BYTES;

  return {
    entries,
    async read(name: string): Promise<Uint8Array> {
      const entry = entries.get(name);
      if (!entry) throw new ZipFormatError(`Archive entry ${name} is missing.`);

      const header = entry.localHeaderOffset;
      if (header + 30 > bytes.byteLength || view.getUint32(header, true) !== LOCAL_FILE_SIGNATURE) {
        throw new ZipFormatError(`Corrupt local header for ${name}.`);
      }
      // The local header's own name and extra lengths are used only to find where
      // the data starts; every size comes from the central directory.
      const nameLength = view.getUint16(header + 26, true);
      const extraLength = view.getUint16(header + 28, true);
      const start = header + 30 + nameLength + extraLength;
      const end = start + entry.compressedSize;
      if (end > bytes.byteLength) throw new ZipFormatError(`Archive entry ${name} is truncated.`);

      // A cheap early reject, and nothing more. `uncompressedSize` is a number
      // the archive declares about itself, so an attacker sets it to 1 and this
      // check waves through a stream that inflates to 150 MB. The real guard is
      // the byte counter below, which trusts only what actually comes out.
      if (entry.uncompressedSize > inflatedBudget) {
        throw new ZipFormatError("Archive exceeds the total decompression budget.");
      }

      const body = bytes.subarray(start, end);
      if (entry.compressionMethod === METHOD_STORED) {
        // Stored entries carry their real length in the archive itself, so
        // there is nothing to inflate and nothing to lie about.
        if (body.byteLength > inflatedBudget) {
          throw new ZipFormatError("Archive exceeds the total decompression budget.");
        }
        inflatedBudget -= body.byteLength;
        return body.slice();
      }
      if (entry.compressionMethod !== METHOD_DEFLATE) {
        throw new ZipFormatError(
          `Archive entry ${name} uses unsupported compression method ${entry.compressionMethod}.`,
        );
      }

      /**
       * Counted while inflating, and aborted mid-stream.
       *
       * This used to be `await new Response(stream).arrayBuffer()` followed by a
       * size check -- which buffers the ENTIRE output before the check can run.
       * A 153 KB archive declaring `uncompressedSize = 1` for an entry that
       * expands to 150 MB was fully materialised first: on Workers the isolate
       * exceeds its 128 MB memory limit and is killed, taking every other
       * request sharing it, and the ZipFormatError this code intends to raise
       * never runs. Checking after the fact detects a mismatch; it does not
       * defend against one.
       *
       * The budget is decremented by what was ACTUALLY produced, never by the
       * declared size, so a chain of entries each understating themselves cannot
       * walk past the total either.
       */
      const limit = Math.min(MAX_ENTRY_BYTES, inflatedBudget);
      const reader = new Blob([body as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();

      const chunks: Uint8Array[] = [];
      let produced = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        produced += value.byteLength;
        if (produced > limit) {
          // Stops the inflate; nothing further is buffered.
          await reader.cancel();
          throw new ZipFormatError(`Archive entry ${name} inflated past the allowed size.`);
        }
        chunks.push(value);
      }

      inflatedBudget -= produced;

      const inflated = new Uint8Array(produced);
      let written = 0;
      for (const chunk of chunks) {
        inflated.set(chunk, written);
        written += chunk.byteLength;
      }
      return inflated;
    },
  };
}
