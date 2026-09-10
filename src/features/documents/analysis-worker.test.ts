import { describe, expect, it, vi } from "vitest";
import type { DocumentAnalysisJob, DocumentAnalysisJobRepository } from "./analysis-jobs";
import {
  drainDocumentAnalysisJobs,
  type AnalysisSubject,
  type AnalysisWorkerDependencies,
} from "./analysis-worker";
import type { Finding } from "./findings";

const NOW = "2026-09-10T02:00:00.000Z";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

function bytesOf(text: string): ArrayBuffer {
  return Uint8Array.from(text, (character) => character.charCodeAt(0)).buffer;
}

const PDF = bytesOf("%PDF-1.7\nbody\ntrailer\n<< /Size 1 >>\nstartxref\n1\n%%EOF\n");

function job(overrides: Partial<DocumentAnalysisJob> = {}): DocumentAnalysisJob {
  return {
    id: "job-1",
    documentVersionId: VERSION_ID,
    reason: "initial",
    idempotencyKey: `analysis:${VERSION_ID}`,
    status: "processing",
    attemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: NOW,
    lastErrorCode: null,
    lastErrorMessage: null,
    completedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function subject(overrides: Partial<AnalysisSubject> = {}): AnalysisSubject {
  return {
    version: {
      id: VERSION_ID,
      documentId: "doc-1",
      versionNumber: 1,
      declaredChecksum: HASH,
      verifiedChecksum: HASH,
      supersededByVersionId: null,
    },
    objectKey: "documents/opaque",
    declaredContentType: "application/pdf",
    declaredByteSize: PDF.byteLength,
    verifiedByteSize: PDF.byteLength,
    knownPageCount: null,
    pageClaims: [],
    // Phase A: only a provider verdict is `verified` safety.
    uploadStatus: "available",
    scanVerdictSource: "provider",
    fileName: "passport.pdf",
    ...overrides,
  };
}

type HarnessOptions = {
  claimed?: DocumentAnalysisJob[];
  subject?: AnalysisSubject | null;
  body?: ArrayBuffer | null;
  analyzer?: AnalysisWorkerDependencies["analyzer"];
  fenceHolds?: boolean;
  storageThrows?: boolean;
  findingsThrow?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const fenceHolds = options.fenceHolds ?? true;
  const written: Finding[][] = [];

  const jobs = {
    markSucceeded: vi.fn(async () => fenceHolds),
    markRetry: vi.fn(async () => fenceHolds),
    markFailed: vi.fn(async () => fenceHolds),
    markDeferred: vi.fn(async () => fenceHolds),
  };

  const storageGet = vi.fn(async () => {
    if (options.storageThrows) throw new Error("R2 unreachable");
    const body = options.body === undefined ? PDF : options.body;
    return body === null
      ? null
      : {
          objectKey: "documents/opaque",
          checksum: HASH,
          contentType: "application/pdf",
          sizeBytes: body.byteLength,
          body,
        };
  });

  const dependencies: AnalysisWorkerDependencies = {
    jobs: {
      claimDue: vi.fn(async () => options.claimed ?? [job()]),
      ...jobs,
    } as unknown as DocumentAnalysisJobRepository,
    versions: {
      loadForAnalysis: vi.fn(async () =>
        options.subject === undefined ? subject() : options.subject,
      ),
    },
    findings: {
      replaceUnresolvedForVersion: vi.fn(async (input: { findings: readonly Finding[] }) => {
        if (options.findingsThrow) throw new Error("write failed");
        written.push([...input.findings]);
      }),
    },
    storage: { get: storageGet } as unknown as AnalysisWorkerDependencies["storage"],
    analyzer: options.analyzer ?? null,
  };

  return { dependencies, written, jobs, storageGet };
}

describe("drainDocumentAnalysisJobs", () => {
  it("runs the deterministic tiers and records their findings", async () => {
    const test = harness();
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary).toMatchObject({ claimed: 1, analysed: 1, providerSkipped: 1 });
    expect(test.written).toHaveLength(1);
    expect(test.written[0].map((finding) => finding.ruleKey)).toContain(
      "content-identity-matches-claim",
    );
  });

  /**
   * The Phase A gate, inherited. Analysis reads the bytes, so it must not touch
   * anything a real scanner has not passed -- and `unknown` is not a pass,
   * however long ago the fixture scanner said clean.
   */
  it("refuses to analyse a document no real scanner has passed", async () => {
    for (const scanVerdictSource of ["deterministic", null] as const) {
      const test = harness({ subject: subject({ scanVerdictSource }) });
      const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

      expect(summary).toMatchObject({ awaitingScan: 1, analysed: 0 });
      expect(test.storageGet).not.toHaveBeenCalled();
      expect(test.written).toHaveLength(0);
    }
  });

  it("refuses to analyse a document still in quarantine", async () => {
    const test = harness({ subject: subject({ uploadStatus: "quarantined" }) });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary).toMatchObject({ awaitingScan: 1 });
    expect(test.storageGet).not.toHaveBeenCalled();
  });

  /**
   * The bug this deferral exists for, pinned.
   *
   * markRetry spends an attempt, and attempt_count is incremented at claim time,
   * so five waits would exhaust max_attempts and make claimDue's
   * `attempt_count < max_attempts` predicate refuse the row forever. With the
   * malware scanner BLOCKED_INTEGRATION that is every document, roughly fifteen
   * minutes after upload -- permanently, and still dead after a scanner is
   * finally configured. Waiting for someone else must not consume the budget for
   * work this job has not yet had a chance to do.
   */
  it("defers rather than spending an attempt while waiting for a scan", async () => {
    const test = harness({ subject: subject({ scanVerdictSource: "deterministic" }) });
    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(test.jobs.markDeferred).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ reasonCode: "awaiting-scan-verdict" }),
    );
    expect(test.jobs.markRetry).not.toHaveBeenCalled();
    expect(test.jobs.markFailed).not.toHaveBeenCalled();
  });

  it("keeps deferring indefinitely rather than giving up on an unscanned document", async () => {
    // A job already on its last nominal attempt still defers, because a deferral
    // gives the attempt back instead of taking one.
    const test = harness({
      claimed: [job({ attemptCount: 5, maxAttempts: 5 })],
      subject: subject({ scanVerdictSource: null }),
    });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary).toMatchObject({ awaitingScan: 1, failed: 0 });
    expect(test.jobs.markDeferred).toHaveBeenCalled();
  });

  it("fails terminally when the version is gone, because no retry brings it back", async () => {
    const test = harness({ subject: null });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary).toMatchObject({ failed: 1 });
    expect(test.jobs.markFailed).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ errorCode: "version-missing" }),
    );
  });

  it("retries an unreadable object rather than treating it as a finding", async () => {
    for (const options of [{ body: null }, { storageThrows: true }]) {
      const test = harness(options);
      const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
      expect(summary).toMatchObject({ retried: 1, analysed: 0 });
      expect(test.written).toHaveLength(0);
    }
  });

  // A run whose findings were not written must not be marked done, or the
  // document is silently never analysed and nothing says so.
  it("does not mark a run succeeded when its findings could not be written", async () => {
    const test = harness({ findingsThrow: true });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary).toMatchObject({ retried: 1, analysed: 0 });
    expect(test.jobs.markSucceeded).not.toHaveBeenCalled();
  });

  /**
   * A claim that loses the fence was superseded by a reclaimer, and its result
   * describes a run somebody else already finished. Counting it would report the
   * same work twice.
   */
  it("counts a claim that lost its fence as superseded, not as analysed", async () => {
    const test = harness({ fenceHolds: false });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary).toMatchObject({ superseded: 1, analysed: 0 });
  });

  it("passes the claim's attempt count as the fence on every terminal write", async () => {
    const test = harness({ claimed: [job({ attemptCount: 3 })] });
    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(test.jobs.markSucceeded).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ attemptCount: 3 }),
    );
  });

  it("processes every claimed job rather than stopping at the first problem", async () => {
    const test = harness({ claimed: [job({ id: "job-1" }), job({ id: "job-2" })] });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary).toMatchObject({ claimed: 2, analysed: 2 });
  });
});

