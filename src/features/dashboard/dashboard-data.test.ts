import { describe, expect, it } from "vitest";
import type { AnnualReturnCase } from "@/features/annual-return/types";
import { loadDashboardData } from "./dashboard-data";

const metrics = {
  dueIn7: 2,
  dueIn30: 5,
  overdue: 1,
  highRisk: 2,
  missingDocuments: 3,
  paymentPending: 4,
  assignedToMe: 6,
};

function annualReturnCase(partial: Partial<AnnualReturnCase>): AnnualReturnCase {
  return {
    id: partial.id ?? "ar-test",
    companyId: partial.companyId ?? "company-test",
    companyTeamId: partial.companyTeamId ?? "team-a",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    returnYear: partial.returnYear ?? 2026,
    madeUpDate: partial.madeUpDate ?? "2026-06-01",
    filingDueDate: partial.filingDueDate ?? "2026-07-05",
    currentStatus: partial.currentStatus ?? "Documents pending",
    riskLevel: partial.riskLevel ?? "red",
    ownerId: partial.ownerId ?? "u-amy",
    ownerName: partial.ownerName ?? "Amy Chan",
    reviewerId: partial.reviewerId ?? null,
    reviewerName: partial.reviewerName ?? null,
    remindersSent: partial.remindersSent ?? 1,
    filingReference: partial.filingReference ?? null,
    confirmationDocumentId: partial.confirmationDocumentId ?? null,
    lockedAt: partial.lockedAt ?? null,
    completedAt: partial.completedAt ?? null,
    checklist: partial.checklist ?? [],
    payment: partial.payment ?? null,
  };
}

describe("dashboard data loader", () => {
  it("returns live annual-return metrics and open upcoming cases", async () => {
    const data = await loadDashboardData({
      getAnnualReturnDashboardMetrics: async () => metrics,
      listAnnualReturnCases: async () => [
        annualReturnCase({ id: "open-1" }),
        annualReturnCase({ id: "complete-1", currentStatus: "Completed" }),
      ],
    });

    expect(data).toMatchObject({
      metrics,
      annualReturnDataAvailable: true,
      annualReturnDataError: null,
    });
    expect(data.upcomingAnnualReturns.map((case_) => case_.id)).toEqual(["open-1"]);
  });

  it("falls back instead of throwing when annual-return data is unavailable", async () => {
    const data = await loadDashboardData({
      getAnnualReturnDashboardMetrics: async () => {
        throw new Error("KOSSILON_ANNUAL_RETURN_ACTOR_ID actor is not configured.");
      },
      listAnnualReturnCases: async () => [],
    });

    expect(data).toEqual({
      metrics: {
        dueIn7: 0,
        dueIn30: 0,
        overdue: 0,
        highRisk: 0,
        missingDocuments: 0,
        paymentPending: 0,
        assignedToMe: 0,
      },
      upcomingAnnualReturns: [],
      annualReturnDataAvailable: false,
      annualReturnDataError: "Annual return data is temporarily unavailable.",
    });
  });
});
