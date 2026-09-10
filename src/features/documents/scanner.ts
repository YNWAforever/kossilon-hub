import type { IdentifiedDocumentScanner } from "./types";

/**
 * SHA-256 of the standard EICAR anti-malware test file. Recognised so a local
 * operator can exercise the rejection path with the genuine industry test
 * artefact rather than a name convention -- upload the real EICAR bytes and this
 * scanner refuses them, which is what the runbook step is actually for.
 */
const EICAR_SHA256 = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

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
      // Keyed off the file name, and off the real EICAR test file's checksum,
      // because both are reachable through the actual upload path.
      //
      // These branches used to key off contentType 'application/x-test-malware'
      // and 'application/x-test-scan-retry'. validateDocumentUploadRequest only
      // permits application/pdf, image/png and image/jpeg, so neither value could
      // ever be persisted on an intent: the rejected and retryable branches were
      // unreachable in every provider mode, this scanner was an unconditional
      // "clean" stamp, and step 5 of docs/runbooks/document-quarantine.md --
      // confirm rejected files are deleted and retryable failures stay
      // quarantined -- could not be performed through the product at all.
      const name = input.fileName.toLowerCase();

      if (name.includes("eicar") || input.checksum === EICAR_SHA256) {
        return {
          status: "rejected",
          reason: "deterministic-test-malware",
          providerReference: `fake-rejected-${input.checksum.slice(0, 12)}`,
        };
      }
      if (name.includes("scanner-retry")) {
        return { status: "failed", retryable: true, errorCode: "fake-scanner-timeout" };
      }
      return {
        status: "clean",
        providerReference: `fake-clean-${input.checksum.slice(0, 12)}`,
      };
    },
  };
}
