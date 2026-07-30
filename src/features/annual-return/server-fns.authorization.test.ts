import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import type { AnnualReturnRepository } from "./repository";
import {
  addAnnualReturnCaseNoteForActor,
  assignAnnualReturnCaseOwnerForActor,
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
