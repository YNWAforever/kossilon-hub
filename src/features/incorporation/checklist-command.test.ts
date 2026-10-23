import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { IncorporationCase } from "./types";
import { updateIncorporationChecklistItemForActor } from "./server-fns";

const teamId = "10000000-0000-4000-8000-000000000001";
const otherTeamId = "10000000-0000-4000-8000-000000000002";
const actor: AuthenticatedActor = {
  authUserId: "synthetic-checklist-staff",
  userId: "20000000-0000-4000-8000-000000000001",
  role: "Staff",
  teamId,
  active: true,
};
const input = {
  caseId: "30000000-0000-4000-8000-000000000001",
  itemId: "40000000-0000-4000-8000-000000000001",
  status: "Received" as const,
  note: "已收正本\nKeep the supplied note exactly.  ",
};

function repository() {
  const saved = { id: input.caseId, checklist: [] } as unknown as IncorporationCase;
  return {
    saved,
    getCaseTeamId: vi.fn(async (_caseId: string): Promise<string | null> => teamId),
    updateChecklistItem: vi.fn(async () => saved),
  };
}

describe("UC159 existing incorporation checklist command contract", () => {
  it.each([
    ["Staff", teamId],
    ["Manager", teamId],
    ["Admin", otherTeamId],
    ["Admin", null],
  ] as const)("allows active %s with team %s under the existing policy", async (role, assigned) => {
    const repo = repository();
    const result = await updateIncorporationChecklistItemForActor(
      { ...actor, role, teamId: assigned },
      input,
      repo,
    );
    expect(result).toBe(repo.saved);
    expect(repo.getCaseTeamId).toHaveBeenCalledExactlyOnceWith(input.caseId);
    expect(repo.updateChecklistItem).toHaveBeenCalledExactlyOnceWith({
      ...input,
      actorId: actor.userId,
    });
    expect(repo.getCaseTeamId.mock.invocationCallOrder[0]).toBeLessThan(
      repo.updateChecklistItem.mock.invocationCallOrder[0],
    );
  });

  it.each(["Missing", "Received", "Verified", "Rejected"] as const)(
    "keeps the existing %s literal and nullable note schema",
    async (status) => {
      const repo = repository();
      await updateIncorporationChecklistItemForActor(actor, { ...input, status, note: null }, repo);
      expect(repo.updateChecklistItem).toHaveBeenCalledExactlyOnceWith({
        ...input,
        status,
        note: null,
        actorId: actor.userId,
      });
    },
  );

  it.each([
    ["Client", { ...actor, role: "Client" as const }, /staff access is required/],
    ["inactive Staff", { ...actor, active: false }, /inactive users/],
    ["inactive Admin", { ...actor, role: "Admin" as const, active: false }, /inactive users/],
    ["another team", { ...actor, teamId: otherTeamId }, /another team/],
    ["no assigned team", { ...actor, teamId: null }, /no assigned team/],
    ["no database identity", { ...actor, userId: null }, /database identity is required/],
    ["empty database identity", { ...actor, userId: "" }, /database identity is required/],
  ] as const)("refuses %s without attempting an item update", async (_name, denied, message) => {
    const repo = repository();
    await expect(updateIncorporationChecklistItemForActor(denied, input, repo)).rejects.toThrow(
      message,
    );
    expect(repo.updateChecklistItem).not.toHaveBeenCalled();
    if (!denied.userId) expect(repo.getCaseTeamId).not.toHaveBeenCalled();
  });

  it("refuses a missing case without attempting an item update", async () => {
    const repo = repository();
    repo.getCaseTeamId.mockResolvedValueOnce(null);
    await expect(updateIncorporationChecklistItemForActor(actor, input, repo)).rejects.toThrow(
      "Incorporation case not found.",
    );
    expect(repo.updateChecklistItem).not.toHaveBeenCalled();
  });

  it.each([
    ["null input", null],
    ["missing fields", {}],
    ["invalid case UUID", { ...input, caseId: "another-case" }],
    ["invalid item UUID", { ...input, itemId: "another-item" }],
    ["unknown status", { ...input, status: "Approved" }],
    ["wrong note type", { ...input, note: 42 }],
    ["missing note", { caseId: input.caseId, itemId: input.itemId, status: input.status }],
  ])("rejects malformed payload %s before repository access", async (_name, malformed) => {
    const repo = repository();
    await expect(
      updateIncorporationChecklistItemForActor(actor, malformed, repo),
    ).rejects.toMatchObject({
      name: "ZodError",
      issues: expect.any(Array),
    });
    expect(repo.getCaseTeamId).not.toHaveBeenCalled();
    expect(repo.updateChecklistItem).not.toHaveBeenCalled();
  });

  it("uses only the supplied authenticated actor identity and strips forged authority", async () => {
    const repo = repository();
    await updateIncorporationChecklistItemForActor(
      actor,
      { ...input, actorId: "forged", userId: "forged", role: "Admin", teamId: otherTeamId },
      repo,
    );
    expect(repo.updateChecklistItem).toHaveBeenCalledExactlyOnceWith({
      ...input,
      actorId: actor.userId,
    });
  });

  it("does not let forged Admin input grant a Client access", async () => {
    const repo = repository();
    await expect(
      updateIncorporationChecklistItemForActor(
        { ...actor, role: "Client" },
        { ...input, role: "Admin", actorId: actor.userId },
        repo,
      ),
    ).rejects.toThrow(/staff access is required/);
    expect(repo.updateChecklistItem).not.toHaveBeenCalled();
  });

  it("propagates lookup failure without attempting an update", async () => {
    const repo = repository();
    const failure = new Error("Synthetic lookup failure");
    repo.getCaseTeamId.mockRejectedValueOnce(failure);
    await expect(updateIncorporationChecklistItemForActor(actor, input, repo)).rejects.toBe(
      failure,
    );
    expect(repo.updateChecklistItem).not.toHaveBeenCalled();
  });

  it("propagates repository refusal without retrying the write", async () => {
    const repo = repository();
    const failure = new Error("Checklist item not found for this case.");
    repo.updateChecklistItem.mockRejectedValueOnce(failure);
    await expect(updateIncorporationChecklistItemForActor(actor, input, repo)).rejects.toBe(
      failure,
    );
    expect(repo.updateChecklistItem).toHaveBeenCalledTimes(1);
  });
});
