import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  createWorkItemRepository,
  type PersistedWorkItem,
  type WorkItemRepository,
} from "./repository";
import {
  acknowledgeWorkItemForActor,
  assignWorkItemForActor,
  recommendWorkItemAssigneesForActor,
  withAuthorizedWorkItemRepository,
} from "./server-fns";

const teamId = "10000000-0000-0000-0000-000000000001";
const userId = "20000000-0000-0000-0000-000000000001";
const manager: AuthenticatedActor = {
  authUserId: "auth-manager",
  userId,
  role: "Manager",
  teamId,
  active: true,
};
const workItem = {
  id: "50000000-0000-0000-0000-000000000001",
  teamId,
} as PersistedWorkItem;

describe("work queue server orchestration", () => {
  it("derives the actor before repository access and always closes the repository", async () => {
    const close = vi.fn(async () => undefined);
    const repository = { close } as unknown as WorkItemRepository;
    const requireActor = vi.fn(async () => manager);
    const createRepository = vi.fn(() => repository) as unknown as typeof createWorkItemRepository;
    const request = new Request("https://example.test/work-queue");

    await expect(
      withAuthorizedWorkItemRepository(
        async (receivedRepository, receivedActor) => {
          expect(receivedRepository).toBe(repository);
          expect(receivedActor).toBe(manager);
          return "ok";
        },
        { request, requireActor, createRepository },
      ),
    ).resolves.toBe("ok");
    expect(requireActor).toHaveBeenCalledWith(request);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not create a repository when verified staff authorization fails", async () => {
    const createRepository = vi.fn() as unknown as typeof createWorkItemRepository;
    await expect(
      withAuthorizedWorkItemRepository(async () => undefined, {
        request: new Request("https://example.test/work-queue"),
        requireActor: async () => {
          throw new Error("Unauthorized: verified session required.");
        },
        createRepository,
      }),
    ).rejects.toThrow(/unauthorized/i);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("passes verified actor identity and manager team into the locked assignment", async () => {
    const assign = vi.fn(async () => workItem);
    const repository = {
      get: vi.fn(async () => workItem),
      assign,
    } as unknown as WorkItemRepository;

    await assignWorkItemForActor(repository, manager, {
      workItemId: workItem.id,
      assigneeId: "20000000-0000-0000-0000-000000000003",
      expectedVersion: 3,
      assignmentTarget: "owner",
    });

    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ assignedById: userId, expectedTeamId: teamId }),
    );
  });

  it("authorizes manager recommendations inside the repository lock", async () => {
    const recommendAssignees = vi.fn(async () => []);
    const get = vi.fn();
    const repository = { recommendAssignees, get } as unknown as WorkItemRepository;

    await recommendWorkItemAssigneesForActor(repository, manager, workItem.id);

    expect(get).not.toHaveBeenCalled();
    expect(recommendAssignees).toHaveBeenCalledWith(workItem.id, {
      expectedTeamId: teamId,
    });
  });

  it("passes verified actor identity and manager team into acknowledgement", async () => {
    const acknowledgeEscalation = vi.fn(async () => workItem);
    const repository = {
      get: vi.fn(async () => workItem),
      acknowledgeEscalation,
    } as unknown as WorkItemRepository;

    await acknowledgeWorkItemForActor(repository, manager, {
      workItemId: workItem.id,
      note: "Reviewed with the filing team.",
    });

    expect(acknowledgeEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: userId, expectedTeamId: teamId }),
    );
  });
});
