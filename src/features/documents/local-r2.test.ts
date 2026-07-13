import { describe, expect, it } from "vitest";
import { createDocumentStorage } from "./storage";
import { createMemoryR2Bucket } from "./local-r2";

describe("local R2 bucket", () => {
  it("round-trips private object metadata in memory", async () => {
    const storage = createDocumentStorage(createMemoryR2Bucket());
    await storage.put({
      objectKey: "documents/test",
      body: new Uint8Array([1, 2, 3]),
      checksum: "a".repeat(64),
      contentType: "application/pdf",
      sizeBytes: 3,
    });

    expect(await storage.head("documents/test")).toEqual(
      expect.objectContaining({ sizeBytes: 3, checksum: "a".repeat(64) }),
    );
  });

  it("clones bytes rather than retaining a caller-owned buffer", async () => {
    const storage = createDocumentStorage(createMemoryR2Bucket());
    const body = new Uint8Array([1, 2, 3]);
    await storage.put({
      objectKey: "documents/cloned-test",
      body,
      checksum: "b".repeat(64),
      contentType: "application/pdf",
      sizeBytes: 3,
    });
    body[0] = 9;

    const stored = await storage.get("documents/cloned-test");
    expect(stored && Array.from(new Uint8Array(stored.body))).toEqual([1, 2, 3]);
  });
});
