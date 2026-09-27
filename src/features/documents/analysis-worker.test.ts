import { describe, expect, it, vi } from "vitest";
import type { DocumentAnalysisJob, DocumentAnalysisJobRepository } from "./analysis-jobs";
import {
  drainDocumentAnalysisJobs,
  type AnalysisRunMetadata,
  type AnalysisSubject,
  type AnalysisWorkerDependencies,
} from "./analysis-worker";
import type { Finding } from "./findings";
import type { AnalysisContextInput } from "./analysis-context";
import type { ExtractionResult, StoredExtraction } from "./text-extraction";

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
  contextualAnalyzer?: AnalysisWorkerDependencies["contextualAnalyzer"];
  contextInput?: AnalysisContextInput | null;
  contextInputs?: readonly (AnalysisContextInput | null)[];
  fenceHolds?: boolean;
  storageThrows?: boolean;
  findingsThrow?: boolean;
  extraction?: ExtractionResult;
  extractorThrows?: boolean;
  textsThrow?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const fenceHolds = options.fenceHolds ?? true;
  const written: Finding[][] = [];
  const recordedMetadata: AnalysisRunMetadata[] = [];
  let contextLoadCount = 0;

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

  const storedTexts: { documentVersionId: string; extraction: StoredExtraction }[] = [];
  const extract = vi.fn(async (): Promise<ExtractionResult> => {
    if (options.extractorThrows) throw new Error("pdf.js exploded");
    return options.extraction ?? { method: "none", pageCount: null };
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
      loadAnalysisContextInput: vi.fn(async () =>
        options.contextInputs
          ? (options.contextInputs[
              Math.min(contextLoadCount++, options.contextInputs.length - 1)
            ] ?? null)
          : (options.contextInput ?? null),
      ),
    },
    findings: {
      replaceUnresolvedForVersion: vi.fn(
        async (input: { findings: readonly Finding[]; runMetadata?: AnalysisRunMetadata }) => {
          if (options.findingsThrow) throw new Error("write failed");
          written.push([...input.findings]);
          if (input.runMetadata) recordedMetadata.push(input.runMetadata);
        },
      ),
    },
    storage: { get: storageGet } as unknown as AnalysisWorkerDependencies["storage"],
    analyzer: options.analyzer ?? null,
    contextualAnalyzer: options.contextualAnalyzer ?? null,
    extractor: { extract },
    texts: {
      upsertText: vi.fn(async (documentVersionId: string, extraction: StoredExtraction) => {
        if (options.textsThrow) throw new Error("write failed");
        storedTexts.push({ documentVersionId, extraction });
      }),
    },
  };

  return { dependencies, written, recordedMetadata, jobs, storageGet, extract, storedTexts };
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
  /**
   * The skip is recorded ON THE VERSION, not only in the drain summary.
   *
   * This test used to assert the opposite -- that no provider finding existed at
   * all -- under the comment "nothing pretends a model looked at it". The intent
   * was right and the implementation inverted it: recording nothing made "no
   * model is configured" indistinguishable from "a model read this and was
   * happy", and made a provider that ran and FAILED read as less clean than one
   * that never ran, because only the failure left a note.
   */
  it("is skipped, counted as skipped, and says so on the version", async () => {
    const test = harness({ analyzer: null });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.providerSkipped).toBe(1);

    const providerFindings = test.written[0].filter((finding) => finding.tier === "provider");
    expect(providerFindings).toHaveLength(1);
    // Uncertain, never a pass. That is what stops it pretending a model looked.
    expect(providerFindings[0].outcome).toBe("uncertain");
    expect(providerFindings[0].detail).toContain("No model is configured");
    // And an advisory note must never hold a package back.
    expect(providerFindings[0].severity).toBe("info");
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

  /**
   * An advisory tier must not be able to abort the drain.
   *
   * A returned failure was already handled; a THROWN one was not, and it is
   * worse: the rejection unwinds drainDocumentAnalysisJobs mid-loop, so every
   * job claimed after this one in the same batch never gets a terminal write.
   * They sit in 'processing' with an attempt already burnt and no recorded
   * reason, recoverable only by the reclaim -- which re-runs the same poisoned
   * document and burns another, until max_attempts strands them permanently.
   */
  it("survives an analyzer that throws, and still finishes the rest of the batch", async () => {
    const test = harness({
      claimed: [job({ id: "job-1" }), job({ id: "job-2" })],
      analyzer: {
        analyze: vi.fn(async () => {
          throw new Error("A cited page range needs a start.");
        }),
      },
    });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    // Both jobs completed. Neither was left claimed-but-unwritten.
    expect(summary).toMatchObject({ claimed: 2, analysed: 2 });
    expect(test.jobs.markSucceeded).toHaveBeenCalledTimes(2);
    expect(test.written).toHaveLength(2);

    // And the deterministic findings survived, with the failure recorded beside
    // them rather than replacing them.
    expect(test.written[0].some((finding) => finding.tier === "cross-check")).toBe(true);
    expect(
      test.written[0].find((finding) => finding.ruleKey === "provider:analysis"),
    ).toMatchObject({ outcome: "uncertain" });
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

describe("text extraction in the analysis pass", () => {
  /** The scan gate is the whole safety argument for parsing client PDFs. */
  it("never hands an unverified document to the extractor", async () => {
    const test = harness({ subject: subject({ scanVerdictSource: null }) });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(test.extract).not.toHaveBeenCalled();
  });

  it("stores what it extracted against the version", async () => {
    const test = harness({
      extraction: { method: "text-layer", text: "hello", pageCount: 2, truncated: false },
    });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(test.storedTexts).toEqual([
      {
        documentVersionId: VERSION_ID,
        extraction: {
          method: "text-layer",
          text: "hello",
          pageCount: 2,
          truncated: false,
          extractorVersion: "1",
        },
      },
    ]);
  });

  /**
   * The payoff inside the same run: a page count just counted turns the
   * cited-pages rule from `uncertain` into a real verdict, without waiting for
   * a second run to read the row back.
   */
  it("checks cited pages against the page count it just counted", async () => {
    const test = harness({
      subject: subject({
        knownPageCount: null,
        pageClaims: [{ requirementInstanceId: "req-1", pageFrom: 3, pageTo: 4 }],
      }),
      extraction: { method: "text-layer", text: "hello", pageCount: 2, truncated: false },
    });

    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    const cited = test.written[0].filter((finding) => finding.ruleKey === "cited-pages-exist");
    expect(cited).toHaveLength(1);
    expect(cited[0].outcome).not.toBe("uncertain");
  });

  it("records an unreadable document as uncertain and stores no text", async () => {
    const test = harness({ extraction: { method: "unreadable", errorClass: "PasswordException" } });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.analysed).toBe(1);
    expect(test.storedTexts).toEqual([]);
    const notes = test.written[0].filter((finding) => finding.ruleKey === "extraction:text-layer");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ outcome: "uncertain", tier: "classification" });
    expect(notes[0].detail).toContain("PasswordException");
  });

  /**
   * Same rule as the model tier: a throw must not unwind the loop and strand
   * every job claimed after this one in `processing`.
   */
  it("keeps draining when the extractor throws", async () => {
    const test = harness({
      claimed: [job({ id: "job-1" }), job({ id: "job-2" })],
      extractorThrows: true,
    });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.analysed).toBe(2);
    expect(
      test.written.flat().filter((finding) => finding.ruleKey === "extraction:text-layer"),
    ).toHaveLength(2);
  });

  it("retries the job when the text cannot be written", async () => {
    const test = harness({ extraction: { method: "none", pageCount: 1 }, textsThrow: true });

    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);

    expect(summary.retried).toBe(1);
    expect(test.jobs.markRetry).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ errorCode: "texts-not-written" }),
    );
    expect(test.written).toEqual([]);
  });
});

