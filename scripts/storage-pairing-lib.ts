export type PairingDocument = {
  storageUrl: string;
  fileName: string;
  verifiedChecksum: string | null;
  declaredChecksum: string | null;
  verifiedSize: number | null;
  declaredSize: number | null;
};

export type ObjectInspection =
  | { state: "present"; checksumSha256: string | null; sizeBytes: number | null }
  | { state: "missing" }
  | { state: "unknown"; reason: string };

export type PairingRow = {
  storageUrl: string;
  fileName: string;
  state: ObjectInspection["state"];
  checksumMatch: boolean | null;
  sizeMatch: boolean | null;
  problems: string[];
};

export type PairingSummary = {
  sampled: number;
  present: number;
  missing: number;
  unknown: number;
  checksumMismatches: number;
  sizeMismatches: number;
  metadataIncomplete: number;
  passed: boolean;
  problems: string[];
  rows: PairingRow[];
};

function normalizeChecksum(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

function normalizeSize(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Compare Postgres `document_versions` rows with what R2 actually stores.
 *
 * Read-only and fail-closed: a missing object, incomplete storage metadata, a
 * checksum/size mismatch, an unreadable HEAD, or an empty sample all fail the
 * check. The sample must be non-empty because "nothing to verify" is not a
 * successful pairing proof.
 */
export async function summarizeStoragePairing(
  documents: readonly PairingDocument[],
  inspect: (storageUrl: string) => Promise<ObjectInspection>,
): Promise<PairingSummary> {
  const rows: PairingRow[] = [];
  const failures: string[] = [];
  let present = 0;
  let missing = 0;
  let unknown = 0;
  let checksumMismatches = 0;
  let sizeMismatches = 0;
  let metadataIncomplete = 0;

  for (const document of documents) {
    const problems: string[] = [];
    let state: ObjectInspection["state"] = "unknown";
    let checksumMatch: boolean | null = null;
    let sizeMatch: boolean | null = null;

    try {
      const inspection = await inspect(document.storageUrl);
      state = inspection.state;

      if (inspection.state === "missing") {
        missing += 1;
        problems.push("object-missing");
      } else if (inspection.state === "unknown") {
        unknown += 1;
        problems.push(`inspection-unknown:${inspection.reason}`);
      } else {
        present += 1;
        const storedChecksum = normalizeChecksum(inspection.checksumSha256);
        const storedSize = normalizeSize(inspection.sizeBytes);

        if (!storedChecksum || storedSize == null) {
          metadataIncomplete += 1;
          problems.push("metadata-incomplete");
        } else {
          const expectedChecksum = normalizeChecksum(
            document.verifiedChecksum ?? document.declaredChecksum,
          );
          if (expectedChecksum) {
            checksumMatch = expectedChecksum === storedChecksum;
            if (!checksumMatch) {
              checksumMismatches += 1;
              problems.push("checksum-mismatch");
            }
          }

          const expectedSize = normalizeSize(document.verifiedSize ?? document.declaredSize);
          if (expectedSize != null) {
            sizeMatch = expectedSize === storedSize;
            if (!sizeMatch) {
              sizeMismatches += 1;
              problems.push("size-mismatch");
            }
          }
        }
      }
    } catch (error) {
      state = "unknown";
      unknown += 1;
      problems.push(`inspection-failed:${error instanceof Error ? error.message : "unknown"}`);
    }

    if (problems.length > 0) {
      failures.push(`${document.storageUrl}: ${problems.join(",")}`);
    }
    rows.push({
      storageUrl: document.storageUrl,
      fileName: document.fileName,
      state,
      checksumMatch,
      sizeMatch,
      problems,
    });
  }

  const problems: string[] = [];
  if (documents.length === 0) problems.push("no-current-document-versions");
  problems.push(...failures);

  return {
    sampled: documents.length,
    present,
    missing,
    unknown,
    checksumMismatches,
    sizeMismatches,
    metadataIncomplete,
    passed: problems.length === 0,
    problems,
    rows,
  };
}
