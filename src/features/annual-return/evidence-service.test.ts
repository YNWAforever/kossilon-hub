import { describe, expect, it, vi } from "vitest";
import type { AnnualReturnRepository } from "./repository";
import type { AnnualReturnCase } from "./types";
import type { DocumentRepository, PrivateDocument } from "@/features/documents/repository";
import { createAnnualReturnEvidenceService } from "./evidence-service";

const caseId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
const checklistItemId = "55555555-5555-4555-8555-555555555555";

const baseCase: AnnualReturnCase = {
  id: caseId,
  companyId,
  companyTeamId: "66666666-6666-4666-8666-666666666666",
  companyName: "Acme Company Limited",
  returnYear: 2026,
  madeUpDate: "2026-06-30",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "green",
  ownerId: actorId,
  ownerName: "Ada Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 0,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [
    {
      id: checklistItemId,
      caseId,
      itemLabel: "Signed NAR1",
      required: true,
      status: "Received",
      dueDate: "2026-08-01",
      receivedAt: "2026-07-12T00:00:00.000Z",
      verifiedAt: null,
      documentId,
    },
  ],
  payment: {
    id: "77777777-7777-4777-8777-777777777777",
    caseId,
    invoiceNumber: "INV-2026-001",
    amount: 1800,
    currency: "HKD",
    status: "Payment pending",
    dueDate: "2026-08-01",
    paidAt: null,
    paymentProofDocumentId: null,
  },
};

const baseDocument: PrivateDocument = {
  id: documentId,
  companyId,
  caseId,
  category: "payment",
  fileName: "payment-proof.pdf",
  objectKey: "opaque/payment-proof",
  contentType: "application/pdf",
  sizeBytes: 128,
  checksum: "a".repeat(64),
  uploadStatus: "available",
  reviewStatus: "pending",
  uploadedBy: null,
  uploadedAt: "2026-07-12T00:00:00.000Z",
};

function createHarness(
  document: PrivateDocument = baseDocument,
  caseItem: AnnualReturnCase = baseCase,
) {
  const transaction = { id: "tx-1" };
  const reviewedDocument = { ...document, reviewStatus: "verified" as const };
  const updatedCase = {
    ...caseItem,
    payment: caseItem.payment
      ? {
          ...caseItem.payment,
          status: "Payment received" as const,
          paymentProofDocumentId: document.id,
        }
      : null,
  };
  const documents = {
    getDocument: vi.fn(async () => document),
    reviewDocument: vi.fn(async (input: { decision: "verified" | "rejected" }) => ({
      ...reviewedDocument,
      reviewStatus: input.decision,
    })),
    close: vi.fn(async () => undefined),
  } as unknown as DocumentRepository;
  const annualReturns = {
    getCase: vi.fn(async () => caseItem),
    assertCanMutateCase: vi.fn(async () => undefined),
    updateChecklistItem: vi.fn(async () => updatedCase),
    updatePayment: vi.fn(async () => updatedCase),
    updateFilingProof: vi.fn(async () => updatedCase),
    close: vi.fn(async () => undefined),
  } as unknown as AnnualReturnRepository;
  const sql = {
    begin: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)),
  };
  const documentRepositoryFactory = vi.fn((tx: unknown) => {
    expect(tx).toBe(transaction);
    return documents;
  });
  const annualReturnRepositoryFactory = vi.fn((tx: unknown) => {
    expect(tx).toBe(transaction);
    return annualReturns;
  });
  const service = createAnnualReturnEvidenceService({
    sql: sql as never,
    documentRepositoryFactory,
    annualReturnRepositoryFactory,
  });

  return {
    service,
    sql,
    documents,
    annualReturns,
    reviewedDocument,
    updatedCase,
  };
}

