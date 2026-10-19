import { describe, expect, it, vi } from "vitest";

import { createLazyDocumentStorage } from "./storage";
import type { DocumentStorage } from "./types";

describe("createLazyDocumentStorage", () => {
  it("does not resolve the bucket until a document's bytes are needed", () => {
    const resolve = vi.fn(() => {
      throw new Error("DOCUMENTS_BUCKET requires a Workers R2 binding or R2 S3 credentials.");
    });

    // Building the context for a metadata-only read must not throw.
    expect(() => createLazyDocumentStorage(resolve)).not.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("still fails loudly at the point storage is actually used", async () => {
    const storage = createLazyDocumentStorage(() => {
      throw new Error("DOCUMENTS_BUCKET requires a Workers R2 binding or R2 S3 credentials.");
    });

    await expect(storage.head("k")).rejects.toThrow("DOCUMENTS_BUCKET");
  });

  it("resolves once and delegates every operation", async () => {
    const inner: DocumentStorage = {
      put: vi.fn(async () => ({ objectKey: "k" }) as never),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      head: vi.fn(async () => null),
      inspect: vi.fn(async () => ({ state: "missing" as const })),
    };
    const resolve = vi.fn(() => inner);
    const storage = createLazyDocumentStorage(resolve);

    await storage.get("a");
    await storage.head("b");
    await storage.delete("c");
    expect(await storage.inspect!("d")).toEqual({ state: "missing" });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(inner.get).toHaveBeenCalledWith("a");
    expect(inner.delete).toHaveBeenCalledWith("c");
  });
});
