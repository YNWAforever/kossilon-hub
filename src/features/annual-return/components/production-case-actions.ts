import {
  addAnnualReturnCaseNote,
  assignAnnualReturnCaseOwner,
  queueAnnualReturnWhatsAppReminderMessage,
  updateAnnualReturnChecklistItem,
  updateAnnualReturnFilingProof,
  updateAnnualReturnPayment,
  updateAnnualReturnStatus,
} from "../server-fns";
import type { AnnualReturnStatus, ChecklistStatus, PaymentStatus } from "../types";

export type ProductionCaseCommandAdapters = {
  assignOwner: typeof assignAnnualReturnCaseOwner;
  updateStatus: typeof updateAnnualReturnStatus;
  updateChecklist: typeof updateAnnualReturnChecklistItem;
  updatePayment: typeof updateAnnualReturnPayment;
  addNote: typeof addAnnualReturnCaseNote;
  sendReminder: typeof queueAnnualReturnWhatsAppReminderMessage;
  updateFilingProof: typeof updateAnnualReturnFilingProof;
};

const defaultProductionCaseCommands: ProductionCaseCommandAdapters = {
  assignOwner: assignAnnualReturnCaseOwner,
  updateStatus: updateAnnualReturnStatus,
  updateChecklist: updateAnnualReturnChecklistItem,
  updatePayment: updateAnnualReturnPayment,
  addNote: addAnnualReturnCaseNote,
  sendReminder: queueAnnualReturnWhatsAppReminderMessage,
  updateFilingProof: updateAnnualReturnFilingProof,
};

export function createProductionCaseActions(
  caseId: string,
  commands: ProductionCaseCommandAdapters = defaultProductionCaseCommands,
) {
  return {
    assignOwner: (ownerId: string) => commands.assignOwner({ data: { caseId, ownerId } }),
    updateStatus: (nextStatus: AnnualReturnStatus) =>
      commands.updateStatus({ data: { caseId, nextStatus } }),
    updateChecklist: (input: {
      itemId: string;
      status: ChecklistStatus;
      documentId: string | null;
    }) => commands.updateChecklist({ data: { caseId, ...input } }),
    updatePayment: (input: { status: PaymentStatus; paymentProofDocumentId: string | null }) =>
      commands.updatePayment({ data: { caseId, ...input } }),
    addNote: (body: string) => commands.addNote({ data: { caseId, body } }),
    sendReminder: (input: { recipientName: string; recipientPhone: string }) =>
      commands.sendReminder({ data: { caseId, ...input } }),
    submitPacket: () => commands.updateStatus({ data: { caseId, nextStatus: "NAR1 prepared" } }),
    acceptReceipt: (input: { filingReference: string; confirmationDocumentId: string }) =>
      commands.updateFilingProof({ data: { caseId, ...input } }),
  };
}
