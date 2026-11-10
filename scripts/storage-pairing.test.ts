import { describe, expect, it } from "vitest";

import { summarizeStoragePairing, type PairingDocument } from "./storage-pairing-lib";

const checksum = "a".repeat(64);

function document(overrides: Partial<PairingDocument> = {}): PairingDocument {
  return {
    storageUrl: "documents/00000000-0000-4000-8000-000000000001",
    fileName: "doc.pdf",
    verifiedChecksum: checksum,
    declaredChecksum: checksum,
    verifiedSize: 1200,
    declaredSize: 1200,
    ...overrides,
  };
}

describe("R2/Postgres pairing check", () => {
  it("passes when every current version exists with matching metadata", async () => {
    const summary = await summarizeStoragePairing([document()], async () => ({
      state: "present",
      checksumSha256: checksum,
      sizeBytes: 1200,
    }));

    expect(summary.passed).toBe(true);
    expect(summary.problems).toEqual([]);
    expect(summary.rows[0].checksumMatch).toBe(true);
    expect(summary.rows[0].sizeMatch).toBe(true);
  });

  it("fails closed on a missing object", async () => {
    const summary = await summarizeStoragePairing([document()], async () => ({
      state: "missing",
    }));

    expect(summary.passed).toBe(false);
    expect(summary.missing).toBe(1);
    expect(summary.problems.join(" ")).toContain("object-missing");
  });

  it("fails on checksum, size and incomplete storage metadata", async () => {
    const mismatch = await summarizeStoragePairing([document()], async () => ({
      state: "present",
      checksumSha256: "b".repeat(64),
      sizeBytes: 1201,
    }));
    expect(mismatch.passed).toBe(false);
    expect(mismatch.checksumMismatches).toBe(1);
    expect(mismatch.sizeMismatches).toBe(1);

    const incomplete = await summarizeStoragePairing([document()], async () => ({
      state: "present",
      checksumSha256: null,
      sizeBytes: null,
    }));
    expect(incomplete.passed).toBe(false);
    expect(incomplete.metadataIncomplete).toBe(1);
  });

  it("fails closed when HEAD is unreadable or the sample is empty", async () => {
    const unreadable = await summarizeStoragePairing([document()], async () => {
      throw new Error("403");
    });
    expect(unreadable.passed).toBe(false);
    expect(unreadable.unknown).toBe(1);

    const empty = await summarizeStoragePairing([], async () => ({
      state: "present",
      checksumSha256: checksum,
      sizeBytes: 1200,
    }));
    expect(empty.passed).toBe(false);
    expect(empty.problems).toContain("no-current-document-versions");
  });
});
