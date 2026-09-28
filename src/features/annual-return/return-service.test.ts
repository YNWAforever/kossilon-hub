import { describe, expect, it } from "vitest";
import { candidateSubmissionIds, isReturnOpen } from "./return-service";
import { sourceObjectIdentity, syncReturnSource, type ReturnSource } from "./return-source";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

describe("T16 return intake and exception flow", () => {
  it("t16_scenario_1 keeps a reread idempotent, a changed file version distinct, and multiple candidates unmatched", () => {
    expect(sourceObjectIdentity("server", "filings/response.pdf", digestA)).toBe(
      sourceObjectIdentity("server", "filings/response.pdf", digestA),
    );
    expect(sourceObjectIdentity("server", "filings/response.pdf", digestB)).not.toBe(
      sourceObjectIdentity("server", "filings/response.pdf", digestA),
    );
    expect(
      candidateSubmissionIds({
        externalReference: "NAR1-2026-001",
        manifestHash: null,
        candidates: [
          { id: "one", externalReference: "NAR1-2026-001", manifestHash: digestA },
          { id: "two", externalReference: "NAR1-2026-001", manifestHash: digestB },
        ],
      }),
    ).toEqual({ state: "unmatched", candidateIds: ["one", "two"] });
  });

  it("t16_scenario_2 keeps rejected and partial returns open after matching", () => {
    expect(isReturnOpen({ outcome: "accepted", reconciledAt: "2026-09-27T08:00:00Z" })).toBe(false);
    for (const outcome of ["rejected", "partial", "unmatched"] as const) {
      expect(isReturnOpen({ outcome, reconciledAt: "2026-09-27T08:00:00Z" })).toBe(true);
    }
  });

  it("t16_scenario_3 leaves cursor unchanged after an interrupted read and quarantines unsafe bytes", async () => {
    let cursor: string | null = null;
    const staged: string[] = [];
    const source: ReturnSource = {
      async list() {
        return {
          items: [
            { objectId: "one", version: "v1", stable: true },
            { objectId: "two", version: "v1", stable: true },
          ],
          nextCursor: "page-2",
        };
      },
      async read(objectId) {
        if (objectId === "two") throw new Error("source disconnected");
        return {
          objectId,
          version: "v1",
          fileName: "response.pdf",
          contentType: "application/pdf",
          body: new TextEncoder().encode("%PDF-1.7 unsafe"),
          stable: true,
        };
      },
    };
    await expect(
      syncReturnSource("internal-return-server", source, {
        store: {
          async claim() {
            return { token: "lease", cursor };
          },
          async stage(item) {
            staged.push(item.scanState);
          },
          async advance(_sourceKey, _token, value) {
            cursor = value;
            return true;
          },
          async release() {},
        },
        storage: {
          async put(input) {
            return {
              objectKey: input.objectKey,
              checksum: input.checksum,
              sizeBytes: input.sizeBytes,
              contentType: input.contentType,
            };
          },
          async get() {
            return null;
          },
          async head() {
            return null;
          },
          async delete() {},
        },
        scanner: {
          async scan() {
            return { status: "rejected", reason: "malware", providerReference: "scan-1" };
          },
        },
      }),
    ).rejects.toThrow(/disconnect/);
    expect(cursor).toBeNull();
    expect(staged).toEqual(["unsafe"]);
  });
});
