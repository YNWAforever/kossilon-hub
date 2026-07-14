import type { R2BucketLike } from "@/server/runtime-env";

type MemoryR2Object = {
  body: Uint8Array;
  size: number;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
};

type MemoryR2PutOptions = {
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
};

const memoryObjects = new Map<string, MemoryR2Object>();

function cloneMetadata(metadata: Record<string, string> | undefined) {
  return metadata ? { ...metadata } : undefined;
}

export function createMemoryR2Bucket(): R2BucketLike {
  return {
    async put(key: string, body: Uint8Array, options?: MemoryR2PutOptions) {
      const bytes = Uint8Array.from(body);
      memoryObjects.set(key, {
        body: bytes,
        size: bytes.byteLength,
        customMetadata: cloneMetadata(options?.customMetadata),
        httpMetadata: options?.httpMetadata ? { ...options.httpMetadata } : undefined,
      });
      return { key, size: bytes.byteLength };
    },
    async get(key: string) {
      const object = memoryObjects.get(key);
      if (!object) return null;

      const body = Uint8Array.from(object.body);
      return {
        size: object.size,
        customMetadata: cloneMetadata(object.customMetadata),
        httpMetadata: object.httpMetadata ? { ...object.httpMetadata } : undefined,
        arrayBuffer: async () => body.buffer,
      };
    },
    async head(key: string) {
      const object = memoryObjects.get(key);
      if (!object) return null;

      return {
        size: object.size,
        customMetadata: cloneMetadata(object.customMetadata),
        httpMetadata: object.httpMetadata ? { ...object.httpMetadata } : undefined,
      };
    },
    async delete(key: string) {
      memoryObjects.delete(key);
    },
  } as unknown as R2BucketLike;
}

const localMemoryR2Bucket = createMemoryR2Bucket();

export function getLocalMemoryR2Bucket(): R2BucketLike {
  return localMemoryR2Bucket;
}
