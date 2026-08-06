import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import type { AnnualReturnRepository } from "./repository";
import {
  addAnnualReturnCaseNoteForActor,
  assignAnnualReturnCaseOwnerForActor,
  getAnnualReturnCaseForActor,
  listAnnualReturnCaseNotesForActor,
  queueAnnualReturnWhatsAppReminderMessageForActor,
  updateAnnualReturnChecklistItemForActor,
  updateAnnualReturnFilingProofForActor,
  updateAnnualReturnPaymentForActor,
  listAnnualReturnCasesForActor,
  updateAnnualReturnStatusForActor,
} from "./server-fns";

const caseId = "91000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000002";
const itemId = "30000000-0000-4000-8000-000000000003";
const documentId = "40000000-0000-4000-8000-000000000004";

const clientActor: AuthenticatedActor = {
  authUserId: "client-auth",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};

describe("production annual return command authorization", () => {
  it("rejects clients before every reachable repository command", async () => {
    const repository = {
      assignOwner: vi.fn(),
      updateStatus: vi.fn(),
      getCase: vi.fn(),
      updateChecklistItem: vi.fn(),
      updatePayment: vi.fn(),
      addNote: vi.fn(),
      updateFilingProof: vi.fn(),
    } as unknown as AnnualReturnRepository;
    const whatsAppRepository = {} as WhatsAppRepository;

    const calls = [
      () => assignAnnualReturnCaseOwnerForActor(clientActor, { caseId, ownerId }, { repository }),
      () =>
        updateAnnualReturnStatusForActor(
          clientActor,
          { caseId, nextStatus: "Ready to file" },
          { repository },
        ),
      () =>
        updateAnnualReturnChecklistItemForActor(
          clientActor,
          {
            caseId,
            itemId,
            status: "Verified",
            documentId,
          },
          { repository },
        ),
      () =>
        updateAnnualReturnPaymentForActor(
          clientActor,
          {
            caseId,
            status: "Payment received",
            paymentProofDocumentId: documentId,
          },
          { repository },
        ),
      () =>
        addAnnualReturnCaseNoteForActor(
          clientActor,
          { caseId, body: "Staff-only note." },
          { repository },
        ),
      () =>
        queueAnnualReturnWhatsAppReminderMessageForActor(
          clientActor,
          {
            caseId,
            recipientName: "Ada Chan",
            recipientPhone: "+85291234567",
          },
          { annualReturnRepository: repository, whatsAppRepository },
        ),
      () =>
        updateAnnualReturnFilingProofForActor(
          clientActor,
          {
            caseId,
            filingReference: "NAR1-2026-001",
            confirmationDocumentId: documentId,
          },
          { repository },
        ),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toThrow(/staff access is required/i);
    }

    expect(repository.assignOwner).not.toHaveBeenCalled();
    expect(repository.getCase).not.toHaveBeenCalled();
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(repository.updateChecklistItem).not.toHaveBeenCalled();
    expect(repository.updatePayment).not.toHaveBeenCalled();
    expect(repository.addNote).not.toHaveBeenCalled();
    expect(repository.updateFilingProof).not.toHaveBeenCalled();
  });
});

// listAnnualReturnCases applied no scoping: any authenticated staff member could
// list every case in the firm, and a Staff user's board would be full of rows
// whose detail screens reject every action.
describe("production annual return list scoping", () => {
  const staffActor: AuthenticatedActor = {
    authUserId: "staff-auth",
    userId: "20000000-0000-4000-8000-000000000009",
    role: "Staff",
    teamId: "10000000-0000-4000-8000-000000000001",
    active: true,
  };

  function repositoryFor(listCases = vi.fn(async () => [])) {
    return {
      listCases,
      repository: { listCases } as unknown as Pick<AnnualReturnRepository, "listCases">,
    };
  }

  it("narrows the list to what the acting staff member may act on", async () => {
    const { listCases, repository } = repositoryFor();

    await listAnnualReturnCasesForActor(staffActor, {}, { repository });

    expect(listCases).toHaveBeenCalledWith({
      teamId: staffActor.teamId,
      visibleToUserId: staffActor.userId,
    });
  });

  it("does not let a client-supplied filter widen the actor's scope", async () => {
    const { listCases, repository } = repositoryFor();

    await listAnnualReturnCasesForActor(
      staffActor,
      { teamId: "10000000-0000-4000-8000-000000000002" },
      { repository },
    );

    expect(listCases).toHaveBeenCalledWith({
      teamId: staffActor.teamId,
      visibleToUserId: staffActor.userId,
    });
  });

  it("keeps a caller's own filters when they do not clash with the scope", async () => {
    const { listCases, repository } = repositoryFor();

    await listAnnualReturnCasesForActor(staffActor, { status: "Filed", limit: 50 }, { repository });

    expect(listCases).toHaveBeenCalledWith({
      status: "Filed",
      limit: 50,
      teamId: staffActor.teamId,
      visibleToUserId: staffActor.userId,
    });
  });

  it("does not narrow an admin", async () => {
    const { listCases, repository } = repositoryFor();

    await listAnnualReturnCasesForActor(
      { authUserId: "admin-auth", userId: "admin-1", role: "Admin", teamId: null, active: true },
      { status: "Upcoming" },
      { repository },
    );

    expect(listCases).toHaveBeenCalledWith({ status: "Upcoming" });
  });

  it("refuses a client", async () => {
    const { repository } = repositoryFor();

    await expect(listAnnualReturnCasesForActor(clientActor, {}, { repository })).rejects.toThrow(
      "Forbidden: staff access is required.",
    );
  });
});