describe("annual return evidence service", () => {
  it("verifies payment proof and updates payment in one transaction", async () => {
    const harness = createHarness();

    const result = await harness.service.reviewEvidence({
      caseId,
      documentId,
      decision: "verified",
      actorId,
    });

    expect(result.document.reviewStatus).toBe("verified");
    expect(harness.annualReturns.updatePayment).toHaveBeenCalledWith({
      caseId,
      status: "Payment received",
      paymentProofDocumentId: documentId,
      actorId,
    });
    expect(result.caseItem.payment).toEqual(
      expect.objectContaining({
        status: "Payment received",
        paymentProofDocumentId: documentId,
      }),
    );
    expect(harness.sql.begin).toHaveBeenCalledOnce();
  });

  it("rejects payment proof and clears any accepted proof", async () => {
    const harness = createHarness();

    await harness.service.reviewEvidence({
      caseId,
      documentId,
      decision: "rejected",
      reason: "Amount mismatch",
      actorId,
    });

    expect(harness.documents.reviewDocument).toHaveBeenCalledWith({
      documentId,
      reviewerId: actorId,
      decision: "rejected",
      reason: "Amount mismatch",
    });
    expect(harness.annualReturns.updatePayment).toHaveBeenCalledWith({
      caseId,
      status: "Payment pending",
      paymentProofDocumentId: null,
      actorId,
    });
  });

  it("maps checklist evidence decisions to the matching checklist state", async () => {
    const checklistDocument = {
      ...baseDocument,
      category: "signature" as const,
      fileName: "signed-nar1.pdf",
    };
    const harness = createHarness(checklistDocument);

    await harness.service.reviewEvidence({
      caseId,
      documentId,
      checklistItemId,
      decision: "verified",
      actorId,
    });

    expect(harness.annualReturns.updateChecklistItem).toHaveBeenCalledWith({
      caseId,
      itemId: checklistItemId,
      status: "Verified",
      documentId,
      actorId,
    });
  });

  it("rejects evidence belonging to another case", async () => {
    const harness = createHarness({
      ...baseDocument,
      caseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    await expect(
      harness.service.reviewEvidence({
        caseId,
        documentId,
        decision: "verified",
        actorId,
      }),
    ).rejects.toThrow("Document does not belong to this annual return case.");

    expect(harness.documents.reviewDocument).not.toHaveBeenCalled();
    expect(harness.annualReturns.updatePayment).not.toHaveBeenCalled();
  });

  it("rejects quarantined and already reviewed evidence", async () => {
    const quarantined = createHarness({
      ...baseDocument,
      uploadStatus: "quarantined",
    });
    await expect(
      quarantined.service.reviewEvidence({
        caseId,
        documentId,
        decision: "verified",
        actorId,
      }),
    ).rejects.toThrow("Only available documents may be reviewed.");

    const duplicate = createHarness({
      ...baseDocument,
      reviewStatus: "verified",
    });
    await expect(
      duplicate.service.reviewEvidence({
        caseId,
        documentId,
        decision: "verified",
        actorId,
      }),
    ).rejects.toThrow("Document has already been reviewed.");
  });

  it("requires a checklist item for checklist evidence", async () => {
    const harness = createHarness({
      ...baseDocument,
      category: "registry",
    });

    await expect(
      harness.service.reviewEvidence({
        caseId,
        documentId,
        decision: "verified",
        actorId,
      }),
    ).rejects.toThrow("Checklist evidence requires a checklist item.");
  });

  it("verifies a filing receipt without changing case workflow state", async () => {
    const receipt = {
      ...baseDocument,
      category: "receipt" as const,
      fileName: "receipt.pdf",
    };
    const harness = createHarness(receipt);

    const result = await harness.service.reviewEvidence({
      caseId,
      documentId,
      decision: "verified",
      actorId,
    });

    expect(result.document.reviewStatus).toBe("verified");
    expect(result.caseItem).toBe(baseCase);
    expect(harness.annualReturns.updateChecklistItem).not.toHaveBeenCalled();
    expect(harness.annualReturns.updatePayment).not.toHaveBeenCalled();
  });

  it("authorizes the actor before reviewing receipt evidence", async () => {
    const receipt = {
      ...baseDocument,
      category: "receipt" as const,
      fileName: "receipt.pdf",
    };
    const harness = createHarness(receipt);
    vi.mocked(harness.annualReturns.assertCanMutateCase).mockRejectedValue(
      new Error("Only assigned staff may update this case."),
    );

    await expect(
      harness.service.reviewEvidence({
        caseId,
        documentId,
        decision: "verified",
        actorId,
      }),
    ).rejects.toThrow("Only assigned staff may update this case.");

    expect(harness.annualReturns.assertCanMutateCase).toHaveBeenCalledWith(
      caseId,
      actorId,
      "update_filing_proof",
    );
    expect(harness.documents.reviewDocument).not.toHaveBeenCalled();
  });

  it("locks the document review before changing payment state", async () => {
    const harness = createHarness();

    await harness.service.reviewEvidence({
      caseId,
      documentId,
      decision: "verified",
      actorId,
    });

    const reviewOrder = vi.mocked(harness.documents.reviewDocument).mock.invocationCallOrder[0];
    const updateOrder = vi.mocked(harness.annualReturns.updatePayment).mock.invocationCallOrder[0];
    expect(reviewOrder).toBeLessThan(updateOrder);
  });

  it("allows only one case mutation when concurrent reviews race on the same document", async () => {
    const harness = createHarness();
    vi.mocked(harness.documents.reviewDocument)
      .mockResolvedValueOnce(harness.reviewedDocument)
      .mockRejectedValueOnce(new Error("Document has already been reviewed."));

    const input = {
      caseId,
      documentId,
      decision: "verified" as const,
      actorId,
    };
    const results = await Promise.allSettled([
      harness.service.reviewEvidence(input),
      harness.service.reviewEvidence(input),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(harness.annualReturns.updatePayment).toHaveBeenCalledOnce();
  });

  it("preserves a different accepted payment proof when rejecting a replacement", async () => {
    const acceptedDocumentId = "88888888-8888-4888-8888-888888888888";
    const caseWithAcceptedProof = {
      ...baseCase,
      payment: {
        ...baseCase.payment!,
        status: "Payment received" as const,
        paymentProofDocumentId: acceptedDocumentId,
      },
    };
    const harness = createHarness(baseDocument, caseWithAcceptedProof);

    const result = await harness.service.reviewEvidence({
      caseId,
      documentId,
      decision: "rejected",
      reason: "Replacement is invalid",
      actorId,
    });

    expect(harness.annualReturns.updatePayment).not.toHaveBeenCalled();
    expect(result.caseItem).toBe(caseWithAcceptedProof);
  });

  it("preserves a different verified checklist proof when rejecting a replacement", async () => {
    const acceptedDocumentId = "88888888-8888-4888-8888-888888888888";
    const checklistDocument = {
      ...baseDocument,
      category: "signature" as const,
      fileName: "replacement-nar1.pdf",
    };
    const caseWithAcceptedProof = {
      ...baseCase,
      checklist: [
        {
          ...baseCase.checklist[0],
          status: "Verified" as const,
          documentId: acceptedDocumentId,
          verifiedAt: "2026-07-12T01:00:00.000Z",
        },
      ],
    };
    const harness = createHarness(checklistDocument, caseWithAcceptedProof);

    const result = await harness.service.reviewEvidence({
      caseId,
      documentId,
      checklistItemId,
      decision: "rejected",
      reason: "Replacement is invalid",
      actorId,
    });

    expect(harness.annualReturns.updateChecklistItem).not.toHaveBeenCalled();
    expect(result.caseItem).toBe(caseWithAcceptedProof);
  });

  it("treats accepting the same filing receipt as idempotent", async () => {
    const receipt = {
      ...baseDocument,
      category: "receipt" as const,
      fileName: "receipt.pdf",
      reviewStatus: "verified" as const,
    };
    const acceptedCase = {
      ...baseCase,
      filingReference: "NAR1-2026-001",
      confirmationDocumentId: documentId,
    };
    const harness = createHarness(receipt, acceptedCase);

    const result = await harness.service.acceptFilingReceipt({
      caseId,
      documentId,
      filingReference: " NAR1-2026-001 ",
      actorId,
    });

    expect(result).toBe(acceptedCase);
    expect(harness.annualReturns.updateFilingProof).not.toHaveBeenCalled();
  });

  it("does not replay an accepted receipt after the case becomes locked", async () => {
    const receipt = {
      ...baseDocument,
      category: "receipt" as const,
      fileName: "receipt.pdf",
      reviewStatus: "verified" as const,
    };
    const acceptedCase = {
      ...baseCase,
      filingReference: "NAR1-2026-001",
      confirmationDocumentId: documentId,
      currentStatus: "Completed" as const,
      lockedAt: "2026-07-12T02:00:00.000Z",
      completedAt: "2026-07-12T02:00:00.000Z",
    };
    const harness = createHarness(receipt, acceptedCase);
    vi.mocked(harness.annualReturns.assertCanMutateCase).mockRejectedValue(
      new Error("Completed annual return cases are locked."),
    );

    await expect(
      harness.service.acceptFilingReceipt({
        caseId,
        documentId,
        filingReference: "NAR1-2026-001",
        actorId,
      }),
    ).rejects.toThrow("Completed annual return cases are locked.");

    expect(harness.annualReturns.updateFilingProof).not.toHaveBeenCalled();
  });

  it("rejects replacement of an accepted filing receipt", async () => {
    const receipt = {
      ...baseDocument,
      category: "receipt" as const,
      fileName: "receipt.pdf",
      reviewStatus: "verified" as const,
    };
    const acceptedCase = {
      ...baseCase,
      filingReference: "NAR1-2026-000",
      confirmationDocumentId: "88888888-8888-4888-8888-888888888888",
    };
    const harness = createHarness(receipt, acceptedCase);

    await expect(
      harness.service.acceptFilingReceipt({
        caseId,
        documentId,
        filingReference: "NAR1-2026-001",
        actorId,
      }),
    ).rejects.toThrow("Filing receipt has already been accepted.");

    expect(harness.annualReturns.updateFilingProof).not.toHaveBeenCalled();
  });
  it("accepts only an available verified receipt for the same case", async () => {
    const receipt = {
      ...baseDocument,
      category: "receipt" as const,
      fileName: "receipt.pdf",
      reviewStatus: "verified" as const,
    };
    const harness = createHarness(receipt);

    await harness.service.acceptFilingReceipt({
      caseId,
      documentId,
      filingReference: "NAR1-2026-001",
      actorId,
    });

    expect(harness.annualReturns.updateFilingProof).toHaveBeenCalledWith({
      caseId,
      filingReference: "NAR1-2026-001",
      confirmationDocumentId: documentId,
      actorId,
    });
  });
});
