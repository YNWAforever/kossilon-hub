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