/**
 * The board read has always been scoped, but the detail reads behind it were not:
 * getAnnualReturnCase, listAnnualReturnCaseNotes and buildAnnualReturnReminderDraft
 * were staff-only and nothing more. A Staff actor who could not see another team's
 * cases on the board could still read any of them in full by passing the case id.
 */
describe("production annual return detail scoping", () => {
  const teamId = "10000000-0000-4000-8000-000000000001";
  const otherTeamId = "10000000-0000-4000-8000-000000000002";

  const staffActor: AuthenticatedActor = {
    authUserId: "staff-auth",
    userId: "20000000-0000-4000-8000-000000000009",
    role: "Staff",
    teamId,
    active: true,
  };

  function caseRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: caseId,
      companyTeamId: teamId,
      ownerId: staffActor.userId,
      reviewerId: null,
      companyName: "Harbour Holdings Limited",
      ...overrides,
    };
  }

  function repositoryFor(case_: unknown) {
    const getCase = vi.fn(async () => case_);
    const listNotes = vi.fn(async () => [{ id: "note-1" }]);
    return {
      getCase,
      listNotes,
      repository: { getCase, listNotes } as unknown as Pick<
        AnnualReturnRepository,
        "getCase" | "listNotes"
      >,
    };
  }

  it("returns a case the actor owns", async () => {
    const { repository } = repositoryFor(caseRecord());

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toMatchObject({ id: caseId });
  });

  it("hides a case owned by someone else on another team", async () => {
    const { repository } = repositoryFor(
      caseRecord({ companyTeamId: otherTeamId, ownerId: "20000000-0000-4000-8000-00000000000a" }),
    );

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toBeNull();
  });

  it("hides a same-team case the actor neither owns nor reviews", async () => {
    const { repository } = repositoryFor(
      caseRecord({ ownerId: "20000000-0000-4000-8000-00000000000a" }),
    );

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toBeNull();
  });

  it("shows a same-team case the actor reviews", async () => {
    const { repository } = repositoryFor(
      caseRecord({
        ownerId: "20000000-0000-4000-8000-00000000000a",
        reviewerId: staffActor.userId,
      }),
    );

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toMatchObject({ id: caseId });
  });

  it("shows any case in the team to that team's manager", async () => {
    const { repository } = repositoryFor(
      caseRecord({ ownerId: "20000000-0000-4000-8000-00000000000a" }),
    );

    await expect(
      getAnnualReturnCaseForActor(
        { ...staffActor, role: "Manager" },
        { id: caseId },
        { repository },
      ),
    ).resolves.toMatchObject({ id: caseId });
  });

  it("does not narrow an admin", async () => {
    const { repository } = repositoryFor(
      caseRecord({ companyTeamId: otherTeamId, ownerId: "20000000-0000-4000-8000-00000000000a" }),
    );

    await expect(
      getAnnualReturnCaseForActor(
        { authUserId: "admin-auth", userId: "admin-1", role: "Admin", teamId: null, active: true },
        { id: caseId },
        { repository },
      ),
    ).resolves.toMatchObject({ id: caseId });
  });

  it("refuses a client actor", async () => {
    const { repository } = repositoryFor(caseRecord());

    await expect(
      getAnnualReturnCaseForActor(clientActor, { id: caseId }, { repository }),
    ).rejects.toThrow(/^Forbidden:/);
  });

  /**
   * The board narrows by team AND owner/reviewer, but getAnnualReturnActionPermission
   * lets an owner or reviewer act on a case whatever team it sits in. Deriving
   * visibility from the board scope alone left a case an actor could mutate but
   * could not open — assignOwner across teams is all it takes to create one.
   */
  it("shows a case the actor owns even when it belongs to another team", async () => {
    const { repository } = repositoryFor(caseRecord({ companyTeamId: otherTeamId }));

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toMatchObject({ id: caseId });
  });

  it("shows a case the actor reviews even when it belongs to another team", async () => {
    const { repository } = repositoryFor(
      caseRecord({
        companyTeamId: otherTeamId,
        ownerId: "20000000-0000-4000-8000-00000000000a",
        reviewerId: staffActor.userId,
      }),
    );

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toMatchObject({ id: caseId });
  });

  // The widening is exactly "may act on it", nothing looser.
  it("still hides another team's case the actor neither owns nor reviews", async () => {
    const { repository } = repositoryFor(
      caseRecord({ companyTeamId: otherTeamId, ownerId: "20000000-0000-4000-8000-00000000000a" }),
    );

    await expect(
      getAnnualReturnCaseForActor(staffActor, { id: caseId }, { repository }),
    ).resolves.toBeNull();
  });

  it("refuses notes on a case outside the actor's scope", async () => {
    const { repository, listNotes } = repositoryFor(
      caseRecord({ companyTeamId: otherTeamId, ownerId: "20000000-0000-4000-8000-00000000000a" }),
    );

    await expect(
      listAnnualReturnCaseNotesForActor(staffActor, { caseId }, { repository }),
    ).rejects.toThrow(/^Forbidden:/);
    expect(listNotes).not.toHaveBeenCalled();
  });

  it("returns notes on a case the actor owns", async () => {
    const { repository, listNotes } = repositoryFor(caseRecord());

    await expect(
      listAnnualReturnCaseNotesForActor(staffActor, { caseId }, { repository }),
    ).resolves.toEqual([{ id: "note-1" }]);
    expect(listNotes).toHaveBeenCalledWith(caseId);
  });
});
