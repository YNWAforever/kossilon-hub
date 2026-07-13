import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnEvidenceService } from "./evidence-service";
import {
  acceptAnnualReturnFilingReceiptForActor,
  reviewAnnualReturnEvidenceForActor,
} from "./evidence-server-fns";

const caseId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";

const clientActor: AuthenticatedActor = {
  authUserId: "client-auth",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};

const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: staffId,
  role: "Staff",
  teamId: "44444444-4444-4444-8444-444444444444",
  active: true,
};

function createService() {
  return {
    reviewEvidence: vi.fn(async () => ({ document: {}, caseItem: {} })),
    acceptFilingReceipt: vi.fn(async () => ({})),
  } as unknown as AnnualReturnEvidenceService;
}

describe("annual return evidence server-function authorization", () => {
  it("rejects client evidence review before calling the service", async () => {
    const service = createService();

    await expect(
      reviewAnnualReturnEvidenceForActor(
        clientActor,
        {
          caseId,
          documentId,
          decision: "verified",
        },
        { service },
      ),
    ).rejects.toThrow(/staff access is required/i);

    expect(service.reviewEvidence).not.toHaveBeenCalled();
  });

  it("passes a validated staff review with the database actor ID", async () => {
    const service = createService();

    await reviewAnnualReturnEvidenceForActor(
      staffActor,
      {
        caseId,
        documentId,
        decision: "rejected",
        reason: "  Amount mismatch.  ",
      },
      { service },
    );

    expect(service.reviewEvidence).toHaveBeenCalledWith({
      caseId,
      documentId,
      decision: "rejected",
      reason: "Amount mismatch.",
      actorId: staffId,
    });
  });

  it("rejects client receipt acceptance and passes a trimmed staff filing reference", async () => {
    const service = createService();

    await expect(
      acceptAnnualReturnFilingReceiptForActor(
        clientActor,
        {
          caseId,
          documentId,
          filingReference: "NAR1-2026-001",
        },
        { service },
      ),
    ).rejects.toThrow(/staff access is required/i);

    await acceptAnnualReturnFilingReceiptForActor(
      staffActor,
      {
        caseId,
        documentId,
        filingReference: "  NAR1-2026-001  ",
      },
      { service },
    );

    expect(service.acceptFilingReceipt).toHaveBeenCalledWith({
      caseId,
      documentId,
      filingReference: "NAR1-2026-001",
      actorId: staffId,
    });
  });
});
