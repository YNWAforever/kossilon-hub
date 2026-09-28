import type { DocumentScanner, DocumentStorage } from "@/features/documents/types";
import { packageSha256 } from "./package-download";

export type ReturnSourceItem = {
  objectId: string;
  version: string;
  stable: boolean;
};
export type ReturnObject = ReturnSourceItem & {
  fileName: string;
  contentType: string;
  body: Uint8Array;
};
export type ReturnSourcePage = {
  items: ReturnSourceItem[];
  nextCursor: string | null;
};

/**
 * Read-only. BLOCKED_INTEGRATION: return-source.
 * The concrete internal-server protocol, credentials and test folder remain unknown.
 */
export type ReturnSource = {
  list(cursor: string | null): Promise<ReturnSourcePage>;
  read(objectId: string): Promise<ReturnObject>;
};
export type StagedReturnSourceObject = {
  sourceKey: string;
  objectId: string;
  version: string;
  sha256: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  objectKey: string;
  scanState: "pending" | "unsafe" | "verified";
  providerReference: string | null;
};
export type ReturnSourceStore = {
  claim(sourceKey: string): Promise<{ token: string; cursor: string | null } | null>;
  stage(input: StagedReturnSourceObject): Promise<void>;
  advance(sourceKey: string, token: string, cursor: string | null): Promise<boolean>;
  release(sourceKey: string, token: string): Promise<void>;
};

export function sourceObjectIdentity(sourceKey: string, objectId: string, sha256: string): string {
  return JSON.stringify([sourceKey, objectId, sha256]);
}

/**
 * Store untrusted bytes only in private quarantine. A provider verdict on the
 * exact readback is required before anyone may treat an object as verified.
 * Page cursor moves only after every stable object is staged.
 */
export async function syncReturnSource(
  sourceKey: string,
  source: ReturnSource,
  dependencies: {
    store: ReturnSourceStore;
    storage: DocumentStorage;
    scanner?: DocumentScanner;
    scannerVerdictSource?: "provider" | "deterministic";
    maxBytes?: number;
  },
): Promise<{ state: "busy" | "partial" | "advanced"; cursor: string | null; staged: number }> {
  if (!sourceKey.trim()) throw new Error("Return source key is required.");
  const claim = await dependencies.store.claim(sourceKey);
  if (!claim) return { state: "busy", cursor: null, staged: 0 };
  let staged = 0;
  try {
    const page = await source.list(claim.cursor);
    if (!page.items.length && page.nextCursor === claim.cursor) {
      return { state: "advanced", cursor: claim.cursor, staged: 0 };
    }
    for (const item of page.items) {
      if (!item.stable) return { state: "partial", cursor: claim.cursor, staged };
      const object = await source.read(item.objectId);
      if (!object.stable || object.objectId !== item.objectId || object.version !== item.version) {
        return { state: "partial", cursor: claim.cursor, staged };
      }
      if (
        !object.body.byteLength ||
        object.body.byteLength > (dependencies.maxBytes ?? 20 * 1024 * 1024)
      ) {
        throw new Error("Return object byte size is invalid.");
      }
      const sha256 = await packageSha256(object.body);
      const sourceHash = await packageSha256(new TextEncoder().encode(sourceKey));
      const objectKey = "filing-returns/quarantine/" + sourceHash + "/" + sha256;
      const stored = await dependencies.storage.put({
        objectKey,
        body: object.body,
        checksum: sha256,
        sizeBytes: object.body.byteLength,
        contentType: object.contentType,
      });
      if (
        stored.checksum !== sha256 ||
        stored.sizeBytes !== object.body.byteLength ||
        stored.objectKey !== objectKey
      ) {
        throw new Error("Quarantine storage did not preserve return object identity.");
      }
      const verdict = dependencies.scanner
        ? await dependencies.scanner.scan({
            objectKey,
            checksum: sha256,
            contentType: object.contentType,
            fileName: object.fileName,
          })
        : null;
      let scanState: StagedReturnSourceObject["scanState"] = "pending";
      if (verdict?.status === "rejected") {
        scanState = "unsafe";
      } else if (
        verdict?.status === "clean" &&
        dependencies.scannerVerdictSource === "provider" &&
        verdict.verifiedChecksum === sha256 &&
        verdict.verifiedByteSize === object.body.byteLength
      ) {
        const readback = await dependencies.storage.get(objectKey);
        if (
          readback &&
          readback.checksum === sha256 &&
          readback.sizeBytes === object.body.byteLength &&
          readback.body.byteLength === object.body.byteLength &&
          (await packageSha256(new Uint8Array(readback.body))) === sha256
        ) {
          scanState = "verified";
        }
      }
      await dependencies.store.stage({
        sourceKey,
        objectId: object.objectId,
        version: object.version,
        sha256,
        fileName: object.fileName,
        contentType: object.contentType,
        byteSize: object.body.byteLength,
        objectKey,
        scanState,
        providerReference:
          verdict && "providerReference" in verdict ? verdict.providerReference : null,
      });
      staged++;
    }
    if (!(await dependencies.store.advance(sourceKey, claim.token, page.nextCursor))) {
      throw new Error("Return source cursor lease was lost.");
    }
    return { state: "advanced", cursor: page.nextCursor, staged };
  } finally {
    await dependencies.store.release(sourceKey, claim.token);
  }
}

/** A live adapter needs the actual server protocol and scoped test folder. */
export function createReturnSourceForProviderMode(): ReturnSource | null {
  return null;
}
