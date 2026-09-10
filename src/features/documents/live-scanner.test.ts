import { describe, expect, it, vi } from "vitest";
import { createLiveDocumentScanner } from "./live-scanner";
import type { DocumentStorage } from "./types";

const CONTENT = new Uint8Array([1, 2, 3, 4]);
// sha256 of the four bytes above, so the adapter's own re-derivation matches.
const CHECKSUM = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";
const config = { endpoint: "https://scanner.example/scan", apiKey: "test-key" };

function storage(overrides: Partial<DocumentStorage> = {}): DocumentStorage {
  return {
    put: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    get: vi.fn(async () => ({
      objectKey: "documents/opaque",
      checksum: CHECKSUM,
      contentType: "application/pdf",
      sizeBytes: CONTENT.byteLength,
      body: CONTENT.slice().buffer,
    })),
    ...overrides,
  } as DocumentStorage;
}

const input = {
  objectKey: "documents/opaque",
  checksum: CHECKSUM,
  contentType: "application/pdf",
  fileName: "passport.pdf",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createLiveDocumentScanner", () => {
  it("identifies its verdicts as coming from a real provider", () => {
    expect(createLiveDocumentScanner({ config, storage: storage() }).verdictSource).toBe(
      "provider",
    );
  });

  it("submits the stored bytes and returns the provider's own reference", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ verdict: "clean", reference: "vendor-ref-1" }),
    );
    const scanner = createLiveDocumentScanner({ config, storage: storage(), fetchImpl });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "clean",
      providerReference: "vendor-ref-1",
      // The identity of the document. This adapter is the only code that reads
      // the stored object and hashes it, so it is the only place a version can
      // learn what its bytes actually are rather than what the client claimed.
      verifiedChecksum: CHECKSUM,
      verifiedByteSize: CONTENT.byteLength,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(config.endpoint);
    expect(init.method).toBe("POST");
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(CONTENT);
  });

  it("reports malware as rejected, carrying the provider's signature as the reason", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ verdict: "infected", reference: "vendor-ref-2", signature: "EICAR-Test" }),
    );
    const scanner = createLiveDocumentScanner({ config, storage: storage(), fetchImpl });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "rejected",
      reason: "EICAR-Test",
      providerReference: "vendor-ref-2",
    });
  });

  // The property that matters most: no infrastructure failure may become "clean".
  it("never returns clean when the object cannot be read", async () => {
    const fetchImpl = vi.fn();
    const scanner = createLiveDocumentScanner({
      config,
      storage: storage({ get: vi.fn(async () => null) }),
      fetchImpl,
    });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "stored-object-unreadable",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to scan bytes that do not match the intent, and does not retry that", async () => {
    const fetchImpl = vi.fn();
    const scanner = createLiveDocumentScanner({
      config,
      storage: storage({
        get: vi.fn(async () => ({
          objectKey: "documents/opaque",
          checksum: CHECKSUM,
          contentType: "application/pdf",
          sizeBytes: 3,
          body: new Uint8Array([9, 9, 9]).buffer,
        })),
      }),
      fetchImpl,
    });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: false,
      errorCode: "stored-checksum-mismatch",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a transport failure as retryable, never clean", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const scanner = createLiveDocumentScanner({ config, storage: storage(), fetchImpl });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "transport",
    });
  });

  it("times out into a retryable failure rather than hanging or passing", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;
    const scanner = createLiveDocumentScanner({
      config,
      storage: storage(),
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "timeout",
    });
  });

  it("retries a server error but not a client error", async () => {
    const serverError = createLiveDocumentScanner({
      config,
      storage: storage(),
      fetchImpl: vi.fn(async () => new Response("", { status: 503 })),
    });
    await expect(serverError.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "http-503",
    });

    const clientError = createLiveDocumentScanner({
      config,
      storage: storage(),
      fetchImpl: vi.fn(async () => new Response("", { status: 401 })),
    });
    await expect(clientError.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: false,
      errorCode: "http-401",
    });
  });

  it("rejects a malformed response instead of guessing a verdict from it", async () => {
    const scanner = createLiveDocumentScanner({
      config,
      storage: storage(),
      fetchImpl: vi.fn(async () => jsonResponse({ verdict: "probably-fine" })),
    });

    await expect(scanner.scan(input)).resolves.toEqual({
      status: "failed",
      retryable: false,
      errorCode: "malformed-response",
    });
  });
});
