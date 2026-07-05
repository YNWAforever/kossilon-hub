import { describe, expect, it } from "vitest";
import { queueAnnualReturnWhatsAppReminderSchema } from "./server-fns";
import type { AnnualReturnCase } from "./types";
import { buildReminderDraft } from "./workflow";
import {
  buildAnnualReturnWhatsAppReminderRequest,
  queueAnnualReturnWhatsAppReminder,
} from "./whatsapp-reminders";
import type { AnnualReturnRepository } from "./repository";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";

const actorId = "20000000-0000-0000-0000-000000000003";

const harbourCase: AnnualReturnCase = {
  id: "40000000-0000-0000-0000-000000000001",
  companyId: "30000000-0000-0000-0000-000000000001",
  companyTeamId: "10000000-0000-0000-0000-000000000001",
  companyName: "Harbour Trading Ltd",
  returnYear: 2026,
  madeUpDate: "2026-07-01",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "green",
  ownerId: actorId,
  ownerName: "Mei Lam",
  reviewerId: "20000000-0000-0000-0000-000000000002",
  reviewerName: "Ken Wong",
  remindersSent: 1,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [
    {
      id: "60000000-0000-0000-0000-000000000001",
      caseId: "40000000-0000-0000-0000-000000000001",
      itemLabel: "Signed NAR1 form",
      required: true,
      status: "Missing",
      dueDate: "2026-08-05",
      receivedAt: null,
      verifiedAt: null,
      documentId: null,
    },
  ],
  payment: {
    id: "70000000-0000-0000-0000-000000000001",
    caseId: "40000000-0000-0000-0000-000000000001",
    invoiceNumber: "KOS-AR-2026-1200001",
    amount: 3800,
    currency: "HKD",
    status: "Payment pending",
    dueDate: "2026-08-05",
    paidAt: null,
    paymentProofDocumentId: null,
  },
};

describe("annual return WhatsApp reminders", () => {
  it("builds matching annual-return reminder and WhatsApp queue requests", () => {
    const draftBody = buildReminderDraft(harbourCase);

    expect(
      buildAnnualReturnWhatsAppReminderRequest({
        case_: harbourCase,
        actorId,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
      }),
    ).toEqual({
      annualReturnReminder: {
        caseId: harbourCase.id,
        actorId,
        templateLabel: "Annual return WhatsApp reminder",
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
        draftBody,
        note: "Queued as WhatsApp template message.",
      },
      whatsAppMessage: {
        actorId,
        caseId: harbourCase.id,
        toPhone: "+852 6123 4567",
        contactName: "Ada Director",
        templateName: "annual_return_manual_reminder",
        languageCode: "en",
        category: "annual_return",
        body: draftBody,
      },
    });
  });

  it("records the compliance reminder before queueing the WhatsApp message", async () => {
    const calls: string[] = [];
    const updatedCase = { ...harbourCase, remindersSent: harbourCase.remindersSent + 1 };
    const message = {
      id: "message-1",
      provider: "woztell" as const,
      providerMessageId: null,
      direction: "outbound" as const,
      status: "queued" as const,
      contactId: "contact-1",
      companyId: harbourCase.companyId,
      caseId: harbourCase.id,
      templateId: "template-1",
      phoneE164: "+85261234567",
      whatsAppId: null,
      body: buildReminderDraft(harbourCase),
      payload: {},
      sentBy: actorId,
      receivedAt: null,
      sentAt: null,
      createdAt: "2026-07-05T12:00:00.000Z",
    };
    const annualReturnRepository = {
      recordReminder: async () => {
        calls.push("record-reminder");
        return updatedCase;
      },
    } as unknown as AnnualReturnRepository;
    const whatsAppRepository = {
      queueOutboundTemplateMessage: async () => {
        calls.push("queue-whatsapp");
        return message;
      },
    } as unknown as WhatsAppRepository;

    await expect(
      queueAnnualReturnWhatsAppReminder({
        annualReturnRepository,
        whatsAppRepository,
        case_: harbourCase,
        actorId,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
      }),
    ).resolves.toEqual({ case: updatedCase, message });
    expect(calls).toEqual(["record-reminder", "queue-whatsapp"]);
  });

  it("validates the server action payload for queued reminders", () => {
    expect(
      queueAnnualReturnWhatsAppReminderSchema.parse({
        caseId: harbourCase.id,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
      }),
    ).toEqual({
      caseId: harbourCase.id,
      recipientName: "Ada Director",
      recipientPhone: "+852 6123 4567",
    });

    expect(() =>
      queueAnnualReturnWhatsAppReminderSchema.parse({
        caseId: "not-a-uuid",
        recipientName: "",
        recipientPhone: " ",
      }),
    ).toThrow();
  });
});
