import { describe, expect, it } from "vitest";

import { boardMetrics } from "./board-metrics";
import type { AnnualReturnCase } from "./types";

const TODAY = "2026-07-30";

function makeCase(overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    companyTeamId: "33333333-3333-4333-8333-333333333333",
    companyName: "Acme Company Limited",
    returnYear: 2026,
    madeUpDate: "2026-06-30",
    filingDueDate: "2026-08-11",
    currentStatus: "Upcoming",
    riskLevel: "green",
    ownerId: "44444444-4444-4444-8444-444444444444",
    ownerName: "Ada Chan",
    reviewerId: null,
    reviewerName: null,
    remindersSent: 0,
    filingReference: null,
    confirmationDocumentId: null,
    lockedAt: null,
    completedAt: null,
    checklist: [],
    payment: null,
    ...overrides,
  };
}

describe("boardMetrics", () => {
  it("counts an open case past its due date as overdue", () => {
    const metrics = boardMetrics(
      [makeCase({ filingDueDate: "2026-07-01", riskLevel: "red" })],
      TODAY,
    );

    expect(metrics.overdue).toBe(1);
  });

  it("does not count a filed case as overdue or high risk even when its risk is red", () => {
    // riskForCase returns green for Filed only when completionBlockers is empty;
    // otherwise a filed-but-past-due case carries riskLevel "red". Filed work is
    // not outstanding work.
    const metrics = boardMetrics(
      [
        makeCase({
          currentStatus: "Filed",
          filingDueDate: "2026-07-01",
          riskLevel: "red",
        }),
      ],
      TODAY,
    );

    expect(metrics.overdue).toBe(0);
    expect(metrics.highRisk).toBe(0);
  });

  it("counts orange and red open cases as high risk", () => {
    const metrics = boardMetrics(
      [makeCase({ riskLevel: "orange" }), makeCase({ riskLevel: "red" }), makeCase()],
      TODAY,
    );

    expect(metrics.highRisk).toBe(2);
  });

  it("splits the deadline windows at 7 and 30 days inclusive", () => {
    const metrics = boardMetrics(
      [
        makeCase({ filingDueDate: "2026-08-06" }), // 7 days out
        makeCase({ filingDueDate: "2026-08-07" }), // 8 days out
        makeCase({ filingDueDate: "2026-08-29" }), // 30 days out
        makeCase({ filingDueDate: "2026-08-30" }), // 31 days out
      ],
      TODAY,
    );

    expect(metrics.dueIn7).toBe(1);
    expect(metrics.dueIn30).toBe(3);
  });

  it("counts a case with an unverified required checklist item as missing documents", () => {
    const item = {
      id: "55555555-5555-4555-8555-555555555555",
      caseId: "11111111-1111-4111-8111-111111111111",
      itemLabel: "Signed NAR1",
      required: true,
      status: "Received" as const,
      dueDate: "2026-08-01",
      receivedAt: "2026-07-10T00:00:00.000Z",
      verifiedAt: null,
      documentId: null,
    };

    expect(boardMetrics([makeCase({ checklist: [item] })], TODAY).missingDocuments).toBe(1);
  });

  it("ignores optional checklist items when counting missing documents", () => {
    const optional = {
      id: "55555555-5555-4555-8555-555555555555",
      caseId: "11111111-1111-4111-8111-111111111111",
      itemLabel: "Nice to have",
      required: false,
      status: "Missing" as const,
      dueDate: "2026-08-01",
      receivedAt: null,
      verifiedAt: null,
      documentId: null,
    };

    expect(boardMetrics([makeCase({ checklist: [optional] })], TODAY).missingDocuments).toBe(0);
  });

  it("counts pending and overdue payments, not received ones", () => {
    const payment = {
      id: "66666666-6666-4666-8666-666666666666",
      caseId: "11111111-1111-4111-8111-111111111111",
      invoiceNumber: "INV-1",
      amount: 2800,
      currency: "HKD" as const,
      status: "Payment pending" as const,
      dueDate: "2026-08-01",
      paidAt: null,
      paymentProofDocumentId: null,
    };

    const metrics = boardMetrics(
      [
        makeCase({ payment }),
        makeCase({ payment: { ...payment, status: "Overdue" } }),
        makeCase({ payment: { ...payment, status: "Payment received" } }),
        makeCase({ payment: null }),
      ],
      TODAY,
    );

    expect(metrics.paymentPending).toBe(2);
  });

  it("returns zeroes for an empty board", () => {
    expect(boardMetrics([], TODAY)).toEqual({
      dueIn7: 0,
      dueIn30: 0,
      overdue: 0,
      highRisk: 0,
      missingDocuments: 0,
      paymentPending: 0,
    });
  });
});
