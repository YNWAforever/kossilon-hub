import type { DocumentScanner } from "./types";

export function createDeterministicDocumentScanner(): DocumentScanner {
  return {
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
