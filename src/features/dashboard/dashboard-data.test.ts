import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DashboardCase } from "@/features/dashboard/types";
import { demoDashboardDependencies } from "./demo-dashboard-data";
import { resetAnnualReturnCasesForTest } from "@/lib/annual-return-store";
import { loadDashboardData, dashboardActorScopeKey, dashboardDataForActor } from "./dashboard-data";

const metrics = {
  businessDate: "2026-10-01",
  total: 9,
  activeCases: 8,
  overdueCases: 1,
  missingDocumentCount: 3,
  casesWithMissingDocuments: 2,
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
    const listAnnualReturnCases = vi.fn(async () => [
      annualReturnCase({ id: "open-1" }),
      annualReturnCase({ id: "complete-1", currentStatus: "Completed" }),
      annualReturnCase({ id: "filed-1", currentStatus: "Filed" }),
    ]);
    const data = await loadDashboardData({
      getAnnualReturnDashboardMetrics: async () => metrics,
      listAnnualReturnCases,
    });

    expect(data).toMatchObject({
      metrics,
      annualReturnDataAvailable: true,
      annualReturnDataError: null,
    });
    expect(data.upcomingAnnualReturns.map((case_) => case_.id)).toEqual(["open-1"]);
    expect(listAnnualReturnCases).toHaveBeenCalledWith({ data: { activeOnly: true, limit: 8 } });
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
      businessDate: "",
      total: 0,
      activeCases: 0,
      overdueCases: 0,
      missingDocumentCount: 0,
      casesWithMissingDocuments: 0,
      dueIn7: 0,
      dueIn30: 0,
      overdue: 0,
      highRisk: 0,
      missingDocuments: 0,
      paymentPending: 0,
      assignedToMe: 0,
    });
  });

  it("hides privileged cached figures when the actor role, team, identity or active flag changes", async () => {
    const actor: AuthenticatedActor = {
      authUserId: "auth-admin",
      userId: "admin",
      role: "Admin",
      teamId: "team-a",
      active: true,
    };
    const data = {
      ...(await loadDashboardData({
        getAnnualReturnDashboardMetrics: async () => metrics,
        listAnnualReturnCases: async () => [annualReturnCase({})],
      })),
      actorScopeKey: dashboardActorScopeKey(actor),
    };
    expect(dashboardDataForActor(data, actor)).toBe(data);
    for (const next of [
      null,
      { ...actor, role: "Staff" as const },
      { ...actor, teamId: "team-b" },
      { ...actor, userId: "other" },
      { ...actor, authUserId: "other-session" },
      { ...actor, active: false },
    ]) {
      const filtered = dashboardDataForActor(data, next);
      expect(filtered.annualReturnDataAvailable).toBe(false);
      expect(filtered.upcomingAnnualReturns).toEqual([]);
      expect(filtered.metrics.total).toBe(0);
    }
  });
});
