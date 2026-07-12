import { describe, expect, it } from "vitest";
import { createDeterministicDocumentScanner } from "./scanner";

describe("deterministic document scanner", () => {
  const scanner = createDeterministicDocumentScanner();

  it("releases ordinary local-test documents", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/clean",
        checksum: "a".repeat(64),
        contentType: "application/pdf",
      }),
    ).resolves.toEqual({ status: "clean", providerReference: `fake-clean-${"a".repeat(12)}` });
  });

  it("rejects deterministic infected fixtures", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/infected",
        checksum: "b".repeat(64),
        contentType: "application/x-test-malware",
      }),
    ).resolves.toMatchObject({ status: "rejected", reason: "deterministic-test-malware" });
  });

  it("reports retryable provider failure fixtures", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/retry",
        checksum: "c".repeat(64),
        contentType: "application/x-test-scan-retry",
      }),
    ).resolves.toEqual({ status: "failed", retryable: true, errorCode: "fake-scanner-timeout" });
  });
});
