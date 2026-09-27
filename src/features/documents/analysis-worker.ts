import {
  AI_RULE_VERSION,
  interpretContextualResponse,
  type AiAnalysisResult,
  type DocumentAiAnalyzer,
} from "./ai-provider";
import {
  buildAnalysisContext,
  type AnalysisContext,
  type AnalysisContextInput,
} from "./analysis-context";
import { chooseOcrPath } from "./ocr-provider";
import {
  BYTES_SAMPLE_WINDOW,
  crossCheckFindings,
  readabilityFindings,
  type EvidencePageClaim,
} from "./analysis-checks";
import type { DocumentAnalysisJobRepository } from "./analysis-jobs";
import { makeFinding, type Finding } from "./findings";
import { documentSafetyOf, type DocumentSafety } from "./safety";
import { EXTRACTOR_VERSION, type ExtractionResult, type StoredExtraction } from "./text-extraction";
import type { DocumentStatus, DocumentStorage, ScanVerdictSource } from "./types";
import type { DocumentVersionState } from "./versions";

/**
 * Drains the analysis queue.
 *
 * Mirrors `drainDocumentScanJobs`: claim a bounded batch, do the work, and write
 * a terminal outcome fenced on the attempt_count the claim returned. A claim
 * that loses the fence is not counted, because it was superseded by a reclaimer
 * and its result describes a run somebody else already finished.
 */

/** Everything a run needs about the version, gathered before any tier starts. */
export type AnalysisSubject = {
  version: DocumentVersionState;
  objectKey: string;
  declaredContentType: string | null;
  declaredByteSize: number | null;
  verifiedByteSize: number | null;
  /** From document_version_texts; null until an extraction has counted pages. */
  knownPageCount: number | null;
  pageClaims: readonly EvidencePageClaim[];
  /** The upload this version came from, for the safety gate. */
  uploadStatus: DocumentStatus;
  scanVerdictSource: ScanVerdictSource | null;
  fileName: string;
};

export type AnalysisWorkerDependencies = {
  jobs: DocumentAnalysisJobRepository;
  versions: {
    loadForAnalysis(documentVersionId: string): Promise<AnalysisSubject | null>;
    loadAnalysisContextInput?(documentVersionId: string): Promise<AnalysisContextInput | null>;
  };
  findings: {
    /**
     * Replaces this run's machine opinion and leaves human work alone.
     *
     * A re-run must not duplicate findings, and must never delete one a person
     * has resolved -- that resolution is the record of a decision, and the
     * analysis path is not allowed to erase it.
     */
    replaceUnresolvedForVersion(input: {
      documentVersionId: string;
      analysisJobId: string;
      findings: readonly Finding[];
      runMetadata?: AnalysisRunMetadata;
    }): Promise<void>;
  };
  /**
   * Narrowed deliberately, the way scan-worker narrows to head/delete. This is
   * the second server-side consumer of document bytes and should be able to do
   * exactly one thing with them.
   */
  storage: Pick<DocumentStorage, "get">;
  /** Null under BLOCKED_INTEGRATION: ai-provider, which is always, today. */
  analyzer: DocumentAiAnalyzer | null;
  /** Provider-specific transport remains disabled until its reviewed contract exists. */
  contextualAnalyzer?: {
    analyze(input: {
      context: AnalysisContext;
      pages: readonly { page: number; text: string }[];
    }): Promise<unknown>;
  } | null;
  /**
   * Reads a PDF's text layer. Injected, like the analyzer, so the pass can be
   * tested without pdf.js and so a failure is the pass's to contain.
   */
  extractor: {
    extract(input: { body: ArrayBuffer; contentType: string | null }): Promise<ExtractionResult>;
  };
  texts: { upsertText(documentVersionId: string, extraction: StoredExtraction): Promise<void> };
};

export type AnalysisRunMetadata = {
  contextHash: string | null;
  ruleSetVersion: string;
  extractionMethod: "text-layer" | "none" | "unreadable" | "ocr";
  modelVersion: string | null;
  promptVersion: string | null;
  costMinor: number | null;
  latencyMs: number | null;
};

export type AnalysisDrainSummary = {
  claimed: number;
  analysed: number;
  /** Skipped because no real malware verdict exists yet. Not a failure. */
  awaitingScan: number;
  /** Retryable failure: the job backs off and tries again. */
  retried: number;
  /** Terminal failure: needs a human. */
  failed: number;
  /** The claim lost its fence, or the version is gone. */
  superseded: number;
  /** Runs where the provider tier was skipped because there is no provider. */
  providerSkipped: number;
};

