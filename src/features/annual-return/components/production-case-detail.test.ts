import { describe, expect, it, vi } from "vitest";
import {
  createProductionCaseActions,
  type ProductionCaseCommandAdapters,
} from "./production-case-actions";

describe("createProductionCaseActions", () => {
  it("scopes every production command to the route case", async () => {
    const caseId = "11111111-1111-4111-8111-111111111111";
    const ownerId = "22222222-2222-4222-8222-222222222222";
    const itemId = "33333333-3333-4333-8333-333333333333";
    const documentId = "44444444-4444-4444-8444-444444444444";
    const proofId = "55555555-5555-4555-8555-555555555555";
    const confirmationId = "66666666-6666-4666-8666-666666666666";

    const commands = {
      assignOwner: vi.fn().mockResolvedValue(undefined),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateChecklist: vi.fn().mockResolvedValue(undefined),
      updatePayment: vi.fn().mockResolvedValue(undefined),
      addNote: vi.fn().mockResolvedValue(undefined),
      sendReminder: vi.fn().mockResolvedValue(undefined),
      updateFilingProof: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProductionCaseCommandAdapters;

    const actions = createProductionCaseActions(caseId, commands);

    await actions.assignOwner(ownerId);
    await actions.updateStatus("Ready to file");
    await actions.updateChecklist({ itemId, status: "Verified", documentId });
    await actions.updatePayment({
      status: "Payment received",
      paymentProofDocumentId: proofId,
    });
    await actions.addNote("Checked with the client.");
    await actions.sendReminder({
      recipientName: "Ada Chan",
      recipientPhone: "+85291234567",
    });
    await actions.submitPacket();
    await actions.acceptReceipt({
      filingReference: "NAR1-2026-001",
      confirmationDocumentId: confirmationId,
    });

    expect(commands.assignOwner).toHaveBeenCalledWith({ data: { caseId, ownerId } });
    expect(commands.updateStatus).toHaveBeenNthCalledWith(1, {
      data: { caseId, nextStatus: "Ready to file" },
    });
    expect(commands.updateChecklist).toHaveBeenCalledWith({
      data: { caseId, itemId, status: "Verified", documentId },
    });
    expect(commands.updatePayment).toHaveBeenCalledWith({
      data: { caseId, status: "Payment received", paymentProofDocumentId: proofId },
    });
    expect(commands.addNote).toHaveBeenCalledWith({
      data: { caseId, body: "Checked with the client." },
    });
    expect(commands.sendReminder).toHaveBeenCalledWith({
      data: {
        caseId,
        recipientName: "Ada Chan",
        recipientPhone: "+85291234567",
      },
    });
    expect(commands.updateStatus).toHaveBeenNthCalledWith(2, {
      data: { caseId, nextStatus: "NAR1 prepared" },
    });
    expect(commands.updateFilingProof).toHaveBeenCalledWith({
      data: {
        caseId,
        filingReference: "NAR1-2026-001",
        confirmationDocumentId: confirmationId,
      },
    });
  });
});
