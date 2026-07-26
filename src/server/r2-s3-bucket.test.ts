import { describe, expect, it, vi } from "vitest";

import { createR2S3Bucket, hmacSha256Hex, sha256Hex } from "./r2-s3-bucket";

const CREDENTIALS = {
  accountId: "acct123",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  bucketName: "firm-documents",
};

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function okResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe("SigV4 primitives", () => {
  it("hashes with SHA-256 (empty-string known answer)", async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("computes HMAC-SHA256 matching RFC 4231 test case 1", async () => {
    const key = new Uint8Array(20).fill(0x0b);
    await expect(hmacSha256Hex(key, "Hi There")).resolves.toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });
});

describe("R2 bucket over the S3 API", () => {
  it("PUTs to the path-style URL with signed headers and encoded metadata", async () => {
    const fetcher = vi.fn(async () => okResponse(""));
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    await bucket.put("documents/abc-123", bytes("hello"), {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { checksumSha256: "a".repeat(64), sizeBytes: "5" },
    });

    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://acct123.r2.cloudflarestorage.com/firm-documents/documents/abc-123",
    );
    expect(init.method).toBe("PUT");

    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/pdf");
    // S3 lowercases metadata keys on the wire.
    expect(headers["x-amz-meta-checksumsha256"]).toBe("a".repeat(64));
    expect(headers["x-amz-meta-sizebytes"]).toBe("5");
    // Payload must be hashed, never sent as UNSIGNED-PAYLOAD.
    expect(headers["x-amz-content-sha256"]).toBe(await sha256Hex(bytes("hello")));
    expect(headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it("builds an Authorization header with the R2 credential scope", async () => {
    const fetcher = vi.fn(async () => okResponse(""));
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    await bucket.delete("documents/abc-123");

    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const authorization = (init.headers as Record<string, string>)["authorization"];
    expect(authorization).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${CREDENTIALS.accessKeyId}/\\d{8}/auto/s3/aws4_request, ` +
          `SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$`,
      ),
    );
    expect(authorization).toContain("host");
    expect(authorization).toContain("x-amz-content-sha256");
  });

  it("restores camelCase metadata keys and exposes the body on get", async () => {
    const fetcher = vi.fn(async () =>
      okResponse("file-contents", {
        "content-type": "application/pdf",
        "content-length": "13",
        "x-amz-meta-checksumsha256": "b".repeat(64),
        "x-amz-meta-sizebytes": "13",
      }),
    );
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    const object = await bucket.get("documents/abc-123");

    expect(object).not.toBeNull();
    expect(object!.size).toBe(13);
    expect(object!.httpMetadata).toEqual({ contentType: "application/pdf" });
    expect(object!.customMetadata).toEqual({ checksumSha256: "b".repeat(64), sizeBytes: "13" });
    expect(new TextDecoder().decode(await object!.arrayBuffer())).toBe("file-contents");
  });

  it("returns metadata without a body on head", async () => {
    const fetcher = vi.fn(async () =>
      okResponse("", {
        "content-type": "application/pdf",
        "content-length": "13",
        "x-amz-meta-checksumsha256": "c".repeat(64),
        "x-amz-meta-sizebytes": "13",
      }),
    );
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    const object = await bucket.head("documents/abc-123");

    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("HEAD");
    expect(object).toMatchObject({
      size: 13,
      customMetadata: { checksumSha256: "c".repeat(64) },
    });
  });

  it("treats 404 as a missing object rather than an error", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 404 }));
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    await expect(bucket.get("documents/missing")).resolves.toBeNull();
    await expect(bucket.head("documents/missing")).resolves.toBeNull();
  });

  it("throws on other upstream failures without leaking credentials", async () => {
    const fetcher = vi.fn(async () => new Response("<Error>AccessDenied</Error>", { status: 403 }));
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    const failure = await bucket.get("documents/abc-123").catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("403");
    expect((failure as Error).message).not.toContain(CREDENTIALS.secretAccessKey);
  });

  it("percent-encodes object keys in both the URL and the signature", async () => {
    const fetcher = vi.fn(async () => okResponse(""));
    const bucket = createR2S3Bucket({ ...CREDENTIALS, fetcher });

    await bucket.delete("documents/a b+c");

    const [url] = fetcher.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/firm-documents/documents/a%20b%2Bc");
  });

  it("rejects incomplete credentials", () => {
    expect(() => createR2S3Bucket({ ...CREDENTIALS, secretAccessKey: "  " })).toThrow(
      /R2 S3 credentials/i,
    );
  });
});
