import { describe, expect, it } from "vitest";
import type { AnnualReturnCase } from "./types";
import {
  deriveProductionFollowUpDrafts,
  stableFollowUpIdempotencyKey,
  type PersistedFollowUpState,
} from "./follow-ups";

const caseId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const oldDocumentId = "33333333-3333-4333-8333-333333333333";
const currentDocumentId = "44444444-4444-4444-8444-444444444444";
const paymentDocumentId = "55555555-5555-4555-8555-555555555555";

const caseItem: AnnualReturnCase = {
  id: caseId,
  companyId,
  companyTeamId: "66666666-6666-4666-8666-666666666666",
  companyName: "Acme Company Limited",
  returnYear: 2026,
  madeUpDate: "2026-06-30",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "yellow",
  ownerId: "77777777-7777-4777-8777-777777777777",
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

function state(overrides: Partial<PersistedFollowUpState> = {}): PersistedFollowUpState {
  return {
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
        documentId: oldDocumentId,
        caseId,
        companyId,
        source: "document-review",
        category: "identity",
        fileName: "old-passport.pdf",
        reviewStatus: "rejected",
        uploadStatus: "available",
        uploadedAt: "2026-07-12T09:00:00.000Z",
        rejectionReason: "Old copy is blurred.",
      },
      {
        documentId: currentDocumentId,
        caseId,
        companyId,
        source: "document-review",
        category: "identity",
        fileName: "passport.pdf",
        reviewStatus: "rejected",
        uploadStatus: "available",
        uploadedAt: "2026-07-13T09:00:00.000Z",
        rejectionReason: "Photo page is cropped.",
      },
      {
        documentId: paymentDocumentId,
        caseId,
        companyId,
        source: "payment-proof-review",
        category: "payment",
        fileName: "payment-proof.pdf",
        reviewStatus: "rejected",
        uploadStatus: "available",
        uploadedAt: "2026-07-13T10:00:00.000Z",
        rejectionReason: "Transaction reference is missing.",
      },
    ],
    deliveries: [],
    ...overrides,
  };
}

describe("production follow-up draft derivation", () => {
  it("derives each authoritative linked document and payment draft from persisted state", () => {
    const drafts = deriveProductionFollowUpDrafts([caseItem], state(), "2026-07-14");

    expect(drafts.map(({ source, id }) => ({ source, id }))).toEqual([
      { source: "annual-return", id: caseId },
      { source: "document-review", id: oldDocumentId },
      { source: "document-review", id: currentDocumentId },
      { source: "payment-proof-review", id: paymentDocumentId },
    ]);
    expect(drafts[2]).toMatchObject({
      recipientName: "Chris Client",
      phone: "+85291234567",
      reasonLabel: "Photo page is cropped.",
      status: "draft",
    });
  });

  it("marks rows blocked without a persisted reminder recipient", () => {
    const drafts = deriveProductionFollowUpDrafts(
      [caseItem],
      state({ recipients: [] }),
      "2026-07-14",
    );

    expect(drafts).toHaveLength(4);
    expect(drafts.every((draft) => draft.status === "blocked")).toBe(true);
    expect(drafts.every((draft) => draft.recipientName === null && draft.phone === null)).toBe(
      true,
    );
  });

  it("does not derive follow-ups for filed cases", () => {
    const drafts = deriveProductionFollowUpDrafts(
      [{ ...caseItem, currentStatus: "Filed" }],
      state(),
      "2026-07-14",
    );

    expect(drafts).toEqual([]);
  });
  it("maps queued or sent stable outbox keys to sent without trusting failed delivery", () => {
    const annualIdentity = { source: "annual-return" as const, caseId, entityId: caseId };
    const documentIdentity = {
      source: "document-review" as const,
      caseId,
      entityId: currentDocumentId,
    };
    const paymentIdentity = {
      source: "payment-proof-review" as const,
      caseId,
      entityId: paymentDocumentId,
    };
    const drafts = deriveProductionFollowUpDrafts(
      [caseItem],
      state({
        deliveries: [
          { idempotencyKey: stableFollowUpIdempotencyKey(annualIdentity), status: "pending" },
          { idempotencyKey: stableFollowUpIdempotencyKey(documentIdentity), status: "sent" },
          { idempotencyKey: stableFollowUpIdempotencyKey(paymentIdentity), status: "failed" },
        ],
      }),
      "2026-07-14",
    );

    expect(drafts.map(({ source, status }) => ({ source, status }))).toEqual([
      { source: "annual-return", status: "sent" },
      { source: "document-review", status: "draft" },
      { source: "document-review", status: "sent" },
      { source: "payment-proof-review", status: "blocked" },
    ]);
  });
});
