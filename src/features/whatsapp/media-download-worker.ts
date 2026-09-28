import { fetchInboundMedia, type MediaDownloadDependencies } from "./media-download";
import type { MediaDownloadJobRepository } from "./media-download-jobs";

export type MediaDownloadSummary = {
  claimed: number;
  quarantined: number;
  retried: number;
  failed: number;
  manualReupload: number;
  superseded: number;
  strandedFailed: number;
};

const MANUAL_CODES = new Set(["media_manual_reupload", "media_lookup_invalid"]);
const TERMINAL_CODES = new Set([
  "media_ref_invalid",
  "media_provider_unconfigured",
  "media_host_config_invalid",
  "media_url_unapproved",
  "media_oversize",
  "media_mime_mismatch",
  "media_size_mismatch",
  "media_empty",
]);

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string")
    return error.code;
  return "media_download_unknown";
}

/** Background read/download only. It never marks a document clean or linked. */
export async function drainInboundMediaDownloads(
  now: string,
  dependencies: {
    jobs: MediaDownloadJobRepository;
    media: MediaDownloadDependencies;
    limit?: number;
  },
): Promise<MediaDownloadSummary> {
  const summary: MediaDownloadSummary = {
    claimed: 0,
    quarantined: 0,
    retried: 0,
    failed: 0,
    manualReupload: 0,
    superseded: 0,
    strandedFailed: await dependencies.jobs.failStranded(now),
  };
  const due = await dependencies.jobs.claimDue(now, dependencies.limit ?? 10);
  summary.claimed = due.length;
  for (const job of due) {
    try {
      const media = await fetchInboundMedia(
        {
          providerMediaId: job.providerMediaId,
          mediaType: job.mediaType,
          objectKey: job.objectKey,
        },
        dependencies.media,
      );
      const recorded = await dependencies.jobs.markQuarantined(job, media, now);
      if (recorded) summary.quarantined += 1;
      else {
        summary.superseded += 1;
        // A stale worker wrote only its own attempt key, never the current one.
        await dependencies.media.storage.delete(job.objectKey);
      }
    } catch (error) {
      const code = errorCode(error);
      // A partially written failed attempt has no durable document reference.
      // The lease-specific key makes cleanup safe even after a newer claim.
      try {
        await dependencies.media.storage.delete(job.objectKey);
      } catch {
        // The persisted error status remains the operator-facing evidence.
      }
      const outcome = await dependencies.jobs.markError(job, {
        code,
        terminal: TERMINAL_CODES.has(code),
        manualReupload: MANUAL_CODES.has(code),
        now,
      });
      if (outcome === "retried") summary.retried += 1;
      else if (outcome === "failed") summary.failed += 1;
      else if (outcome === "manual_reupload") summary.manualReupload += 1;
      else summary.superseded += 1;
    }
  }
  return summary;
}
