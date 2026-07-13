import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnRepository } from "./repository";
import { addAnnualReturnCaseNoteForActor, assignAnnualReturnCaseOwnerForActor } from "./server-fns";

const caseId = "91000000-0000-0000-0000-000000000001";
const ownerId = "20000000-0000-0000-0000-000000000002";
const staffId = "20000000-0000-0000-0000-000000000001";

const clientActor: AuthenticatedActor = {
  authUserId: "client-auth",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};

const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: staffId,
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

describe("annual return case command authorization", () => {
  it("rejects client owner assignment", async () => {
    const assignOwner = vi.fn();
    const dependencies = {
      repository: { assignOwner } as unknown as AnnualReturnRepository,
    };

    await expect(
      assignAnnualReturnCaseOwnerForActor(clientActor, { caseId, ownerId }, dependencies),
    ).rejects.toThrow(/staff access is required/i);
    expect(assignOwner).not.toHaveBeenCalled();
  });

  it("trims and persists a staff note", async () => {
    const addNote = vi.fn(async (input: { caseId: string; body: string; actorId: string }) => ({
      id: "95000000-0000-0000-0000-000000000001",
      caseId: input.caseId,
      authorId: input.actorId,
      body: input.body,
      createdAt: "2026-07-13T08:00:00.000Z",
    }));
    const dependencies = {
      repository: { addNote } as unknown as AnnualReturnRepository,
    };

    const note = await addAnnualReturnCaseNoteForActor(
      staffActor,
      { caseId, body: "  Ready for review.  " },
      dependencies,
    );

    expect(note.body).toBe("Ready for review.");
    expect(addNote).toHaveBeenCalledWith({
      caseId,
      body: "Ready for review.",
      actorId: staffId,
    });
  });
});
