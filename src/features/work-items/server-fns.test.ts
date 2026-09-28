import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { createWorkItemRepository, PersistedWorkItem } from "./repository";
import {
  attachWorkItemPolicyForActor,
  attachWorkItemPolicyInputSchema,
  assignWorkItemInputSchema,
  listWorkItemPolicyChoicesForActor,
  workItemPolicyChoicesInputSchema,
  previewWorkItemPolicyForActor,
  previewWorkItemPolicyInputSchema,
  assertActorCanAssignWorkItem,
  listWorkQueueInputSchema,
  queueFiltersForActor,
} from "./server-fns";

const teamOne = "10000000-0000-0000-0000-000000000001";
const teamTwo = "10000000-0000-0000-0000-000000000002";
const userId = "20000000-0000-0000-0000-000000000001";

function actor(role: "Admin" | "Manager" | "Staff"): AuthenticatedActor {
  return { authUserId: `auth-${role}`, userId, role, teamId: teamOne, active: true };
}

const workItem = {
  id: "50000000-0000-0000-0000-000000000001",
  teamId: teamOne,
} as PersistedWorkItem;

describe("work queue server authorization", () => {
  it("loads request access only inside the server handler", () => {
    const source = readFileSync(new URL("./server-fns.ts", import.meta.url), "utf8");

    expect(source).not.toContain('import { getRequest } from "@tanstack/react-start/server"');
    expect(source).not.toContain(
      'import { requireStaffActor } from "@/features/auth/neon-auth-server"',
    );
    expect(source).not.toContain("import { createWorkItemRepository");
    expect(source).toContain("createServerOnlyFn");
    expect(source).toContain('import("@tanstack/react-start/server")');
  });

  it("accepts assignment IDs and version without accepting actor authority", () => {
    expect(
      assignWorkItemInputSchema.safeParse({
        workItemId: workItem.id,
        assigneeId: "20000000-0000-0000-0000-000000000003",
        expectedVersion: 3,
      }).success,
    ).toBe(true);
    expect(
      assignWorkItemInputSchema.safeParse({
        workItemId: workItem.id,
        assigneeId: "20000000-0000-0000-0000-000000000003",
        expectedVersion: 3,
        actorId: userId,
        role: "Admin",
      }).success,
    ).toBe(false);
    expect(listWorkQueueInputSchema.safeParse({ view: "team", teamId: teamTwo }).success).toBe(
      false,
    );
  });

  it("requires a server-authenticated Admin for policy preview and attachment", async () => {
    const selection = {
      workItemId: workItem.id,
      policyVersionId: "40000000-0000-0000-0000-000000000001",
      expectedVersion: 2,
    };
    const preview = {
      ...selection,
      startedAt: "2026-09-28T01:00:00.000Z",
      warningAt: "2026-09-28T02:00:00.000Z",
      dueAt: "2026-09-28T03:00:00.000Z",
      previewHash: "a".repeat(64),
    };
    const listAttachablePolicies = vi.fn().mockResolvedValue([]);
    const previewPolicyAttachment = vi.fn().mockResolvedValue(preview);
    const attachPolicy = vi.fn().mockResolvedValue(workItem);
    const repository = {
      listAttachablePolicies,
      previewPolicyAttachment,
      attachPolicy,
    } as unknown as ReturnType<typeof createWorkItemRepository>;
    expect(
      workItemPolicyChoicesInputSchema.safeParse({ ...selection, actorId: userId }).success,
    ).toBe(false);
    expect(
      previewWorkItemPolicyInputSchema.safeParse({ ...selection, actorId: userId }).success,
    ).toBe(false);
    expect(attachWorkItemPolicyInputSchema.safeParse({ ...preview, actorId: userId }).success).toBe(
      false,
    );
    for (const role of ["Staff", "Manager"] as const) {
      await expect(
        listWorkItemPolicyChoicesForActor(repository, actor(role), selection),
      ).rejects.toThrow(/Admin/);
      await expect(
        previewWorkItemPolicyForActor(repository, actor(role), selection),
      ).rejects.toThrow(/Admin/);
      await expect(attachWorkItemPolicyForActor(repository, actor(role), preview)).rejects.toThrow(
        /Admin/,
      );
    }
    expect(listAttachablePolicies).not.toHaveBeenCalled();
    expect(previewPolicyAttachment).not.toHaveBeenCalled();
    expect(attachPolicy).not.toHaveBeenCalled();
    await expect(
      listWorkItemPolicyChoicesForActor(repository, actor("Admin"), selection),
    ).resolves.toEqual([]);
    await expect(
      previewWorkItemPolicyForActor(repository, actor("Admin"), selection),
    ).resolves.toEqual(preview);
    await expect(attachWorkItemPolicyForActor(repository, actor("Admin"), preview)).resolves.toBe(
      workItem,
    );
    expect(attachPolicy).toHaveBeenCalledWith({ ...preview, actorId: userId });
  });

  it("scopes staff to their work, managers to their team, and admins to requested filters", () => {
    expect(queueFiltersForActor(actor("Staff"), { view: "team" })).toMatchObject({
      ownerId: userId,
      teamId: teamOne,
    });
    expect(queueFiltersForActor(actor("Manager"), { view: "mine" })).toMatchObject({
      ownerId: userId,
      teamId: teamOne,
    });
    expect(queueFiltersForActor(actor("Manager"), { view: "team", ownerId: userId })).toMatchObject(
      {
        ownerId: userId,
        teamId: teamOne,
      },
    );
    expect(queueFiltersForActor(actor("Admin"), { view: "team" })).toEqual({
      escalationState: undefined,
      ownerId: undefined,
    });
  });

  it("denies Staff assignment, limits Manager assignment to their team, and allows Admin", () => {
    expect(() => assertActorCanAssignWorkItem(actor("Staff"), workItem)).toThrow(/manager|admin/i);
    expect(() =>
      assertActorCanAssignWorkItem(actor("Manager"), { ...workItem, teamId: teamTwo }),
    ).toThrow(/team/i);
    expect(assertActorCanAssignWorkItem(actor("Manager"), workItem)).toBeUndefined();
    expect(
      assertActorCanAssignWorkItem(actor("Admin"), { ...workItem, teamId: teamTwo }),
    ).toBeUndefined();
  });
});

describe("work queue route contract", () => {
  const routePath = new URL("../../routes/work-queue.tsx", import.meta.url);
  const routeSource = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
  // Destinations moved out of app-sidebar.tsx into the shared navigation config
  // that both the desktop sidebar and the mobile drawer render.
  const sidebarSource = readFileSync(
    new URL("../../components/navigation.ts", import.meta.url),
    "utf8",
  );
  const repositorySource = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");

  it("registers the daily queue with its operational views", () => {
    expect(routeSource).toContain('createFileRoute("/work-queue")');
    expect(routeSource).toContain("我的工作");
    expect(routeSource).toContain("團隊工作");
    expect(routeSource).toContain("已逾期");
    expect(sidebarSource).toContain("/work-queue");
    expect(routeSource).toContain('role="table"');
    expect(routeSource).toContain("Filter by owner");
    expect(routeSource).toContain("Filter by work type");
    expect(routeSource).toContain("Filter by SLA state");
    expect(routeSource).toContain("Company");
    expect(routeSource).toContain("Blocker");
    expect(repositorySource).toContain("getWorkItem(tx, id, true)");
    expect(repositorySource).toContain("recommendationOptions.expectedTeamId");
  });
});
