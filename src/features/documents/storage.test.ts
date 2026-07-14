import { describe, expect, it, vi } from "vitest";
import type { R2BucketLike } from "@/server/runtime-env";
import { createDocumentStorage, createOpaqueDocumentKey } from "./storage";

describe("document storage", () => {
  it("creates opaque keys without company, category, or filename data", () => {
    const key = createOpaqueDocumentKey({
      companyId: "company-secret",
      category: "identity",
      fileName: "director-passport.pdf",
    });

    expect(key).toMatch(/^documents\/[0-9a-f-]{36}$/);
    expect(key).not.toContain("company-secret");
    expect(key).not.toContain("identity");
    expect(key).not.toContain("passport");
  });

  it("persists checksum, size, and content type as private object metadata", async () => {
    const put = vi.fn(async () => ({ key: "documents/test", size: 4 }));
    const bucket = { put, get: vi.fn(), head: vi.fn(), delete: vi.fn() } as unknown as R2BucketLike;
    const storage = createDocumentStorage(bucket);

    await storage.put({
      objectKey: "documents/test",
      body: new Uint8Array([1, 2, 3, 4]),
      checksum: "a".repeat(64),
      contentType: "application/pdf",
      sizeBytes: 4,
    });

    expect(put).toHaveBeenCalledWith(
      "documents/test",
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { checksumSha256: "a".repeat(64), sizeBytes: "4" },
      }),
    );
  });

  it("denies an object read when metadata is absent", async () => {
    const bucket = {
      put: vi.fn(),
      get: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(1), size: 1 })),
      head: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2BucketLike;

    await expect(createDocumentStorage(bucket).get("documents/orphan")).resolves.toBeNull();
  });
});