const DEFAULT_LIMIT = 20;

function sampleOf(body: ArrayBuffer): { head: Uint8Array; tail: Uint8Array } {
  const bytes = new Uint8Array(body);
  return {
    head: bytes.subarray(0, Math.min(BYTES_SAMPLE_WINDOW, bytes.length)),
    tail: bytes.subarray(Math.max(0, bytes.length - BYTES_SAMPLE_WINDOW)),
  };
}

function providerNote(documentVersionId: string, detail: string): Finding {
  return makeFinding({
    ruleKey: "provider:analysis",
    ruleVersion: AI_RULE_VERSION,
    tier: "provider",
    outcome: "uncertain",
    severity: "info",
    detail,
    citation: { kind: "version", documentVersionId, pageFrom: null, pageTo: null },
  });
}

function extractionNote(documentVersionId: string, errorClass: string): Finding {
  return makeFinding({
    ruleKey: "extraction:text-layer",
    ruleVersion: EXTRACTOR_VERSION,
    tier: "classification",
    outcome: "uncertain",
    severity: "info",
    detail: `The document's text could not be read (${errorClass}), so no check that needs its words could run.`,
    citation: { kind: "version", documentVersionId, pageFrom: null, pageTo: null },
  });
}

function humanOcrNote(documentVersionId: string): Finding {
  return makeFinding({
    ruleKey: "extraction:ocr-unavailable",
    ruleVersion: EXTRACTOR_VERSION,
    tier: "classification",
    outcome: "uncertain",
    severity: "info",
    detail:
      "The text layer is absent, sparse or truncated. OCR is unavailable; human review is required.",
    citation: { kind: "version", documentVersionId, pageFrom: null, pageTo: null },
  });
}

