import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnnualReturnStatus } from "./types";
import {
  ANNUAL_RETURN_STATUSES,
  buildReminderDraft,
  calculateFilingDueDate,
  completionBlockers,
  hasRequiredChecklistEvidence,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  riskForCase,
  shouldGenerateCase,
} from "./workflow";
import type { AnnualReturnCase, AnnualReturnChecklistItem } from "./types";

const baseCase: AnnualReturnCase = {
  id: "case-1",
  companyId: "company-1",
  companyTeamId: "team-1",
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

const readyCase: AnnualReturnCase = {
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

describe("annual return workflow", () => {
  it("calculates the filing due date as 42 days after the basis date", () => {
    expect(calculateFilingDueDate("2026-07-01")).toBe("2026-08-12");
  });

  it("generates cases when the filing due date is 90 days away or overdue", () => {
    expect(shouldGenerateCase("2026-08-12", "2026-05-13")).toBe(false);
    expect(shouldGenerateCase("2026-08-12", "2026-05-14")).toBe(true);
    expect(shouldGenerateCase("2026-08-12", "2026-08-13")).toBe(true);
  });

  it("uses 60, 30, 14, 7, and overdue risk thresholds", () => {
    expect(riskForCase(baseCase, "2026-06-13")).toBe("green");
    expect(riskForCase(baseCase, "2026-07-13")).toBe("yellow");
    expect(riskForCase(baseCase, "2026-07-29")).toBe("orange");
    expect(riskForCase(baseCase, "2026-08-05")).toBe("red");
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

  it("blocks completion when payment proof is missing", () => {
    const missingPaymentProof: AnnualReturnCase = {
      ...readyCase,
      payment: {
        ...readyCase.payment!,
        paymentProofDocumentId: null,
      },
    };

    expect(completionBlockers(missingPaymentProof).map((b) => b.code)).toEqual([
      "payment_proof_missing",
    ]);
  });

  it("allows completion when required evidence is present", () => {
    expect(completionBlockers(readyCase)).toEqual([]);
  });

  it("blocks completion when verified checklist evidence fields are missing", () => {
    const missingEvidence: AnnualReturnCase = {
      ...readyCase,
      checklist: [
        {
          ...readyCase.checklist[0],
          receivedAt: null,
          verifiedAt: null,
          documentId: null,
        },
      ],
    };

    expect(completionBlockers(missingEvidence).map((b) => b.code)).toEqual([
      "required_checklist_unverified",
    ]);
  });

  it("blocks completion when filing evidence identifiers are blank", () => {
    const blankFilingEvidence: AnnualReturnCase = {
      ...readyCase,
      filingReference: "   ",
      confirmationDocumentId: "\t",
    };

    expect(completionBlockers(blankFilingEvidence).map((b) => b.code)).toEqual([
      "filing_reference_missing",
      "confirmation_document_missing",
    ]);
  });

  it("keeps filed and completed cases green after the due date when evidence is complete", () => {
    expect(riskForCase(readyCase, "2026-08-13")).toBe("green");
    expect(
      riskForCase(
        {
          ...readyCase,
          currentStatus: "Completed",
        },
        "2026-08-13",
      ),
    ).toBe("green");
  });

  it("builds a staff-copyable WhatsApp reminder draft", () => {
    expect(buildReminderDraft(baseCase)).toContain("Harbour Trading Ltd");
    expect(buildReminderDraft(baseCase)).toContain("2026-08-12");
    expect(buildReminderDraft(baseCase)).toContain("Signed NAR1 form");
  });

  it("does not ask for outstanding items when required documents are complete", () => {
    expect(buildReminderDraft(readyCase)).not.toContain("outstanding items");
  });
});

describe("hongKongBusinessDate", () => {
  it("returns the Hong Kong calendar date regardless of the caller's timezone", () => {
    // 2026-07-30T17:30:00Z is 2026-07-31 01:30 in Hong Kong (UTC+8).
    expect(hongKongBusinessDate(new Date("2026-07-30T17:30:00.000Z"))).toBe("2026-07-31");
  });

  it("does not roll over before Hong Kong midnight", () => {
    // 2026-07-30T15:59:00Z is 2026-07-30 23:59 in Hong Kong.
    expect(hongKongBusinessDate(new Date("2026-07-30T15:59:00.000Z"))).toBe("2026-07-30");
  });

  it("zero-pads single-digit months and days", () => {
    expect(hongKongBusinessDate(new Date("2026-01-05T04:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("package scripts", () => {
  it("does not point database commands at missing script files", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const scripts = packageJson.scripts ?? {};

    const databaseScripts = [
      ["db:migrate", "scripts/db-migrate.ts"],
      ["db:seed", "scripts/db-seed-annual-return.ts"],
    ] as const;

    for (const [scriptName, scriptPath] of databaseScripts) {
      if (scripts[scriptName]) {
        expect(scripts[scriptName]).toBe(`bun ${scriptPath}`);
        expect(existsSync(resolve(process.cwd(), scriptPath))).toBe(true);
      } else {
        expect(existsSync(resolve(process.cwd(), scriptPath))).toBe(false);
      }
    }
  });

  it("keeps annual return seed idempotency aligned with database natural keys", () => {
    const seedScript = readFileSync(
      resolve(process.cwd(), "scripts/db-seed-annual-return.ts"),
      "utf8",
    );

    expect(seedScript).toContain("Reserved fixture UUID ranges");
    expect(seedScript).toContain("on conflict (company_id, return_year)");
    expect(seedScript).toContain("returning company_id, id");
    expect(seedScript).toContain("on conflict (case_id)");
    expect(seedScript).toContain("returning case_id, id");
  });
});

describe("hasRequiredChecklistEvidence", () => {
  const verified: AnnualReturnChecklistItem = {
    id: "44444444-4444-4444-8444-444444444444",
    caseId: "11111111-1111-4111-8111-111111111111",
    itemLabel: "Signed NAR1",
    required: true,
    status: "Verified",
    dueDate: "2026-08-01",
    receivedAt: "2026-07-10T00:00:00.000Z",
    verifiedAt: "2026-07-11T00:00:00.000Z",
    documentId: "55555555-5555-4555-8555-555555555555",
  };

  it("accepts an item that is verified with full evidence", () => {
    expect(hasRequiredChecklistEvidence(verified)).toBe(true);
  });

  it("rejects a Verified item with no document", () => {
    expect(hasRequiredChecklistEvidence({ ...verified, documentId: null })).toBe(false);
  });

  it("rejects a Verified item that was never marked received", () => {
    expect(hasRequiredChecklistEvidence({ ...verified, receivedAt: null })).toBe(false);
  });

  it("rejects an item that is only Received", () => {
    expect(hasRequiredChecklistEvidence({ ...verified, status: "Received" })).toBe(false);
  });
});

describe("isAllowedStatusTransition with an unrecognised status", () => {
  // indexOf returns -1 outside the enum, which made `toIndex === fromIndex + 1`
  // true for an unknown `from` and the first status — so a case whose status had
  // drifted from the enum could be walked back to the start of the workflow.
  it("refuses a transition out of a status that is not in the workflow", () => {
    expect(
      isAllowedStatusTransition("Archived" as AnnualReturnStatus, ANNUAL_RETURN_STATUSES[0]),
    ).toBe(false);
  });

  it("refuses a transition into a status that is not in the workflow", () => {
    expect(
      isAllowedStatusTransition(ANNUAL_RETURN_STATUSES[0], "Archived" as AnnualReturnStatus),
    ).toBe(false);
  });

  it("still allows the ordinary one-step advance", () => {
    expect(isAllowedStatusTransition(ANNUAL_RETURN_STATUSES[0], ANNUAL_RETURN_STATUSES[1])).toBe(
      true,
    );
    expect(isAllowedStatusTransition(ANNUAL_RETURN_STATUSES[1], ANNUAL_RETURN_STATUSES[0])).toBe(
      false,
    );
  });
});
