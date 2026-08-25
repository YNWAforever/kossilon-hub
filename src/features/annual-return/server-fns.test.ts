import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnRepository } from "./repository";
import type { CaseHistoryEntry } from "./case-history";
import {
  addAnnualReturnCaseNoteForActor,
  assignAnnualReturnCaseOwnerForActor,
  listAnnualReturnCaseHistoryForActor,
} from "./server-fns";

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

  const managerActor: AuthenticatedActor = {
    authUserId: "manager-auth",
    userId: "20000000-0000-0000-0000-000000000009",
    role: "Manager",
    teamId: "10000000-0000-0000-0000-000000000099",
    active: true,
  };

  const visibleCase = {
    id: caseId,
    companyName: "Acme Company Limited",
    companyTeamId: staffActor.teamId!,
    ownerId: staffActor.userId!,
    reviewerId: null,
  };

  it("rejects a history read for a case outside the actor's scope", async () => {
    const getCase = vi.fn(async () => ({
      ...visibleCase,
      companyTeamId: managerActor.teamId!,
      ownerId: managerActor.userId!,
    }));
    const listAuditEventsForCase = vi.fn();
    const listAssignmentEventsForCase = vi.fn();
    const dependencies = {
      repository: {
        getCase,
        listAuditEventsForCase,
        listAssignmentEventsForCase,
      } as unknown as AnnualReturnRepository,
    };

    await expect(
      listAnnualReturnCaseHistoryForActor(staffActor, { caseId }, dependencies),
    ).rejects.toThrow(/outside your scope/i);
    expect(listAuditEventsForCase).not.toHaveBeenCalled();
    expect(listAssignmentEventsForCase).not.toHaveBeenCalled();
  });

  it("throws when the case does not exist", async () => {
    const getCase = vi.fn(async () => null);
    const dependencies = {
      repository: {
        getCase,
        listAuditEventsForCase: vi.fn(),
        listAssignmentEventsForCase: vi.fn(),
      } as unknown as AnnualReturnRepository,
    };

    await expect(
      listAnnualReturnCaseHistoryForActor(staffActor, { caseId }, dependencies),
    ).rejects.toThrow(/not found/i);
  });

  it("returns the merged history for a visible case", async () => {
    const getCase = vi.fn(async () => visibleCase);
    const listAuditEventsForCase = vi.fn(async () => [
      {
        id: "a1000000-0000-0000-0000-000000000001",
        actor_id: staffActor.userId,
        actor_name: "Amy Chan",
        actor_role: "Staff" as const,
        action: "add_note" as const,
        result: "succeeded" as const,
        summary: "Note added.",
        metadata: {},
        created_at: "2026-08-01T09:00:00.000Z",
      },
    ]);
    const listAssignmentEventsForCase = vi.fn(async () => []);
    const dependencies = {
      repository: {
        getCase,
        listAuditEventsForCase,
        listAssignmentEventsForCase,
      } as unknown as AnnualReturnRepository,
    };

    const history: CaseHistoryEntry[] = await listAnnualReturnCaseHistoryForActor(
      staffActor,
      { caseId },
      dependencies,
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "audit", action: "add_note" });
    expect(listAuditEventsForCase).toHaveBeenCalledWith(caseId);
    expect(listAssignmentEventsForCase).toHaveBeenCalledWith(caseId);
  });
});
