import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { DocumentStorage } from "@/features/documents/types";
import {
  buildPackageManifest,
  canonicalManifestPayload,
  type ManifestCandidateEntry,
} from "./package-manifest";
import {
  buildPackageArtifact,
  packageSha256,
  readVerifiedPackageArtifact,
} from "./package-download";

function memoryStorage(): DocumentStorage {
  const objects = new Map<
    string,
    { body: ArrayBuffer; checksum: string; sizeBytes: number; contentType: string }
  >();
  return {
    async put(input) {
      const body = new Uint8Array(input.body).slice().buffer;
      objects.set(input.objectKey, {
        body,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      });
      return {
        objectKey: input.objectKey,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      };
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { ...object, objectKey: key } : null;
    },
    async head(key) {
      const object = objects.get(key);
      return object
        ? {
            objectKey: key,
            checksum: object.checksum,
            sizeBytes: object.sizeBytes,
            contentType: object.contentType,
          }
        : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

describe("T14 immutable ZIP artifact", () => {
  it("repeated private reads return identical approved bytes and detect altered storage bytes", async () => {
    const storage = memoryStorage();
    const sourceBytes = new TextEncoder().encode("%PDF-1.7\nverified bytes");
    const sourceHash = await packageSha256(sourceBytes);
    const sourceKey = "documents/verified-source";
    await storage.put({
      objectKey: sourceKey,
      body: sourceBytes,
      checksum: sourceHash,
      sizeBytes: sourceBytes.byteLength,
      contentType: "application/pdf",
    });
    const candidate: ManifestCandidateEntry = {
      requirement: {
        id: "req-1",
        checklistItemId: "item-1",
        partyId: null,
        partyName: null,
        requirementKey: "NAR1",
        applicability: "required",
        evidence: [],
      },
      templateVersion: "2026-v1",
      version: {
        id: "version-1",
        documentId: "document-1",
        versionNumber: 1,
        declaredChecksum: sourceHash,
        verifiedChecksum: sourceHash,
        supersededByVersionId: null,
      },
      safety: "verified",
      pageFrom: 1,
      pageTo: 1,
      decision: {
        decidedByUserId: "reviewer-1",
        decision: "approve",
        decidedAt: "2026-09-27T00:00:00.000Z",
        reason: null,
      },
      findings: [],
    };
    const result = buildPackageManifest({
      caseId: "case-1",
      returnYear: 2026,
      requirementTemplateVersion: "2026-v1",
      entries: [candidate],
    });
    expect(result.kind).toBe("releasable");
    if (result.kind !== "releasable") return;
    const source = {
      versionId: "version-1",
      objectKey: sourceKey,
      fileName: "../nar1.pdf",
      checksum: sourceHash,
      sizeBytes: sourceBytes.byteLength,
      contentType: "application/pdf",
    };
    const artifact = await buildPackageArtifact(result.manifest, [source], storage);
    const zip = await JSZip.loadAsync(artifact.body);
    expect(await zip.file("manifest.json")!.async("string")).toBe(
      canonicalManifestPayload(result.manifest),
    );
    expect(Object.keys(zip.files).some((name) => name.includes(".."))).toBe(false);
    const packageKey = "packages/approved.zip";
    await storage.put({
      objectKey: packageKey,
      body: artifact.body,
      checksum: artifact.checksum,
      sizeBytes: artifact.sizeBytes,
      contentType: "application/zip",
    });
    const recorded = {
      objectKey: packageKey,
      checksum: artifact.checksum,
      sizeBytes: artifact.sizeBytes,
    };
    const first = await readVerifiedPackageArtifact(storage, recorded);
    const second = await readVerifiedPackageArtifact(storage, recorded);
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second));
    expect(await packageSha256(new Uint8Array(second))).toBe(artifact.checksum);
    const tampered = new Uint8Array(first).slice();
    tampered[tampered.length - 1] ^= 1;
    await storage.put({
      objectKey: packageKey,
      body: tampered,
      checksum: artifact.checksum,
      sizeBytes: artifact.sizeBytes,
      contentType: "application/zip",
    });
    await expect(readVerifiedPackageArtifact(storage, recorded)).rejects.toThrow(
      "bytes do not match",
    );
  });
});