const CONTEXT_INPUT: AnalysisContextInput = {
  caseId: "22222222-2222-4222-8222-222222222222",
  company: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Harbour Sample Limited",
    crNumber: "7654321",
  },
  returnYear: 2026,
  partySnapshot: [{ id: "44444444-4444-4444-8444-444444444444", name: "Alex Sample" }],
  requirementSnapshot: [],
  documentVersionId: VERSION_ID,
  contentSha256: HASH,
  ruleSetVersion: "t25-1",
};

describe("T25 contextual worker gates", () => {
  it("uses server context and checked page text for advisory findings", async () => {
    const analyze = vi.fn(async ({ context }: { context: { contextHash: string } }) => ({
      contextHash: context.contextHash,
      modelVersion: "contract-v1",
      promptVersion: "prompt-v1",
      ruleSetVersion: "t25-1",
      latencyMs: 12,
      costMinor: 1,
      observations: [
        {
          ruleKey: "name",
          outcome: "issue",
          severity: "warning",
          detail: "Check the name.",
          evidence: {
            sourceVersionId: VERSION_ID,
            page: 1,
            quote: "Harbour Sample Limited",
            confidence: 0.95,
            extractionMethod: "text-layer",
          },
        },
      ],
    }));
    const test = harness({
      contextInput: CONTEXT_INPUT,
      contextualAnalyzer: { analyze },
      extraction: {
        method: "text-layer",
        text: "Harbour Sample Limited ".repeat(10),
        pageCount: 1,
        truncated: false,
        pages: [{ page: 1, text: "Harbour Sample Limited annual return" }],
      },
    });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary).toMatchObject({ analysed: 1, providerSkipped: 0 });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(test.recordedMetadata[0]).toMatchObject({
      modelVersion: "contract-v1",
      promptVersion: "prompt-v1",
      costMinor: 1,
      latencyMs: 12,
      ruleSetVersion: "t25-1",
    });
    expect(
      test.written[0].find((finding) => finding.ruleKey === "provider:name")?.evidence,
    ).toMatchObject({ page: 1, quote: "Harbour Sample Limited" });
  });

  it("drops model observations when the server case context changes before persistence", async () => {
    const analyze = vi.fn(async ({ context }: { context: { contextHash: string } }) => ({
      contextHash: context.contextHash,
      modelVersion: "contract-v1",
      promptVersion: "prompt-v1",
      ruleSetVersion: "t25-1",
      latencyMs: 12,
      costMinor: 1,
      observations: [
        {
          ruleKey: "name",
          outcome: "issue",
          severity: "warning",
          detail: "Check name",
          evidence: {
            sourceVersionId: VERSION_ID,
            page: 1,
            quote: "Harbour Sample Limited",
            confidence: 0.95,
            extractionMethod: "text-layer",
          },
        },
      ],
    }));
    const test = harness({
      contextInputs: [CONTEXT_INPUT, { ...CONTEXT_INPUT, returnYear: 2025 }],
      contextualAnalyzer: { analyze },
      extraction: {
        method: "text-layer",
        text: "Harbour Sample Limited ".repeat(10),
        pageCount: 1,
        truncated: false,
        pages: [{ page: 1, text: "Harbour Sample Limited" }],
      },
    });
    await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(test.written[0].some((finding) => finding.ruleKey === "provider:name")).toBe(false);
    expect(test.written[0].some((finding) => finding.detail.includes("context changed"))).toBe(
      true,
    );
    expect(test.recordedMetadata[0].contextHash).toBeNull();
  });

  it("requires human review for an image-only PDF and never calls the contextual model", async () => {
    const analyze = vi.fn(async () => ({}));
    const test = harness({
      contextInput: CONTEXT_INPUT,
      contextualAnalyzer: { analyze },
      extraction: { method: "none", pageCount: 2 },
    });
    const summary = await drainDocumentAnalysisJobs({ now: NOW }, test.dependencies);
    expect(summary.providerSkipped).toBe(1);
    expect(analyze).not.toHaveBeenCalled();
    expect(
      test.written[0].some((finding) => finding.detail.includes("human review is required")),
    ).toBe(true);
  });
});
