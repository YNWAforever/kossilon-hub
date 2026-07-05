import { describe, expect, it } from "vitest";
import {
  ANNUAL_RETURN_STATUSES,
  buildReminderDraft,
  calculateFilingDueDate,
  completionBlockers,
  isAllowedStatusTransition,
  riskForCase,
  shouldGenerateCase,
} from "./workflow";
import type { AnnualReturnCase } from "./types";

const baseCase: AnnualReturnCase = {
  id: "case-1",
  companyId: "company-1",
  companyName: "Harbour Trading Ltd",
  returnYear: 2026,
  madeUpDate: "2026-07-01",
  filingDueDate: "2026-08-12",
  currentStatus: "Documents pending",
  riskLevel: "green",
  ownerId: "user-1",
  ownerName: "Amy Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 0,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [
    {
      id: "item-1",
      caseId: "case-1",
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
    id: "payment-1",
    caseId: "case-1",
    invoiceNumber: "INV-2026-001",
    amount: 3800,
    currency: "HKD",
    status: "Payment pending",
    dueDate: "2026-08-01",
    paidAt: null,
    paymentProofDocumentId: null,
  },
};

describe("annual return workflow", () => {
  it("calculates the filing due date as 42 days after the basis date", () => {
    expect(calculateFilingDueDate("2026-07-01")).toBe("2026-08-12");
  });

  it("generates cases inside the 90-day window only", () => {
    expect(shouldGenerateCase("2026-08-12", "2026-05-14")).toBe(false);
    expect(shouldGenerateCase("2026-08-12", "2026-05-15")).toBe(true);
    expect(shouldGenerateCase("2026-08-12", "2026-08-13")).toBe(true);
  });

  it("uses yellow, orange, and red risk thresholds", () => {
    expect(riskForCase(baseCase, "2026-07-13")).toBe("yellow");
    expect(riskForCase(baseCase, "2026-07-30")).toBe("orange");
    expect(riskForCase(baseCase, "2026-08-06")).toBe("red");
    expect(riskForCase(baseCase, "2026-08-13")).toBe("red");
  });

  it("allows only forward lifecycle transitions for normal staff flow", () => {
    expect(isAllowedStatusTransition("Upcoming", "Client reminder sent")).toBe(true);
    expect(isAllowedStatusTransition("Payment pending", "Payment received")).toBe(true);
    expect(isAllowedStatusTransition("Payment received", "Documents pending")).toBe(false);
    expect(isAllowedStatusTransition("Completed", "Filed")).toBe(false);
  });

  it("exposes the approved status lifecycle in order", () => {
    expect(ANNUAL_RETURN_STATUSES).toEqual([
      "Upcoming",
      "Client reminder sent",
      "Documents pending",
      "Documents received",
      "Payment pending",
      "Payment received",
      "NAR1 prepared",
      "Signature pending",
      "Ready to file",
      "Filed",
      "Completed",
    ]);
  });

  it("blocks completion until evidence is present", () => {
    expect(completionBlockers(baseCase).map((b) => b.code)).toEqual([
      "required_checklist_unverified",
      "payment_not_received",
      "filing_reference_missing",
      "confirmation_document_missing",
    ]);
  });

  it("allows completion when required evidence is present", () => {
    const ready: AnnualReturnCase = {
      ...baseCase,
      currentStatus: "Filed",
      filingReference: "CR-NAR1-2026-0001",
      confirmationDocumentId: "doc-confirmation",
      checklist: [
        {
          ...baseCase.checklist[0],
          status: "Verified",
          receivedAt: "2026-07-20T09:00:00.000Z",
          verifiedAt: "2026-07-21T09:00:00.000Z",
          documentId: "doc-1",
        },
      ],
      payment: {
        ...baseCase.payment!,
        status: "Payment received",
        paidAt: "2026-07-21T10:00:00.000Z",
        paymentProofDocumentId: "doc-proof",
      },
    };

    expect(completionBlockers(ready)).toEqual([]);
  });

  it("builds a staff-copyable WhatsApp reminder draft", () => {
    expect(buildReminderDraft(baseCase)).toContain("Harbour Trading Ltd");
    expect(buildReminderDraft(baseCase)).toContain("2026-08-12");
    expect(buildReminderDraft(baseCase)).toContain("Signed NAR1 form");
  });
});
