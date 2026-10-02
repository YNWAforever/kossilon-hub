import { describe, expect, it, vi } from "vitest";
import type { DocumentUploadIntent } from "./repository";
import type { DocumentScanJob } from "./scan-jobs";
import { drainDocumentScanJobs, type ScanWorkerDependencies } from "./scan-worker";
import type { IdentifiedDocumentScanner } from "./types";

const NOW = "2026-09-10T12:00:00.000Z";
const CHECKSUM = "a".repeat(64);

const intent: DocumentUploadIntent = {
  currentVersionId: "71000000-0000-4000-8000-000000000001",
  id: "30000000-0000-4000-8000-000000000001",
  companyId: "10000000-0000-4000-8000-000000000001",
  caseId: "40000000-0000-4000-8000-000000000001",
  documentId: "50000000-0000-4000-8000-000000000001",
  checklistItemId: null,
  requestedByAuthUserId: "client-auth",
  category: "identity",
  fileName: "passport.pdf",
  contentType: "application/pdf",
  expectedSizeBytes: 4,
  checksum: CHECKSUM,
  objectKey: "documents/opaque",
  status: "quarantined",
  scanProviderReference: null,
  scanErrorCode: null,
  scanVerdictSource: null,
  expiresAt: "2026-09-10T11:00:00.000Z",
  quarantineRetentionUntil: "2026-09-24T12:00:00.000Z",
};

const job: DocumentScanJob = {
  documentVersionId: intent.currentVersionId,
  id: "60000000-0000-4000-8000-000000000001",
  intentId: intent.id,
  checksum: CHECKSUM,
  reason: "initial",
  idempotencyKey: `scan:${intent.id}:${CHECKSUM}`,
  status: "processing",
  attemptCount: 1,
  maxAttempts: 5,
  nextAttemptAt: NOW,
  lastErrorCode: null,
  lastErrorMessage: null,
  completedAt: null,
  createdAt: NOW,
};

function deps(overrides: Partial<ScanWorkerDependencies> = {}, claimed: DocumentScanJob[] = [job]) {
  return {
    jobs: {
      claimDue: vi.fn(async () => claimed),
      markSucceeded: vi.fn(async () => true),
      markRetry: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
      enqueue: vi.fn(),
      cancelSupersededForIntent: vi.fn(),
      listForIntent: vi.fn(),
      pendingSummary: vi.fn(),
      close: vi.fn(),
    },
    documents: {
      getUploadIntent: vi.fn(async () => intent),
      recordScanResult: vi.fn(async () => intent),
    },
    storage: {
      head: vi.fn(async () => ({
        objectKey: intent.objectKey,
        checksum: intent.checksum,
        contentType: intent.contentType,
        sizeBytes: intent.expectedSizeBytes,
      })),
      delete: vi.fn(async () => undefined),
    },
    scanner: {
      verdictSource: "provider",
      scan: vi.fn(async () => ({
        status: "clean",
        providerReference: "vendor-1",
        verifiedChecksum: CHECKSUM,
        verifiedByteSize: 4,
        documentVersionId: intent.currentVersionId,
      })),
    },
    ...overrides,
  } as unknown as ScanWorkerDependencies;
}

