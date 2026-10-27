import { describe, expect, it, vi } from "vitest";
import { queueAnnualReturnWhatsAppReminderSchema } from "./server-fns";
import type { AnnualReturnCase } from "./types";
import { buildReminderDraft } from "./workflow";
import {
  buildAnnualReturnWhatsAppReminderRequest,
  queueAnnualReturnWhatsAppReminder,
  annualReturnReminderIdempotencyKey,
} from "./whatsapp-reminders";
import type { AnnualReturnRepository } from "./repository";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";

const actorId = "20000000-0000-0000-0000-000000000003";
const commandUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    const draftBody = buildReminderDraft(harbourCase, "Ada Director", "2026-07-13");

    expect(
      buildAnnualReturnWhatsAppReminderRequest({
        case_: harbourCase,
        actorId,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
        commandUuid,
        today: "2026-07-13",
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
        idempotencyKey: `annual-return-reminder:${harbourCase.id}:${commandUuid}`,
        languageCode: "en",
        category: "annual_return",
        body: draftBody,
      },
    });
  });

  it("queues the WhatsApp message before recording the compliance reminder", async () => {
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
      body: buildReminderDraft(harbourCase, "Ada Director", "2026-07-13"),
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
        commandUuid,
        today: "2026-07-13",
      }),
    ).resolves.toEqual({ case: updatedCase, message });
    expect(calls).toEqual(["queue-whatsapp", "record-reminder"]);
  });

  it("does not record the compliance reminder when WhatsApp queueing fails", async () => {
    const annualReturnRepository = {
      recordReminder: vi.fn(),
    } as unknown as AnnualReturnRepository;
    const whatsAppRepository = {
      queueOutboundTemplateMessage: vi.fn(async () => {
        throw new Error("WhatsApp queue unavailable.");
      }),
    } as unknown as WhatsAppRepository;

    await expect(
      queueAnnualReturnWhatsAppReminder({
        annualReturnRepository,
        whatsAppRepository,
        case_: harbourCase,
        actorId,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
        commandUuid,
        today: "2026-07-13",
      }),
    ).rejects.toThrow("WhatsApp queue unavailable.");
    expect(annualReturnRepository.recordReminder).not.toHaveBeenCalled();
  });

  it("validates the server action payload for queued reminders", () => {
    expect(
      queueAnnualReturnWhatsAppReminderSchema.parse({
        caseId: harbourCase.id,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
        commandUuid,
      }),
    ).toEqual({
      caseId: harbourCase.id,
      recipientName: "Ada Director",
      recipientPhone: "+852 6123 4567",
      commandUuid,
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

describe("annualReturnReminderIdempotencyKey", () => {
  const base = { caseId: harbourCase.id, commandUuid };

  it("is the case and the command UUID, so a replay of one click collapses", () => {
    expect(annualReturnReminderIdempotencyKey(base)).toBe(
      `annual-return-reminder:${harbourCase.id}:${commandUuid}`,
    );
    expect(annualReturnReminderIdempotencyKey(base)).toBe(
      annualReturnReminderIdempotencyKey({ ...base }),
    );
  });

  it("does not put the phone in the command identity", () => {
    const key = annualReturnReminderIdempotencyKey(base);
    expect(key.split(":")).toEqual(["annual-return-reminder", harbourCase.id, commandUuid]);
    expect(key).not.toContain("852");
    expect(annualReturnReminderIdempotencyKey(base)).not.toBe(
      annualReturnReminderIdempotencyKey({
        ...base,
        commandUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );
  });

  it("keeps the phone on the message when two spellings share one command", () => {
    const spaced = buildAnnualReturnWhatsAppReminderRequest({
      case_: harbourCase,
      actorId,
      recipientName: "Ada Director",
      recipientPhone: "+852 6123 4567",
      commandUuid,
      today: "2026-07-13",
    });
    const compact = buildAnnualReturnWhatsAppReminderRequest({
      case_: harbourCase,
      actorId,
      recipientName: "Ada Director",
      recipientPhone: "+85261234567",
      commandUuid,
      today: "2026-07-13",
    });
    expect(spaced.whatsAppMessage.idempotencyKey).toBe(compact.whatsAppMessage.idempotencyKey);
    expect(spaced.whatsAppMessage.toPhone).toBe("+852 6123 4567");
    expect(compact.whatsAppMessage.toPhone).toBe("+85261234567");
    expect(spaced.annualReturnReminder.recipientPhone).toBe("+852 6123 4567");
  });
});

describe("queueAnnualReturnWhatsAppReminder replay", () => {
  it("returns the existing message and does not record another reminder", async () => {
    const recordReminder = vi.fn();
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
      body: "draft",
      payload: {},
      sentBy: actorId,
      receivedAt: null,
      sentAt: null,
      createdAt: "2026-07-05T12:00:00.000Z",
      idempotentReplay: true,
    };
    const queueOutboundTemplateMessage = vi.fn(async () => message);

    await expect(
      queueAnnualReturnWhatsAppReminder({
        annualReturnRepository: { recordReminder } as unknown as AnnualReturnRepository,
        whatsAppRepository: {
          queueOutboundTemplateMessage,
        } as unknown as WhatsAppRepository,
        case_: harbourCase,
        actorId,
        recipientName: "Ada Director",
        recipientPhone: "+852 6123 4567",
        commandUuid,
        today: "2026-07-13",
      }),
    ).resolves.toEqual({ case: harbourCase, message });

    expect(recordReminder).not.toHaveBeenCalled();
    expect(queueOutboundTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `annual-return-reminder:${harbourCase.id}:${commandUuid}`,
        toPhone: "+852 6123 4567",
      }),
    );
  });
});
