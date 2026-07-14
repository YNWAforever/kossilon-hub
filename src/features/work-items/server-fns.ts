import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { requireStaffActor } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { createWorkItemRepository, PersistedWorkItem, QueueFilters } from "./repository";

const loadWorkItemServerDependencies = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createWorkItemRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);

  return {
    request: getRequest(),
    requireActor: requireStaffActor,
    createRepository: createWorkItemRepository,
  };
});

const escalationStateSchema = z.enum(["none", "warning", "breach", "acknowledged"]);

export const listWorkQueueInputSchema = z
  .object({
    view: z.enum(["mine", "team", "breached"]).default("mine"),
    ownerId: z.string().uuid().optional(),
    escalationState: escalationStateSchema.optional(),
  })
  .strict()
  .default({});

export const workItemIdInputSchema = z.object({ workItemId: z.string().uuid() }).strict();

export const assignWorkItemInputSchema = z
  .object({
    workItemId: z.string().uuid(),
    assigneeId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    assignmentTarget: z.enum(["owner", "reviewer"]).default("owner"),
    overrideReason: z.string().trim().min(1).optional(),
  })
  .strict();

export const acknowledgeWorkItemInputSchema = z
  .object({
    workItemId: z.string().uuid(),
    note: z.string().trim().min(1),
  })
  .strict();

type RequestedQueueFilters = z.output<typeof listWorkQueueInputSchema>;

function requireStaffUserId(actor: AuthenticatedActor): string {
  if (!actor.userId) throw new Error("Forbidden: staff user profile is required.");
  return actor.userId;
}

export function queueFiltersForActor(
  actor: AuthenticatedActor,
  requested: RequestedQueueFilters,
): QueueFilters {
  const shared = { escalationState: requested.escalationState };
  const mine = requested.view === "mine";
  if (actor.role === "Admin") {
    return {
      ...shared,
      ownerId: mine ? requireStaffUserId(actor) : requested.ownerId,
    };
  }
  if (!actor.teamId) throw new Error("Forbidden: staff actor has no assigned team.");
  if (actor.role === "Manager") {
    return {
      ...shared,
      ownerId: mine ? requireStaffUserId(actor) : requested.ownerId,
      teamId: actor.teamId,
    };
  }
  if (actor.role === "Staff") {
    return { ...shared, ownerId: requireStaffUserId(actor), teamId: actor.teamId };
  }
  throw new Error("Forbidden: staff access is required.");
}

export function assertActorCanAssignWorkItem(
  actor: AuthenticatedActor,
  workItem: PersistedWorkItem,
): void {
  if (actor.role === "Admin") return;
  if (actor.role !== "Manager") throw new Error("Forbidden: Manager or Admin access is required.");
  if (!actor.teamId || workItem.teamId !== actor.teamId) {
    throw new Error("Forbidden: managers can assign work only within their team.");
  }
}

export type WorkItemServerDependencies = {
  request: Request;
  requireActor: typeof requireStaffActor;
  createRepository: typeof createWorkItemRepository;
};

export async function withAuthorizedWorkItemRepository<T>(
  handler: (
    repository: ReturnType<typeof createWorkItemRepository>,
    actor: AuthenticatedActor,
  ) => Promise<T>,
  dependencies: WorkItemServerDependencies,
): Promise<T> {
  const actor = await dependencies.requireActor(dependencies.request);
  const repository = dependencies.createRepository();
  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}

const withDefaultAuthorizedWorkItemRepository = createServerOnlyFn(
  async <T>(
    handler: (
      repository: ReturnType<typeof createWorkItemRepository>,
      actor: AuthenticatedActor,
    ) => Promise<T>,
  ): Promise<T> => {
    const dependencies = await loadWorkItemServerDependencies();
    return withAuthorizedWorkItemRepository(handler, dependencies);
  },
);

async function requireAssignableWorkItem(
  repository: ReturnType<typeof createWorkItemRepository>,
  actor: AuthenticatedActor,
  workItemId: string,
): Promise<PersistedWorkItem> {
  const workItem = await repository.get(workItemId);
  if (!workItem) throw new Error("Work item not found.");
  assertActorCanAssignWorkItem(actor, workItem);
  return workItem;
}

function expectedManagerTeamId(actor: AuthenticatedActor): string | undefined {
  return actor.role === "Manager" ? (actor.teamId ?? undefined) : undefined;
}

export async function recommendWorkItemAssigneesForActor(
  repository: ReturnType<typeof createWorkItemRepository>,
  actor: AuthenticatedActor,
  workItemId: string,
) {
  if (actor.role !== "Admin" && actor.role !== "Manager") {
    throw new Error("Forbidden: Manager or Admin access is required.");
  }
  return repository.recommendAssignees(workItemId, {
    expectedTeamId: expectedManagerTeamId(actor),
  });
}

export async function assignWorkItemForActor(
  repository: ReturnType<typeof createWorkItemRepository>,
  actor: AuthenticatedActor,
  data: z.output<typeof assignWorkItemInputSchema>,
) {
  await requireAssignableWorkItem(repository, actor, data.workItemId);
  return repository.assign({
    workItemId: data.workItemId,
    selectedUserId: data.assigneeId,
    assignedById: requireStaffUserId(actor),
    expectedVersion: data.expectedVersion,
    assignmentTarget: data.assignmentTarget,
    overrideReason: data.overrideReason,
    expectedTeamId: expectedManagerTeamId(actor),
  });
}

export async function acknowledgeWorkItemForActor(
  repository: ReturnType<typeof createWorkItemRepository>,
  actor: AuthenticatedActor,
  data: z.output<typeof acknowledgeWorkItemInputSchema>,
) {
  await requireAssignableWorkItem(repository, actor, data.workItemId);
  return repository.acknowledgeEscalation({
    workItemId: data.workItemId,
    actorId: requireStaffUserId(actor),
    note: data.note,
    expectedTeamId: expectedManagerTeamId(actor),
  });
}

export const listWorkQueue = createServerFn({ method: "GET" })
  .validator(listWorkQueueInputSchema)
  .handler(({ data }) =>
    withDefaultAuthorizedWorkItemRepository((repository, actor) =>
      repository.listQueue(queueFiltersForActor(actor, data)),
    ),
  );

export const recommendWorkItemAssignees = createServerFn({ method: "GET" })
  .validator(workItemIdInputSchema)
  .handler(({ data }) =>
    withDefaultAuthorizedWorkItemRepository((repository, actor) =>
      recommendWorkItemAssigneesForActor(repository, actor, data.workItemId),
    ),
  );

export const assignWorkItem = createServerFn({ method: "POST" })
  .validator(assignWorkItemInputSchema)
  .handler(({ data }) =>
    withDefaultAuthorizedWorkItemRepository((repository, actor) =>
      assignWorkItemForActor(repository, actor, data),
    ),
  );

export const acknowledgeWorkItemEscalation = createServerFn({ method: "POST" })
  .validator(acknowledgeWorkItemInputSchema)
  .handler(({ data }) =>
    withDefaultAuthorizedWorkItemRepository((repository, actor) =>
      acknowledgeWorkItemForActor(repository, actor, data),
    ),
  );
