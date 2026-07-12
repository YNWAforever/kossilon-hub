import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { PersistedWorkItem } from "./repository";
import {
  assignWorkItemInputSchema,
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
  const sidebarSource = readFileSync(
    new URL("../../components/app-sidebar.tsx", import.meta.url),
    "utf8",
  );
  const repositorySource = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");

  it("registers the daily queue with its operational views", () => {
    expect(routeSource).toContain('createFileRoute("/work-queue")');
    expect(routeSource).toContain("My work");
    expect(routeSource).toContain("Team queue");
    expect(routeSource).toContain("Breached");
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
