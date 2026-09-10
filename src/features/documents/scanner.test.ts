import { describe, expect, it } from "vitest";
import { createDeterministicDocumentScanner } from "./scanner";

/**
 * These fixtures used to key off contentType "application/x-test-malware" and
 * "application/x-test-scan-retry". validateDocumentUploadRequest only permits
 * application/pdf, image/png and image/jpeg, so neither value could ever be
 * persisted on an upload intent: the tests passed by calling scan() directly
 * with inputs the real path cannot produce, while the rejected and retryable
 * branches were unreachable in every provider mode.
 *
 * Everything below uses an input a genuine upload can actually carry.
 */

/** SHA-256 of the standard EICAR anti-malware test file. */
const EICAR_SHA256 = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

describe("deterministic document scanner", () => {
  const scanner = createDeterministicDocumentScanner();

  it("marks its verdicts as unverifiable rather than letting them pass for real ones", () => {
    expect(scanner.verdictSource).toBe("deterministic");
  });

  it("releases ordinary local-test documents", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/clean",
        checksum: "a".repeat(64),
        contentType: "application/pdf",
        fileName: "passport.pdf",
      }),
    ).resolves.toEqual({ status: "clean", providerReference: `fake-clean-${"a".repeat(12)}` });
  });

  it("rejects the genuine EICAR test file by checksum", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/infected",
        checksum: EICAR_SHA256,
        contentType: "application/pdf",
        fileName: "harmless-looking.pdf",
      }),
    ).resolves.toMatchObject({ status: "rejected", reason: "deterministic-test-malware" });
  });

  it("rejects a file named for the rejection fixture, which a real upload can carry", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/infected",
        checksum: "b".repeat(64),
        contentType: "application/pdf",
        fileName: "eicar-sample.pdf",
      }),
    ).resolves.toMatchObject({ status: "rejected", reason: "deterministic-test-malware" });
  });

  it("reports a retryable provider failure for the retry fixture", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/retry",
        checksum: "c".repeat(64),
        contentType: "application/pdf",
        fileName: "scanner-retry-case.pdf",
      }),
    ).resolves.toEqual({ status: "failed", retryable: true, errorCode: "fake-scanner-timeout" });
  });

  it("matches the fixture markers case-insensitively", async () => {
    await expect(
      scanner.scan({
        objectKey: "documents/infected",
        checksum: "d".repeat(64),
        contentType: "application/pdf",
        fileName: "EICAR-Sample.PDF",
      }),
    ).resolves.toMatchObject({ status: "rejected" });
  });

  // The upload validator permits exactly these, so a fixture that only responds
  // to something else is a fixture that never runs.
  it("reaches every branch with content types the upload validator permits", async () => {
    for (const contentType of ["application/pdf", "image/png", "image/jpeg"]) {
      await expect(
        scanner.scan({
          objectKey: "documents/x",
          checksum: "e".repeat(64),
          contentType,
          fileName: "eicar.pdf",
        }),
      ).resolves.toMatchObject({ status: "rejected" });
    }
  });
});
