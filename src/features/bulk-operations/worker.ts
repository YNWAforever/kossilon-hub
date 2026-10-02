import type { AuthenticatedActor } from "@/features/auth/types";
import type { BulkOperationsRepository } from "./repository";
/** Existing SQL-only job engine: assignments, metadata exports and drafts. Never dispatches providers. */
export async function runBulkAssignmentChunk({
  repository,
  actor,
  jobId,
  chunkSize = 100,
  afterCommit,
}: {
  repository: BulkOperationsRepository;
  actor: AuthenticatedActor;
  jobId: string;
  chunkSize?: number;
  afterCommit?: () => void | Promise<void>;
}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 100)
    throw new Error("Bulk chunk must contain1..100 items.");
  const lease = await repository.claim(actor, jobId);
  if (!lease) return { processed: 0, claimed: false };
  let processed = 0;
  for (let i = 0; i < chunkSize; i++) {
    if (!(await repository.processNext(lease))) break;
    processed++;
    await afterCommit?.();
  }
  await repository.finishChunk(lease);
  return { processed, claimed: true };
}

/** Existing maintenance tick processes one bounded SQL-only chunk. */
export async function runScheduledBulkAssignments({
  repository,
  chunkSize = 100,
}: {
  repository: BulkOperationsRepository;
  chunkSize?: number;
}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 100)
    throw new Error("Bulk chunk must contain1..100 items.");
  const lease = await repository.claimScheduled();
  if (!lease) return { jobs: 0, processed: 0 };
  let processed = 0;
  for (let i = 0; i < chunkSize; i++) {
    if (!(await repository.processNext(lease))) break;
    processed++;
  }
  await repository.finishChunk(lease);
  return { jobs: 1, processed };
}
