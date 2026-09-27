import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { requireStaffActor } from "@/features/auth/neon-auth-server";
import type { createBulkOperationRepository } from "./repository";
import {
  bulkCommitInputSchema,
  bulkExportInputSchema,
  bulkPreviewInputSchema,
  type BulkOperationView,
} from "./types";
import { csvCell } from "./resource-export";

const operationIdSchema = z.object({ id: z.string().uuid() }).strict();
type Repository = ReturnType<typeof createBulkOperationRepository>;

const loadBulkServerDependencies = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createBulkOperationRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return {
    request: getRequest(),
    requireActor: requireStaffActor,
    createRepository: createBulkOperationRepository,
  };
});

export type BulkServerDependencies = {
  request: Request;
  requireActor: typeof requireStaffActor;
  createRepository: typeof createBulkOperationRepository;
};
export async function withAuthorizedBulkRepository<T>(
  handler: (repository: Repository, actor: AuthenticatedActor) => Promise<T>,
  supplied?: BulkServerDependencies,
): Promise<T> {
  const dependencies = supplied ?? (await loadBulkServerDependencies());
  const actor = await dependencies.requireActor(dependencies.request);
  const repository = dependencies.createRepository();
  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}

export async function previewBulkOperationForActor(
  actor: AuthenticatedActor,
  input: z.input<typeof bulkPreviewInputSchema>,
  repository: Repository,
) {
  return repository.preview(actor, bulkPreviewInputSchema.parse(input));
}
export async function commitBulkOperationForActor(
  actor: AuthenticatedActor,
  input: z.input<typeof bulkCommitInputSchema>,
  repository: Repository,
) {
  return repository.commit(actor, bulkCommitInputSchema.parse(input));
}
export async function getBulkOperationForActor(
  actor: AuthenticatedActor,
  id: string,
  repository: Repository,
) {
  return repository.get(actor, operationIdSchema.parse({ id }).id);
}
export async function cancelBulkOperationForActor(
  actor: AuthenticatedActor,
  id: string,
  repository: Repository,
) {
  return repository.cancel(actor, operationIdSchema.parse({ id }).id);
}

/** Export only operational identifiers and fixed reason codes; no customer or provider payload. */
export function bulkOperationCsv(view: BulkOperationView): string {
  const header = [
    "operationId",
    "itemId",
    "resourceId",
    "state",
    "reasonCode",
    "revisionBefore",
    "revisionAfter",
    "auditRef",
  ];
  const rows = view.items.map((item) => [
    view.id,
    item.itemId,
    item.resourceId,
    item.state,
    item.reasonCode,
    item.revisionBefore,
    item.revisionAfter,
    item.auditRef,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const previewBulkOperation = createServerFn({ method: "POST" })
  .validator(bulkPreviewInputSchema)
  .handler(({ data }) =>
    withAuthorizedBulkRepository((repository, actor) =>
      previewBulkOperationForActor(actor, data, repository),
    ),
  );
export const commitBulkOperation = createServerFn({ method: "POST" })
  .validator(bulkCommitInputSchema)
  .handler(({ data }) =>
    withAuthorizedBulkRepository((repository, actor) =>
      commitBulkOperationForActor(actor, data, repository),
    ),
  );
export const getBulkOperation = createServerFn({ method: "GET" })
  .validator(operationIdSchema)
  .handler(({ data }) =>
    withAuthorizedBulkRepository((repository, actor) =>
      getBulkOperationForActor(actor, data.id, repository),
    ),
  );
export const cancelBulkOperation = createServerFn({ method: "POST" })
  .validator(operationIdSchema)
  .handler(({ data }) =>
    withAuthorizedBulkRepository((repository, actor) =>
      cancelBulkOperationForActor(actor, data.id, repository),
    ),
  );
export const exportBulkOperationCsv = createServerFn({ method: "GET" })
  .validator(operationIdSchema)
  .handler(({ data }) =>
    withAuthorizedBulkRepository(async (repository, actor) =>
      bulkOperationCsv(await getBulkOperationForActor(actor, data.id, repository)),
    ),
  );

export const exportResourceSelectionCsv = createServerFn({ method: "POST" })
  .validator(bulkExportInputSchema)
  .handler(({ data }) =>
    withAuthorizedBulkRepository((repository, actor) => repository.exportSelection(actor, data)),
  );
