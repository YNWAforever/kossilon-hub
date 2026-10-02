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
export const exportBulkResults = createServerFn({ method: "GET" })
  .validator(jobSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    let cursor: number | undefined;
    const lines = ["item,state,reason,attempts,output_json"];
    let exported = 0;
    do {
      const page = await repository.getJob(actor, { jobId: data.jobId, cursor, limit: 100 });
      for (const i of page.items) {
        if (!i.resourceId) continue;
        const values = [
          i.resourceId,
          i.state,
          i.reason ?? "",
          String(i.attempts),
          i.output ? JSON.stringify(i.output) : "",
        ];
        lines.push(values.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","));
        exported++;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return { csv: lines.join("\n") + "\n", exported };
  });
