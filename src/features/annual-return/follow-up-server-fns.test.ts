import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { WhatsAppMessageRecord, WhatsAppRepository } from "@/features/whatsapp/repository";
import type { AnnualReturnRepository } from "./repository";
import type { AnnualReturnCase } from "./types";
import type { ProductionFollowUpRepository } from "./follow-up-repository";
import {
  listProductionFollowUpDraftsForActor,
  sendAnnualReturnFollowUpForActor,
  sendDocumentReviewFollowUpForActor,
  sendPaymentProofFollowUpForActor,
} from "./follow-up-server-fns";

const caseId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";
const teamId = "44444444-4444-4444-8444-444444444444";
const documentId = "55555555-5555-4555-8555-555555555555";
const paymentDocumentId = "66666666-6666-4666-8666-666666666666";

const actor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: staffId,
  role: "Staff",
  teamId,
  active: true,
};

const caseItem: AnnualReturnCase = {
  id: caseId,
  companyId,
  companyTeamId: teamId,
  companyName: "Acme Company Limited",
  returnYear: 2026,
  madeUpDate: "2026-06-30",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "yellow",
  ownerId: staffId,
  ownerName: "Ada Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 1,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [],
  payment: null,
};

const message: WhatsAppMessageRecord = {
  id: "77777777-7777-4777-8777-777777777777",
  provider: "woztell",
  providerMessageId: null,
  direction: "outbound",
  status: "queued",
  contactId: null,
  companyId,
  caseId,
  templateId: null,
  phoneE164: "+85291234567",
  whatsAppId: null,
  body: "server generated",
  payload: {},
  sentBy: staffId,
  receivedAt: null,
  sentAt: null,
  createdAt: "2026-07-14T09:00:00.000Z",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const annualReturnRepository = {
    listCases: vi.fn(async () => [caseItem]),
    getCase: vi.fn(async () => caseItem),
    assertCanMutateCase: vi.fn(async () => undefined),
    recordReminder: vi.fn(async () => ({ ...caseItem, remindersSent: 2 })),
  } as unknown as AnnualReturnRepository;
  const followUpRepository = {
    listPersistedState: vi.fn(async () => ({
      recipients: [
        {
          caseId,
          recipientName: "Chris Client",
          recipientPhone: "+85291234567",
          recordedAt: "2026-07-14T09:00:00.000Z",
        },
      ],
      evidence: [
        {
          documentId,
          caseId,
          companyId,
          category: "identity",
          fileName: "passport.pdf",
          reviewStatus: "rejected",
          uploadStatus: "available",
          uploadedAt: "2026-07-14T08:00:00.000Z",
          rejectionReason: "Photo page is cropped.",
        },
        {
          documentId: paymentDocumentId,
          caseId,
          companyId,
          category: "payment",
          fileName: "payment-proof.pdf",
          reviewStatus: "rejected",
          uploadStatus: "available",
          uploadedAt: "2026-07-14T08:30:00.000Z",
          rejectionReason: "Transaction reference is missing.",
        },
      ],
      deliveries: [],
    })),
  } as unknown as ProductionFollowUpRepository;
  const whatsAppRepository = {
    queueOutboundTemplateMessage: vi.fn(async () => message),
  } as unknown as WhatsAppRepository;

  return {
    annualReturnRepository,
    followUpRepository,
    whatsAppRepository,
    ...overrides,
  };
}

describe("production follow-up server orchestration", () => {
  it("lists only staff-authorized production drafts", async () => {
    const deps = dependencies();
    const drafts = await listProductionFollowUpDraftsForActor(actor, deps);

    expect(drafts).toHaveLength(3);
    expect(deps.followUpRepository.listPersistedState).toHaveBeenCalledWith([caseId]);

    await expect(
      listProductionFollowUpDraftsForActor({ ...actor, role: "Client", userId: null }, deps),
    ).rejects.toThrow(/staff access is required/i);
  });

  it.each([
    ["annual-return", caseId, sendAnnualReturnFollowUpForActor, "annual_return_manual_reminder"],
    [
      "document-review",
      documentId,
      sendDocumentReviewFollowUpForActor,
      "annual_return_document_replacement",
    ],
    [
      "payment-proof-review",
      paymentDocumentId,
      sendPaymentProofFollowUpForActor,
      "annual_return_payment_proof_replacement",
    ],
  ] as const)(
    "queues a server-generated %s follow-up and records the reminder atomically",
    async (source, entityId, send, templateName) => {
      const deps = dependencies();

      await expect(send(actor, { caseId, entityId }, deps)).resolves.toMatchObject({
        source,
        replayed: false,
        messageId: message.id,
      });

      expect(deps.annualReturnRepository.assertCanMutateCase).toHaveBeenCalledWith(
        caseId,
        staffId,
        "record_reminder",
      );
      expect(deps.whatsAppRepository.queueOutboundTemplateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: staffId,
          caseId,
          toPhone: "+85291234567",
          contactName: "Chris Client",
          templateName,
          idempotencyKey: `follow-up:${source}:${caseId}:${entityId}`,
          followUpId: entityId,
          metadata: expect.objectContaining({ source, entityId }),
          body: expect.any(String),
        }),
      );
      expect(deps.annualReturnRepository.recordReminder).toHaveBeenCalledTimes(1);
    },
  );

  it("returns an idempotent replay without duplicating reminder, audit, or timeline records", async () => {
    const deps = dependencies();
    vi.mocked(deps.whatsAppRepository.queueOutboundTemplateMessage).mockResolvedValue({
      ...message,
      idempotentReplay: true,
    });

    await expect(
      sendDocumentReviewFollowUpForActor(actor, { caseId, entityId: documentId }, deps),
    ).resolves.toMatchObject({ replayed: true, messageId: message.id });
    expect(deps.annualReturnRepository.recordReminder).not.toHaveBeenCalled();
  });

  it("rejects a stale or cross-case evidence identity before queueing", async () => {
    const deps = dependencies();

    await expect(
      sendDocumentReviewFollowUpForActor(
        actor,
        { caseId, entityId: "88888888-8888-4888-8888-888888888888" },
        deps,
      ),
    ).rejects.toThrow(/current document-review follow-up/i);
    expect(deps.whatsAppRepository.queueOutboundTemplateMessage).not.toHaveBeenCalled();
    expect(deps.annualReturnRepository.recordReminder).not.toHaveBeenCalled();
  });
});
