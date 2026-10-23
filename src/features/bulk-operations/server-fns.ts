import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { BulkOperationsRepository } from "./repository";
import { assertBulkManager } from "./authorization";
import {
  snapshotSchema,
  previewSchema,
  executeSchema,
  jobSchema,
  resultsSchema,
  jobHistorySchema,
  previewActionSchema,
} from "./types";
export async function previewBulkForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repository: Pick<BulkOperationsRepository, "preview">,
) {
  assertBulkManager(actor);
  return repository.preview(actor, previewSchema.parse(input));
}
export async function executeBulkForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repository: Pick<BulkOperationsRepository, "execute">,
) {
  assertBulkManager(actor);
  return repository.execute(actor, executeSchema.parse(input));
}
const context = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireStaffActor },
    { currentProviderMode },
    { createBulkOperationsRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("@/server/provider-mode"),
    import("./repository"),
  ]);
  if (currentProviderMode() !== "live") throw new Error("Demo bulk operations are read-only.");
  const actor = await requireStaffActor(getRequest());
  assertBulkManager(actor);
  return { actor, repository: createBulkOperationsRepository() };
});
export const createBulkSelectionSnapshot = createServerFn({ method: "POST" })
  .validator(snapshotSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.createSnapshot(actor, data);
  });
export const previewBulkAssignment = createServerFn({ method: "POST" })
  .validator(previewSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return previewBulkForActor(actor, data, repository);
  });
export const previewBulkMaintenance = createServerFn({ method: "POST" })
  .validator(previewActionSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.previewAction(actor, data);
  });
export const executeBulkAssignment = createServerFn({ method: "POST" })
  .validator(executeSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return executeBulkForActor(actor, data, repository);
  });
export const getBulkJob = createServerFn({ method: "GET" })
  .validator(resultsSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.getJob(actor, data);
  });
export const listBulkJobs = createServerFn({ method: "GET" })
  .validator(jobHistorySchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.listJobs(actor, data);
  });
export const resumeBulkJob = createServerFn({ method: "POST" })
  .validator(jobSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    const { runBulkAssignmentChunk } = await import("./worker");
    return runBulkAssignmentChunk({ repository, actor, jobId: data.jobId });
  });
export const cancelBulkJob = createServerFn({ method: "POST" })
  .validator(jobSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.cancel(actor, data.jobId);
  });
export const retryFailedBulkItems = createServerFn({ method: "POST" })
  .validator(jobSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.retryFailed(actor, data.jobId);
  });
export const reconcileUnknownBulkItems = createServerFn({ method: "POST" })
  .validator(jobSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.reconcileUnknown(actor, data.jobId);
  });
export const listBulkAssignees = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        q: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.listAssignees(actor, data);
  });
export const getBulkSnapshotMembership = createServerFn({ method: "GET" })
  .validator(
    z.object({ snapshotId: z.string().uuid(), ids: z.array(z.string().uuid()).max(5000) }).strict(),
  )
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.snapshotMembership(actor, data);
  });
export async function exportBulkResultsForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repository: Pick<BulkOperationsRepository, "getJob">,
) {
  assertBulkManager(actor);
  const data = jobSchema.parse(input);
  let cursor: number | undefined;
  const lines = ["item,state,reason,attempts,output_json"];
  const ordinals = new Set<number>();
  let exported = 0,
    expectedTotal: number | undefined,
    fingerprint: string | undefined;
  const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
  do {
    const page = await repository.getJob(actor, { jobId: data.jobId, cursor, limit: 100 });
    const current = JSON.stringify([
      page.jobId,
      page.payloadHash,
      page.total,
      page.updatedAt,
      page.state,
      page.operation,
      page.createdBy,
    ]);
    if (
      page.jobId !== data.jobId ||
      !Number.isSafeInteger(page.total) ||
      page.total < 0 ||
      (fingerprint !== undefined && fingerprint !== current)
    )
      throw conflict("Saved export scope changed. Refresh the job and retry.");
    fingerprint = current;
    expectedTotal = page.total;
    for (const i of page.items) {
      if (!Number.isSafeInteger(i.ordinal) || i.ordinal < 0 || ordinals.has(i.ordinal))
        throw conflict("Inconsistent export pagination. Refresh the job and retry.");
      ordinals.add(i.ordinal);
      // A current access denial is a scope disposition, not a vanished row.
      // Preserve its count while withholding identity, labels and prior output.
      const visible = Boolean(i.resourceId);
      const values = [
        visible ? i.resourceId! : "",
        visible ? i.state : "forbidden",
        visible ? (i.reason ?? "") : "access_denied",
        String(i.attempts),
        visible && i.output ? JSON.stringify(i.output) : "",
      ];
      lines.push(values.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","));
      exported++;
      if (exported > expectedTotal) throw conflict("Incomplete or inconsistent export total.");
    }
    const next = page.nextCursor;
    if (next !== null && (!Number.isSafeInteger(next) || next <= (cursor ?? 0)))
      throw conflict("Inconsistent export pagination. Refresh the job and retry.");
    cursor = next ?? undefined;
  } while (cursor !== undefined);
  if (exported !== expectedTotal) throw conflict("Incomplete export. Refresh the job and retry.");
  return { csv: lines.join("\n") + "\n", exported };
}
export const exportBulkResults = createServerFn({ method: "GET" })
  .validator(jobSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return exportBulkResultsForActor(actor, data, repository);
  });
