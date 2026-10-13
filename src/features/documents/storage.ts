import type { R2BucketLike } from "@/server/runtime-env";
import type {
  DocumentStorage,
  PutDocumentInput,
  StoredObjectBody,
  StoredObjectMetadata,
} from "./types";

export function createOpaqueDocumentKey(_input: {
  companyId: string;
  category: string;
  fileName: string;
}): string {
  return `documents/${crypto.randomUUID()}`;
}

function metadataFor(
  objectKey: string,
  object: {
    size?: number;
    customMetadata?: Record<string, string>;
    httpMetadata?: { contentType?: string };
  },
): StoredObjectMetadata | null {
  const checksum = object.customMetadata?.checksumSha256;
  const declaredSize = Number(object.customMetadata?.sizeBytes);
  const contentType = object.httpMetadata?.contentType;
  if (!checksum || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || !contentType)
    return null;
  if (object.size !== undefined && object.size !== declaredSize) return null;
  return { objectKey, checksum, contentType, sizeBytes: declaredSize };
}

export function createDocumentStorage(bucket: R2BucketLike): DocumentStorage {
  return {
    async put(input: PutDocumentInput) {
      if (input.sizeBytes <= 0) throw new Error("Document size must be positive.");
      if (!/^[0-9a-f]{64}$/.test(input.checksum)) throw new Error("Invalid SHA-256 checksum.");
      const body = input.body instanceof Uint8Array ? input.body : new Uint8Array(input.body);
      if (body.byteLength !== input.sizeBytes)
        throw new Error("Document size does not match body.");
      await bucket.put(input.objectKey, body, {
        httpMetadata: { contentType: input.contentType },
        customMetadata: {
          checksumSha256: input.checksum,
          sizeBytes: String(input.sizeBytes),
        },
      });
      return {
        objectKey: input.objectKey,
        checksum: input.checksum,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      };
    },
    async get(objectKey) {
      const object = await bucket.get(objectKey);
      if (!object) return null;
      const metadata = metadataFor(objectKey, object);
      if (!metadata) return null;
      const body = await object.arrayBuffer();
      return { ...metadata, body } satisfies StoredObjectBody;
    },
    async delete(objectKey) {
      await bucket.delete(objectKey);
    },
    async head(objectKey) {
      const object = await bucket.head(objectKey);
      return object ? metadataFor(objectKey, object) : null;
    },
    async inspect(objectKey) {
      try {
        const object = await bucket.head(objectKey);
        return object
          ? { state: "present", metadata: metadataFor(objectKey, object) }
          : { state: "missing" };
      } catch {
        return { state: "unknown" };
      }
    },
  };
}

/**
 * Storage that is only resolved when a document's bytes are actually touched.
 *
 * Every document server function used to resolve the R2 binding up front, and
 * getDocumentsBucketBinding() throws when it is missing — so a storage outage
 * or misconfiguration also broke database-only reads: the document lists, the
 * payment review and the case page's document pickers all failed with
 * "DOCUMENTS_BUCKET requires a Workers R2 binding". Reads of metadata now work
 * regardless; uploads, previews and recovery still fail loudly, at the point
 * they need the bucket.
 */
export function createLazyDocumentStorage(resolve: () => DocumentStorage): DocumentStorage {
  let storage: DocumentStorage | undefined;
  const current = () => (storage ??= resolve());
  return {
    // async so a missing bucket rejects like any other storage failure.
    put: async (input) => current().put(input),
    get: async (objectKey) => current().get(objectKey),
    delete: async (objectKey) => current().delete(objectKey),
    head: async (objectKey) => current().head(objectKey),
    inspect: async (objectKey) => {
      const resolved = current();
      return resolved.inspect ? resolved.inspect(objectKey) : { state: "unknown" as const };
    },
  };
}
