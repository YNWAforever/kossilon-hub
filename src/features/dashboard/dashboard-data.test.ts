import { describe, expect, it } from "vitest";
import type { DashboardCase } from "@/features/dashboard/types";
import { demoDashboardDependencies } from "./demo-dashboard-data";
import { resetAnnualReturnCasesForTest } from "@/lib/annual-return-store";
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

function annualReturnCase(partial: Partial<DashboardCase>): DashboardCase {
  return {
    id: partial.id ?? "ar-test",
    companyName: partial.companyName ?? "Harbour Trading Ltd",
    filingDueDate: partial.filingDueDate ?? "2026-07-05",
    currentStatus: partial.currentStatus ?? "Documents pending",
    riskLevel: partial.riskLevel ?? "red",
    ownerName: partial.ownerName ?? "Amy Chan",
    checklist: partial.checklist ?? [],
    payment: partial.payment ?? null,
    filingReference: partial.filingReference ?? null,
    confirmationDocumentId: partial.confirmationDocumentId ?? null,
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

  it("carries the real cause through instead of a fixed string", async () => {
    const data = await loadDashboardData({
      getAnnualReturnDashboardMetrics: async () => {
        throw new Error("connection terminated unexpectedly");
      },
      listAnnualReturnCases: async () => [],
    });

    expect(data.annualReturnDataAvailable).toBe(false);
    expect(data.annualReturnDataErrorKind).toBe("unavailable");
    expect(data.annualReturnDataError).toContain("connection terminated unexpectedly");
  });

  it("distinguishes an authorization failure from an outage", async () => {
    const data = await loadDashboardData({
      getAnnualReturnDashboardMetrics: async () => {
        throw new Error("Forbidden: staff access required");
      },
      listAnnualReturnCases: async () => [],
    });

    expect(data.annualReturnDataErrorKind).toBe("forbidden");
    expect(data.annualReturnDataError).not.toBe(
      (
        await loadDashboardData({
          getAnnualReturnDashboardMetrics: async () => {
            throw new Error("connection terminated unexpectedly");
          },
          listAnnualReturnCases: async () => [],
        })
      ).annualReturnDataError,
    );
  });

  it("returns the demo set when given the demo dependencies", async () => {
    // The spec's integration check: no server function is touched, and the
    // shape the dashboard renders comes back intact. This test lives here
    // rather than beside the demo module because it needs the widened
    // DashboardCase[] return type introduced in this task.
    resetAnnualReturnCasesForTest();

    const data = await loadDashboardData(demoDashboardDependencies);

    expect(data.annualReturnDataAvailable).toBe(true);
    expect(data.annualReturnDataError).toBeNull();
    expect(data.annualReturnDataErrorKind).toBeNull();
    expect(data.upcomingAnnualReturns.length).toBeGreaterThan(0);
    // loadDashboardData drops completed cases and caps the list at 8.
    expect(data.upcomingAnnualReturns.length).toBeLessThanOrEqual(8);
    expect(data.upcomingAnnualReturns.every((c) => c.currentStatus !== "Completed")).toBe(true);
  });

  it("still degrades rather than throwing, and reports no cases", async () => {
    const data = await loadDashboardData({
      getAnnualReturnDashboardMetrics: async () => {
        throw new Error("boom");
      },
      listAnnualReturnCases: async () => [],
    });

    expect(data.upcomingAnnualReturns).toEqual([]);
    expect(data.metrics).toEqual({
      dueIn7: 0,
      dueIn30: 0,
      overdue: 0,
      highRisk: 0,
      missingDocuments: 0,
      paymentPending: 0,
      assignedToMe: 0,
    });
  });
});