describe("the provider tier", () => {
  it("is skipped, and counted as skipped, when there is no provider", async () => {
    const test = harness({ analyzer: null });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.providerSkipped).toBe(1);
    // Nothing pretends a model looked at it.
    expect(test.written[0].some((finding) => finding.tier === "provider")).toBe(false);
  });

  it("adds a model's findings alongside the deterministic ones", async () => {
    const test = harness({
      analyzer: {
        analyze: vi.fn(async () => ({
          status: "analysed" as const,
          providerReference: "ref",
          findings: [
            {
              ruleKey: "provider:legibility",
              ruleVersion: "1",
              tier: "provider" as const,
              outcome: "issue" as const,
              severity: "warning" as const,
              detail: "Blurred.",
              citation: {
                kind: "version" as const,
                documentVersionId: VERSION_ID,
                pageFrom: null,
                pageTo: null,
              },
            },
          ],
        })),
      },
    });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary.providerSkipped).toBe(0);
    expect(test.written[0].map((finding) => finding.ruleKey)).toContain("provider:legibility");
  });

  // The deterministic tiers did real work. Discarding it because an advisory
  // tier failed would make the run hostage to the optional part of it.
  it("still completes the run when the model fails, and says that it failed", async () => {
    const test = harness({
      analyzer: {
        analyze: vi.fn(async () => ({
          status: "failed" as const,
          retryable: true,
          errorCode: "timeout",
        })),
      },
    });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary.analysed).toBe(1);

    const note = test.written[0].find((finding) => finding.ruleKey === "provider:analysis");
    expect(note).toMatchObject({
      outcome: "uncertain",
      detail: expect.stringContaining("timeout"),
    });
    // Deterministic findings survived.
    expect(test.written[0].some((finding) => finding.tier === "cross-check")).toBe(true);
  });

  // Silence would be indistinguishable from a tier that never ran at all.
  it("records that the model ran and could not tell", async () => {
    const test = harness({
      analyzer: {
        analyze: vi.fn(async () => ({
          status: "uncertain" as const,
          providerReference: "ref",
          detail: "The model returned no observations about this document.",
        })),
      },
    });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(
      test.written[0].find((finding) => finding.ruleKey === "provider:analysis"),
    ).toMatchObject({ outcome: "uncertain" });
  });
});
