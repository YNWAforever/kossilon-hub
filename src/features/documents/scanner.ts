import type { IdentifiedDocumentScanner } from "./types";

/**
 * A fixed-response scanner for tests and local development.
 *
 * It inspects nothing: every input but two magic content types comes back
 * "clean". That is fine for a test, and was a security hole in production --
 * `loadDefaultDocumentContext` handed this to *live* mode unconditionally, so
 * real malware was marked available. `createDocumentScannerForProviderMode` now
 * owns that choice and refuses to return this one for live.
 *
 * It reports `verdictSource: "deterministic"` so every verdict it writes is
 * recorded as unverifiable rather than having to be inferred later from the
 * shape of its provider reference.
 */
export function createDeterministicDocumentScanner(): IdentifiedDocumentScanner {
  return {
    verdictSource: "deterministic",
    async scan(input) {
      if (input.contentType === "application/x-test-malware") {
        return {
          status: "rejected",
          reason: "deterministic-test-malware",
          providerReference: `fake-rejected-${input.checksum.slice(0, 12)}`,
        };
      }
      if (input.contentType === "application/x-test-scan-retry") {
        return { status: "failed", retryable: true, errorCode: "fake-scanner-timeout" };
      }
      return {
        status: "clean",
        providerReference: `fake-clean-${input.checksum.slice(0, 12)}`,
      };
    },
  };
}