describe("drainDocumentScanJobs", () => {
  it.each([
    "missing-intent",
    "legacy-version",
    "missing-object",
    "provider-retry",
    "provider-failed",
    "scanner-threw",
  ])("reports a superseded claim instead of a persisted outcome after %s", async (scenario) => {
    const d = deps(
      {},
      scenario === "legacy-version" ? [{ ...job, documentVersionId: null }] : [job],
    );
    vi.mocked(d.jobs.markRetry).mockResolvedValue(false);
    vi.mocked(d.jobs.markFailed).mockResolvedValue(false);
    if (scenario === "missing-intent")
      vi.mocked(d.documents.getUploadIntent).mockResolvedValue(null);
    if (scenario === "missing-object") vi.mocked(d.storage.head).mockResolvedValue(null);
    if (scenario === "provider-retry" || scenario === "provider-failed")
      vi.mocked(d.scanner.scan).mockResolvedValue({
        status: "failed",
        retryable: scenario === "provider-retry",
        errorCode: "http-429",
      });
    if (scenario === "scanner-threw")
      vi.mocked(d.scanner.scan).mockRejectedValue(new Error("safe-stub"));
    expect(await drainDocumentScanJobs({ now: NOW }, d)).toMatchObject({
      superseded: 1,
      failed: 0,
      retried: 0,
      clean: 0,
    });
    expect(d.documents.recordScanResult).not.toHaveBeenCalled();
  });
  it("refuses an incomplete provider clean result without recording a verdict", async () => {
    const d = deps();
    vi.mocked(d.scanner.scan).mockResolvedValue({
      status: "clean",
      providerReference: "unbound-stub",
    });
    const result = await drainDocumentScanJobs({ now: NOW }, d);
    expect(result).toMatchObject({ failed: 1, clean: 0 });
    expect(d.documents.recordScanResult).not.toHaveBeenCalled();
    expect(d.jobs.markFailed).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ errorCode: "provider-result-unbound" }),
    );
  });

  it("refuses a legacy unbound job without a provider call", async () => {
    const d = deps({}, [{ ...job, documentVersionId: null }]);
    const result = await drainDocumentScanJobs({ now: NOW }, d);
    expect(result).toMatchObject({ failed: 1, clean: 0 });
    expect(d.scanner.scan).not.toHaveBeenCalled();
  });
  it("records a clean verdict with its provenance and the content version scanned", async () => {
    const dependencies = deps();
    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);

    expect(summary).toMatchObject({ claimed: 1, clean: 1, rejected: 0, retried: 0, failed: 0 });
    expect(dependencies.documents.recordScanResult).toHaveBeenCalledWith(
      intent.id,
      expect.objectContaining({ status: "clean" }),
      expect.objectContaining({ verdictSource: "provider", expectedChecksum: CHECKSUM }),
    );
    expect(dependencies.storage.delete).not.toHaveBeenCalled();
  });

  it("retains rejected evidence in quarantine without automatic deletion", async () => {
    const dependencies = deps({
      scanner: {
        verdictSource: "provider",
        scan: vi.fn(async () => ({
          status: "rejected",
          reason: "EICAR-Test",
          providerReference: "vendor-2",
        })),
      } as unknown as IdentifiedDocumentScanner,
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.rejected).toBe(1);
    expect(dependencies.storage.delete).not.toHaveBeenCalled();
  });

  it("does not delete bytes when a rejected verdict loses its version or attempt authority", async () => {
    const dependencies = deps();
    vi.mocked(dependencies.scanner.scan).mockResolvedValue({
      status: "rejected",
      reason: "safe-stub",
      providerReference: "stub-not-live",
    });
    vi.mocked(dependencies.documents.recordScanResult).mockRejectedValue(
      new Error("Scan claim changed"),
    );
    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.clean).toBe(0);
    expect(summary.rejected).toBe(0);
    expect(dependencies.storage.delete).not.toHaveBeenCalled();
  });

  // The Phase A acceptance gate: a received file survives a scanner outage,
  // shows an actionable state, and completes after retry.
  it("retries a scanner outage and never records a verdict for it", async () => {
    const dependencies = deps({
      scanner: {
        verdictSource: "provider",
        scan: vi.fn(async () => ({ status: "failed", retryable: true, errorCode: "timeout" })),
      } as unknown as IdentifiedDocumentScanner,
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary).toMatchObject({ retried: 1, clean: 0, failed: 0 });
    expect(dependencies.documents.recordScanResult).not.toHaveBeenCalled();
    expect(dependencies.storage.delete).not.toHaveBeenCalled();
    expect(dependencies.jobs.markRetry).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ errorCode: "timeout", attemptCount: job.attemptCount }),
    );
  });

  it("treats a scanner that throws as an outage, not a pass", async () => {
    const dependencies = deps({
      scanner: {
        verdictSource: "provider",
        scan: vi.fn(async () => {
          throw new Error("connection reset");
        }),
      } as unknown as IdentifiedDocumentScanner,
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.retried).toBe(1);
    expect(dependencies.documents.recordScanResult).not.toHaveBeenCalled();
  });

  it("does not spend a scan when the stored object no longer matches the intent", async () => {
    const dependencies = deps({
      storage: {
        head: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
      } as unknown as ScanWorkerDependencies["storage"],
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.retried).toBe(1);
    expect(dependencies.scanner.scan).not.toHaveBeenCalled();
  });

  // A replacement upload supersedes the job; answering with it would apply a
  // verdict to bytes it never saw.
  it("skips a job whose content version the intent no longer carries", async () => {
    const dependencies = deps({
      documents: {
        getUploadIntent: vi.fn(async () => ({ ...intent, checksum: "b".repeat(64) })),
        recordScanResult: vi.fn(),
      } as unknown as ScanWorkerDependencies["documents"],
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.superseded).toBe(1);
    expect(dependencies.scanner.scan).not.toHaveBeenCalled();
    expect(dependencies.documents.recordScanResult).not.toHaveBeenCalled();
  });

  it("skips a job whose file already left quarantine", async () => {
    const dependencies = deps({
      documents: {
        getUploadIntent: vi.fn(async () => ({ ...intent, status: "available" as const })),
        recordScanResult: vi.fn(),
      } as unknown as ScanWorkerDependencies["documents"],
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.superseded).toBe(1);
    expect(dependencies.scanner.scan).not.toHaveBeenCalled();
  });

  // The legacy backfill: those files sit at 'available' carrying an unverifiable
  // verdict and must be able to receive a real one.
  it("does scan an available file when the job is a genuine re-scan", async () => {
    const dependencies = deps(
      {
        documents: {
          getUploadIntent: vi.fn(async () => ({
            ...intent,
            status: "available" as const,
            scanVerdictSource: "deterministic" as const,
          })),
          recordScanResult: vi.fn(async () => intent),
        } as unknown as ScanWorkerDependencies["documents"],
      },
      [{ ...job, reason: "rescan" }],
    );

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.clean).toBe(1);
    expect(dependencies.documents.recordScanResult).toHaveBeenCalledWith(
      intent.id,
      expect.anything(),
      expect.objectContaining({ allowStatuses: ["quarantined", "available"] }),
    );
  });

  // markSucceeded fences on attempt_count. `false` means a reclaimer also ran;
  // the verdict is already recorded, so nothing is undone -- it simply must not
  // be counted twice.
  it("does not double-count a claim that a reclaimer superseded", async () => {
    const dependencies = deps({
      jobs: {
        claimDue: vi.fn(async () => [job]),
        markSucceeded: vi.fn(async () => false),
        markRetry: vi.fn(async () => true),
        markFailed: vi.fn(async () => true),
        enqueue: vi.fn(),
        cancelSupersededForIntent: vi.fn(),
        listForIntent: vi.fn(),
        pendingSummary: vi.fn(),
        close: vi.fn(),
      } as unknown as ScanWorkerDependencies["jobs"],
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary.clean).toBe(0);
    expect(summary.superseded).toBe(1);
  });

  it("retries rather than reporting success when the verdict fails to land", async () => {
    const dependencies = deps({
      documents: {
        getUploadIntent: vi.fn(async () => intent),
        recordScanResult: vi.fn(async () => {
          throw new Error("Document is not quarantined.");
        }),
      } as unknown as ScanWorkerDependencies["documents"],
    });

    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary).toMatchObject({ retried: 1, clean: 0 });
    expect(dependencies.jobs.markSucceeded).not.toHaveBeenCalled();
  });

  it("reports zeros without touching anything when the queue is empty", async () => {
    const dependencies = deps({}, []);
    const summary = await drainDocumentScanJobs({ now: NOW }, dependencies);
    expect(summary).toEqual({
      claimed: 0,
      clean: 0,
      rejected: 0,
      retried: 0,
      failed: 0,
      superseded: 0,
    });
    expect(dependencies.scanner.scan).not.toHaveBeenCalled();
  });
});
