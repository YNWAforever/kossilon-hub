import type { DocumentRepository } from "./repository";
import type { DocumentScanJob, DocumentScanJobRepository } from "./scan-jobs";
import type { DocumentStatus, DocumentStorage, IdentifiedDocumentScanner } from "./types";

/**
 * Drains the document scan queue.
 *
 * Actor-free, like the rest of `runFirmMaintenance`'s passes: a scheduler has no
 * request to derive an actor from. That is not a hole -- the claimed job row IS
 * the worker's scope. It may touch exactly the intent that row names, and no
 * client-supplied identifier ever reaches it, so a compromised or confused caller
 * cannot widen what a scan run can see.
 *
 * Every outcome here is deliberately conservative about the one direction that
 * matters: nothing in this file can turn an infrastructure failure into a clean
 * verdict, and nothing deletes received bytes except a provider's positive
 * malware finding.
 */

export type ScanWorkerDependencies = {
  jobs: DocumentScanJobRepository;
  documents: Pick<DocumentRepository, "getUploadIntent" | "recordScanResult">;
  storage: Pick<DocumentStorage, "head" | "delete">;
  scanner: IdentifiedDocumentScanner;
};

export type ScanDrainSummary = {
  claimed: number;
  clean: number;
  rejected: number;
  /** Retryable failure: the file stays quarantined and the job backs off. */
  retried: number;
  /** Terminal failure: needs a human. The file is still not deleted. */
  failed: number;
  /** Nothing to do -- superseded content, or a verdict already recorded. */
  superseded: number;
};

const DEFAULT_LIMIT = 20;

export async function drainDocumentScanJobs(
  input: { now: string; limit?: number },
  dependencies: ScanWorkerDependencies,
): Promise<ScanDrainSummary> {
  const summary: ScanDrainSummary = {
    claimed: 0,
    clean: 0,
    rejected: 0,
    retried: 0,
    failed: 0,
    superseded: 0,
  };

  const claimed = await dependencies.jobs.claimDue(input.now, input.limit ?? DEFAULT_LIMIT);
  summary.claimed = claimed.length;

  for (const job of claimed) {
    await runOneJob(job, input.now, dependencies, summary);
  }

  return summary;
}

async function runOneJob(
  job: DocumentScanJob,
  now: string,
  dependencies: ScanWorkerDependencies,
  summary: ScanDrainSummary,
): Promise<void> {
  const intent = await dependencies.documents.getUploadIntent(job.intentId);

  if (!intent) {
    // The intent is gone but the job survives (the FK is `on delete restrict`,
    // so this should be unreachable). Terminal rather than retried: repeating it
    // cannot make the row reappear.
    await dependencies.jobs.markFailed(job.id, {
      errorCode: "intent-missing",
      errorMessage: "Upload intent no longer exists.",
      now,
      attemptCount: job.attemptCount,
    });
    summary.failed += 1;
    return;
  }

  // The job is a question about one exact content version. If the intent now
  // carries different bytes, a replacement upload has superseded it and its own
  // job is queued; answering with this one would apply a verdict to content it
  // never saw.
  if (intent.checksum !== job.checksum) {
    await dependencies.jobs.markSucceeded(job.id, { now, attemptCount: job.attemptCount });
    summary.superseded += 1;
    return;
  }

  // A first scan acts on a quarantined file. A rescan also acts on an 'available'
  // one, because the legacy files this exists for sit at 'available' carrying an
  // unverifiable verdict.
  const allowStatuses: readonly DocumentStatus[] | undefined =
    job.reason === "rescan" ? ["quarantined", "available"] : undefined;
  const scannable =
    intent.status === "quarantined" || (job.reason === "rescan" && intent.status === "available");
  if (!scannable) {
    await dependencies.jobs.markSucceeded(job.id, { now, attemptCount: job.attemptCount });
    summary.superseded += 1;
    return;
  }

  // Confirm the stored object still matches what the intent describes before
  // spending a scan on it. head() is cheap and a mismatch here means the verdict
  // would be about the wrong bytes.
  const stored = await dependencies.storage.head(intent.objectKey);
  if (
    !stored ||
    stored.checksum !== intent.checksum ||
    stored.sizeBytes !== intent.expectedSizeBytes ||
    stored.contentType !== intent.contentType
  ) {
    // Retryable: storage may be briefly unreadable, and this is emphatically not
    // evidence the file is safe. Repeated failures exhaust max_attempts and
    // surface for a human rather than resolving themselves into a clean state.
    await dependencies.jobs.markRetry(job.id, {
      errorCode: stored ? "stored-metadata-mismatch" : "stored-object-missing",
      errorMessage: "Stored object does not match the upload intent.",
      now,
      attemptCount: job.attemptCount,
    });
    summary.retried += 1;
    return;
  }

  let result;
  try {
    result = await dependencies.scanner.scan({
      objectKey: intent.objectKey,
      checksum: intent.checksum,
      contentType: intent.contentType,
      fileName: intent.fileName,
    });
  } catch (error) {
    // A scanner that throws is an outage, never a pass.
    await dependencies.jobs.markRetry(job.id, {
      errorCode: "scanner-threw",
      errorMessage: error instanceof Error ? error.name : "unknown",
      now,
      attemptCount: job.attemptCount,
    });
    summary.retried += 1;
    return;
  }

  if (result.status === "failed") {
    if (result.retryable) {
      await dependencies.jobs.markRetry(job.id, {
        errorCode: result.errorCode,
        errorMessage: result.errorCode,
        now,
        attemptCount: job.attemptCount,
      });
      summary.retried += 1;
    } else {
      await dependencies.jobs.markFailed(job.id, {
        errorCode: result.errorCode,
        errorMessage: result.errorCode,
        now,
        attemptCount: job.attemptCount,
      });
      summary.failed += 1;
    }
    return;
  }

  // The only deletion in this file, and only on a provider's positive finding.
  if (result.status === "rejected") await dependencies.storage.delete(intent.objectKey);

  try {
    await dependencies.documents.recordScanResult(intent.id, result, {
      verdictSource: dependencies.scanner.verdictSource,
      expectedChecksum: job.checksum,
      allowStatuses,
    });
  } catch (error) {
    // The verdict did not land -- most likely the intent moved underneath us
    // between the read above and this write. Retry rather than record success,
    // so the file does not end up with a job marked done and no verdict.
    await dependencies.jobs.markRetry(job.id, {
      errorCode: "verdict-not-applied",
      errorMessage: error instanceof Error ? error.message : "unknown",
      now,
      attemptCount: job.attemptCount,
    });
    summary.retried += 1;
    return;
  }

  const applied = await dependencies.jobs.markSucceeded(job.id, {
    now,
    attemptCount: job.attemptCount,
  });
  // `false` means this claim was superseded by a reclaim that also ran. The
  // verdict is already recorded and idempotent, so nothing is undone; it simply
  // must not be counted twice.
  if (applied) {
    if (result.status === "clean") summary.clean += 1;
    else summary.rejected += 1;
  } else {
    summary.superseded += 1;
  }
}