export async function drainDocumentAnalysisJobs(
  input: { now: string; limit?: number },
  dependencies: AnalysisWorkerDependencies,
): Promise<AnalysisDrainSummary> {
  const summary: AnalysisDrainSummary = {
    claimed: 0,
    analysed: 0,
    awaitingScan: 0,
    retried: 0,
    failed: 0,
    superseded: 0,
    providerSkipped: 0,
  };

  const claimed = await dependencies.jobs.claimDue(input.now, input.limit ?? DEFAULT_LIMIT);
  summary.claimed = claimed.length;

  for (const job of claimed) {
    const fence = { now: input.now, attemptCount: job.attemptCount };
    const subject = await dependencies.versions.loadForAnalysis(job.documentVersionId);

    if (!subject) {
      // Terminal, not retryable: no number of retries brings a deleted row back.
      const applied = await dependencies.jobs.markFailed(job.id, {
        ...fence,
        errorCode: "version-missing",
        errorMessage: "The document version this job refers to no longer exists.",
      });
      if (applied) summary.failed += 1;
      else summary.superseded += 1;
      continue;
    }

    const safety: DocumentSafety = documentSafetyOf({
      uploadStatus: subject.uploadStatus,
      scanVerdictSource: subject.scanVerdictSource,
      checksum: subject.version.declaredChecksum ?? undefined,
      sizeBytes: subject.declaredByteSize ?? undefined,
      verifiedChecksum: subject.version.verifiedChecksum,
      verifiedByteSize: subject.verifiedByteSize,
    });

    // The Phase A gate, inherited rather than restated. Analysis reads the bytes,
    // so it must not touch anything a real scanner has not passed -- and
    // `unknown` is not a pass, however long ago the fixture scanner said clean.
    if (safety !== "verified") {
      // Deferred, not retried, and the difference is load-bearing. Nothing is
      // wrong here -- the scan simply has not happened, and under
      // BLOCKED_INTEGRATION: malware-scanner-provider it may never. markRetry
      // would spend an attempt, and since attempt_count is incremented at claim
      // time, five deferrals would exhaust max_attempts and make the row
      // permanently unclaimable: every document silently never analysed, about
      // fifteen minutes after upload, including after a scanner is configured.
      const applied = await dependencies.jobs.markDeferred(job.id, {
        ...fence,
        reasonCode: "awaiting-scan-verdict",
      });
      if (applied) summary.awaitingScan += 1;
      else summary.superseded += 1;
      continue;
    }

    let stored: Awaited<ReturnType<DocumentStorage["get"]>>;
    try {
      stored = await dependencies.storage.get(subject.objectKey);
    } catch {
      const applied = await dependencies.jobs.markRetry(job.id, {
        ...fence,
        errorCode: "storage-unreadable",
        errorMessage: "The stored object could not be read.",
      });
      if (applied) summary.retried += 1;
      else summary.superseded += 1;
      continue;
    }

    if (!stored) {
      // Retryable: an object that is not readable right now may be an eventual
      // consistency window. It is not evidence that anything is wrong.
      const applied = await dependencies.jobs.markRetry(job.id, {
        ...fence,
        errorCode: "stored-object-missing",
        errorMessage: "The stored object was not found.",
      });
      if (applied) summary.retried += 1;
      else summary.superseded += 1;
      continue;
    }

    // Wrapped for the same reason the model tier is: a throw would unwind this
    // loop and strand every job claimed after this one.
    let extraction: ExtractionResult;
    try {
      extraction = await dependencies.extractor.extract({
        body: stored.body,
        contentType: subject.declaredContentType,
      });
    } catch {
      extraction = { method: "unreadable", errorClass: "extractor-threw" };
    }

    // What this run counted beats what was loaded: the loaded value is from an
    // earlier run, or null because there was none.
    let knownPageCount = subject.knownPageCount;
    if (extraction.method !== "unreadable") {
      try {
        await dependencies.texts.upsertText(subject.version.id, {
          ...extraction,
          extractorVersion: EXTRACTOR_VERSION,
        });
      } catch {
        const applied = await dependencies.jobs.markRetry(job.id, {
          ...fence,
          errorCode: "texts-not-written",
          errorMessage: "The extracted text for this run could not be recorded.",
        });
        if (applied) summary.retried += 1;
        else summary.superseded += 1;
        continue;
      }
      knownPageCount = extraction.pageCount;
    }

    const { head, tail } = sampleOf(stored.body);
    const findings: Finding[] = [
      ...readabilityFindings(subject.version, {
        declaredContentType: subject.declaredContentType,
        byteSize: stored.body.byteLength,
        head,
        tail,
      }),
      ...crossCheckFindings({
        version: subject.version,
        knownPageCount,
        declaredByteSize: subject.declaredByteSize,
        verifiedByteSize: subject.verifiedByteSize,
        pageClaims: subject.pageClaims,
      }),
      ...(extraction.method === "unreadable"
        ? [extractionNote(subject.version.id, extraction.errorClass)]
        : []),
    ];

    let context: AnalysisContext | null = null;
    try {
      const contextInput = await dependencies.versions.loadAnalysisContextInput?.(
        subject.version.id,
      );
      if (contextInput) context = await buildAnalysisContext(contextInput);
    } catch {
      // The case database is the sole source of context; no document fallback.
    }
    const runMetadata: AnalysisRunMetadata = {
      contextHash: context?.contextHash ?? null,
      ruleSetVersion: context?.ruleSetVersion ?? AI_RULE_VERSION,
      extractionMethod: extraction.method,
      modelVersion: null,
      promptVersion: null,
      costMinor: null,
      latencyMs: null,
    };
    const ocrPath = chooseOcrPath({ extraction, ocrAvailable: false });
    if (ocrPath === "human-only" && extraction.method !== "unreadable") {
      findings.push(humanOcrNote(subject.version.id));
    }

    if (dependencies.contextualAnalyzer) {
      if (
        !context ||
        extraction.method !== "text-layer" ||
        ocrPath !== "text-layer" ||
        !extraction.pages?.length
      ) {
        summary.providerSkipped += 1;
        findings.push(
          providerNote(
            subject.version.id,
            "Case context or verified page text is unavailable; human review is required.",
          ),
        );
      } else {
        try {
          const raw = await dependencies.contextualAnalyzer.analyze({
            context,
            pages: extraction.pages,
          });
          const result = interpretContextualResponse({
            context,
            pages: extraction.pages,
            response: raw,
          });
          if (result.status === "analysed") {
            findings.push(...result.findings);
            runMetadata.modelVersion = result.modelVersion;
            runMetadata.promptVersion = result.promptVersion;
            runMetadata.costMinor = result.costMinor;
            runMetadata.latencyMs = result.latencyMs;
          } else
            findings.push(
              providerNote(
                subject.version.id,
                `The contextual model result could not be verified (${result.reasonCode}).`,
              ),
            );
        } catch {
          findings.push(
            providerNote(
              subject.version.id,
              "The contextual model timed out or failed; human review is required.",
            ),
          );
        }
      }
    } else if (!dependencies.analyzer) {
      summary.providerSkipped += 1;
      // Recorded on the version, not only in the drain summary. Both
      // deterministic tiers emit an `uncertain` when they cannot check; silence
      // here made "no model is configured" indistinguishable from "a model read
      // this and was happy" -- and worse, made a provider that ran and FAILED
      // read as less clean than one that never ran at all, because only the
      // failure left a note. Under BLOCKED_INTEGRATION: ai-provider this is
      // every document, which is exactly why it has to be visible rather than
      // assumed.
      findings.push(
        providerNote(
          subject.version.id,
          "No model is configured, so the third analysis tier did not run. This is not a clean result from it.",
        ),
      );
    } else {
      // Wrapped, because an advisory tier must not be able to abort the drain.
      // A returned failure was always handled; a thrown one was not, and it is
      // strictly worse: the rejection unwinds this loop, so every job claimed
      // after this one never gets a terminal write and sits in 'processing' with
      // an attempt already burnt and no recorded reason. Only the reclaim
      // recovers them, which re-runs the same poisoned document and burns
      // another attempt each time.
      //
      // A throw is treated exactly as a returned failure: the adapter's own
      // contract says it should not happen, and this is what makes that true for
      // the caller whatever a future adapter does.
      let analysis: AiAnalysisResult;
      try {
        analysis = await dependencies.analyzer.analyze({
          documentVersionId: subject.version.id,
          contentType: subject.declaredContentType ?? "application/octet-stream",
          fileName: subject.fileName,
          body: stored.body,
        });
      } catch {
        analysis = { status: "failed", retryable: false, errorCode: "analyzer-threw" };
      }

      if (analysis.status === "analysed") {
        findings.push(...analysis.findings);
      } else if (analysis.status === "uncertain") {
        // Recorded rather than dropped. A tier that ran and could not tell is
        // information; silence would be indistinguishable from a tier that never
        // ran at all.
        findings.push(providerNote(subject.version.id, analysis.detail));
      } else {
        // The deterministic tiers already produced real findings. Discarding them
        // because an advisory tier failed would make the whole run hostage to the
        // optional part of it, so the failure becomes a finding and the run still
        // completes.
        findings.push(
          providerNote(
            subject.version.id,
            `The model could not be consulted (${analysis.errorCode}).`,
          ),
        );
      }
    }

    // Recheck immediately before the write. A changed company, party or
    // requirement snapshot invalidates model observations from the old context.
    if (context && dependencies.versions.loadAnalysisContextInput) {
      try {
        const currentInput = await dependencies.versions.loadAnalysisContextInput(
          subject.version.id,
        );
        const current = currentInput ? await buildAnalysisContext(currentInput) : null;
        if (!current || current.contextHash !== context.contextHash) {
          for (let index = findings.length - 1; index >= 0; index--) {
            if (findings[index].tier === "provider") findings.splice(index, 1);
          }
          findings.push(
            providerNote(
              subject.version.id,
              "The case context changed during analysis; reanalysis and human review are required.",
            ),
          );
          runMetadata.contextHash = null;
          runMetadata.modelVersion = null;
          runMetadata.promptVersion = null;
          runMetadata.costMinor = null;
          runMetadata.latencyMs = null;
        }
      } catch {
        findings.push(
          providerNote(
            subject.version.id,
            "Current case context could not be confirmed; human review is required.",
          ),
        );
        runMetadata.contextHash = null;
      }
    }

    try {
      await dependencies.findings.replaceUnresolvedForVersion({
        documentVersionId: subject.version.id,
        analysisJobId: job.id,
        findings,
        runMetadata,
      });
    } catch {
      const applied = await dependencies.jobs.markRetry(job.id, {
        ...fence,
        errorCode: "findings-not-written",
        errorMessage: "The findings for this run could not be recorded.",
      });
      if (applied) summary.retried += 1;
      else summary.superseded += 1;
      continue;
    }

    const applied = await dependencies.jobs.markSucceeded(job.id, fence);
    if (applied) summary.analysed += 1;
    else summary.superseded += 1;
  }

  return summary;
}
