import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentStorage } from "@/features/documents/types";
import type { NarImportStageJobRepository } from "./stage-jobs";
import type { NarSheetReadResult } from "./mapping";
import { XlsxFormatError } from "./xlsx/workbook";
import { NarImportValidationError } from "./server-fns";

export type StageWorkbook = (
  actor: AuthenticatedActor,
  input: { fileName: string; bytes: Uint8Array; sheetName?: string; returnYear: number },
) => Promise<{
  batch: { id: string };
  reused: boolean;
  skippedRowNumbers: number[];
  sheetIssues: NarSheetReadResult["issues"];
}>;
export type StageWorkerDependencies = {
  jobs: NarImportStageJobRepository;
  storage: Pick<DocumentStorage, "get" | "delete">;
  stage: StageWorkbook;
};
export type StageDrainSummary = {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  cleaned: number;
};

async function sha256Hex(body: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(body).buffer),
  );
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Scheduled pass. A crash after domain staging can replay safely: stageBatch is byte-key idempotent. */
export async function drainNarImportStageJobs(
  now: string,
  dependencies: StageWorkerDependencies,
  limit = 2,
): Promise<StageDrainSummary> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new Error("Invalid stage drain limit.");
  const summary: StageDrainSummary = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    cleaned: 0,
  };
  summary.failed += await dependencies.jobs.failExhausted(now);
  for (let index = 0; index < limit; index += 1) {
    const job = await dependencies.jobs.claimOne(now);
    if (!job) break;
    if (!job.leaseToken) throw new Error("Import stage job has no lease token.");
    summary.claimed += 1;
    const token = job.leaseToken;
    const actor = await dependencies.jobs.activeAdminActor(job.createdBy);
    if (!actor) {
      if (!(await dependencies.jobs.fail(job.id, token, "creator_not_admin", true))) {
        throw new Error("Import stage job lease changed.");
      }
      summary.failed += 1;
      continue;
    }
    try {
      const object = await dependencies.storage.get(job.objectKey);
      if (
        !object ||
        object.checksum !== job.sourceSha256 ||
        object.sizeBytes !== job.sourceSizeBytes ||
        object.contentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ) {
        if (!(await dependencies.jobs.fail(job.id, token, "source_object_invalid", true))) {
          throw new Error("Import stage job lease changed.");
        }
        summary.failed += 1;
        continue;
      }
      const bytes = new Uint8Array(object.body);
      if (
        bytes.byteLength !== job.sourceSizeBytes ||
        (await sha256Hex(bytes)) !== job.sourceSha256
      ) {
        if (!(await dependencies.jobs.fail(job.id, token, "source_checksum_invalid", true))) {
          throw new Error("Import stage job lease changed.");
        }
        summary.failed += 1;
        continue;
      }
      const staged = await dependencies.stage(actor, {
        fileName: job.sourceFileName,
        bytes,
        sheetName: job.sheetName ?? undefined,
        returnYear: job.returnYear,
      });
      const complete = await dependencies.jobs.complete(job.id, token, {
        batchId: staged.batch.id,
        reused: staged.reused,
        skippedRowNumbers: staged.skippedRowNumbers,
        sheetIssues: staged.sheetIssues,
      });
      if (!complete) throw new Error("Import stage job lease changed.");
      summary.succeeded += 1;
    } catch (error) {
      // Once another worker owns the lease, the result is unknown. Do not mark
      // that newer lease failed or present a staged batch as a failed parse.
      if (error instanceof Error && error.message === "Import stage job lease changed.")
        throw error;
      const invalidWorkbook =
        error instanceof XlsxFormatError || error instanceof NarImportValidationError;
      const failed = invalidWorkbook
        ? await dependencies.jobs.fail(
            job.id,
            token,
            "invalid_workbook",
            true,
            error.message.slice(0, 500),
          )
        : await dependencies.jobs.fail(job.id, token, "parse_or_stage_failed", false);
      if (!failed) throw new Error("Import stage job lease changed.");
      if (invalidWorkbook || job.attempts >= 3) summary.failed += 1;
      else summary.retried += 1;
    }
  }
  // Terminal source bytes should not outlive their job. A failed R2 delete is
  // left visible in the table and retried by the next scheduled pass.
  for (const job of await dependencies.jobs.listCleanupCandidates(10)) {
    await dependencies.storage.delete(job.objectKey);
    if (await dependencies.jobs.markObjectDeleted(job.id)) summary.cleaned += 1;
  }
  return summary;
}
