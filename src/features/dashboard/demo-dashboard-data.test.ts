import { describe, expect, it } from "vitest";
import {
  DEMO_RISK_TO_PRODUCTION,
  DEMO_STATUS_TO_PRODUCTION,
  demoDashboardDependencies,
  demoDashboardMetrics,
  toDashboardCase,
} from "./demo-dashboard-data";
import { getAnnualReturnCases, resetAnnualReturnCasesForTest } from "@/lib/annual-return-store";

const TODAY = new Date("2026-07-05T09:00:00+08:00");

describe("demo status translation", () => {
  it("maps every demo status to a production status", () => {
    // The demo store's status union, spelled out. If a status is added there
    // and not here, this fails rather than silently rendering undefined.
    expect(Object.keys(DEMO_STATUS_TO_PRODUCTION).sort()).toEqual([
      "filed",
      "internal-review",
      "payment-pending",
      "preparing",
      "ready-to-file",
      "waiting-documents",
    ]);

    expect(DEMO_STATUS_TO_PRODUCTION).toEqual({
      preparing: "Upcoming",
      "waiting-documents": "Documents pending",
      "payment-pending": "Payment pending",
      "internal-review": "NAR1 prepared",
      "ready-to-file": "Ready to file",
      filed: "Filed",
    });
  });

  it("maps every demo risk level onto the four production levels", () => {
    expect(Object.keys(DEMO_RISK_TO_PRODUCTION).sort()).toEqual([
      "blocked",
      "due-soon",
      "filed",
      "healthy",
      "overdue",
      "ready-to-file",
    ]);

    expect(DEMO_RISK_TO_PRODUCTION).toEqual({
      overdue: "red",
      blocked: "orange",
      "due-soon": "yellow",
      healthy: "green",
      "ready-to-file": "green",
      filed: "green",
    });
  });
});

describe("toDashboardCase", () => {
  it("builds the checklist from demo documents, which are what carry required", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    const dashboardCase = toDashboardCase(demoCase, TODAY);

    expect(dashboardCase.checklist).toHaveLength(demoCase.documents.length);
    expect(dashboardCase.checklist).toEqual(
      demoCase.documents.map((document) => ({
        required: document.required,
        status: document.received ? "Verified" : "Missing",
      })),
    );
  });

  it("carries the identity fields across unchanged", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    const dashboardCase = toDashboardCase(demoCase, TODAY);

    expect(dashboardCase).toMatchObject({
      id: demoCase.id,
      companyName: demoCase.companyName,
      filingDueDate: demoCase.dueDate,
      ownerName: demoCase.owner,
    });
  });

  it("reports payment received only when the demo case is paid", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    expect(toDashboardCase({ ...demoCase, paymentStatus: "paid" }, TODAY).payment).toEqual({
      status: "Payment received",
    });
    expect(toDashboardCase({ ...demoCase, paymentStatus: "pending" }, TODAY).payment).toEqual({
      status: "Payment pending",
    });
    expect(toDashboardCase({ ...demoCase, paymentStatus: "overdue" }, TODAY).payment).toEqual({
      status: "Overdue",
    });
  });

  it("treats a filed case as having its filing proof recorded", () => {
    resetAnnualReturnCasesForTest();
    const demoCase = getAnnualReturnCases()[0];

    const filed = toDashboardCase(
      {
        ...demoCase,
        status: "filed",
        submission: { reference: "NAR1-9", submittedAt: "2026-06-01", submittedBy: "Amy Chan" },
      },
      TODAY,
    );

    expect(filed.currentStatus).toBe("Filed");
    expect(filed.filingReference).toBe("NAR1-9");

    const unfiled = toDashboardCase(
      { ...demoCase, status: "preparing", submission: undefined },
      TODAY,
    );
    expect(unfiled.filingReference).toBeNull();
  });
});

describe("demoDashboardMetrics", () => {
  // These fields are exactly what getRiskLevel reads, transitively through
  // getReadinessScore and getBlockers. Omitting checklist, signatureStatus or
  // reviewStatus makes getReadinessScore throw on undefined; omitting owner
  // makes getBlockers throw on undefined too (it reads caseItem.owner.trim())
  // once a case falls through to the blocked/healthy branch. Both were
  // confirmed by running this suite against a narrower fixture first.
  const openCase = {
    dueDate: "2026-07-09",
    status: "waiting-documents" as const,
    paymentStatus: "pending" as const,
    signatureStatus: "missing" as const,
    reviewStatus: "not-started" as const,
    owner: "Iris Wong",
    checklist: [{ id: "c1", label: "Directors confirmed", complete: false }],
    documents: [
      { id: "d1", label: "Signed NAR1", required: true, received: false },
      { id: "d2", label: "Register of members", required: true, received: true },
      { id: "d3", label: "Optional extra", required: false, received: false },
    ],
  };

  it("counts deadline windows, missing required evidence, and unpaid cases", () => {
    const metrics = demoDashboardMetrics(
      [
        // 4 days out, one required document missing, unpaid
        { ...openCase, id: "a", dueDate: "2026-07-09" },
        // 20 days out, same shape
        { ...openCase, id: "b", dueDate: "2026-07-25" },
        // overdue
        { ...openCase, id: "c", dueDate: "2026-06-30" },
        // filed: excluded from every count
        { ...openCase, id: "d", dueDate: "2026-07-09", status: "filed", paymentStatus: "paid" },
      ],
      TODAY,
    );

    expect(metrics).toMatchObject({
      dueIn7: 1,
      dueIn30: 2,
      overdue: 1,
      missingDocuments: 3,
      paymentPending: 3,
    });
  });

  it("counts open cases as assigned to the viewer, since the demo has one operator", () => {
    const metrics = demoDashboardMetrics(
      [
        { ...openCase, id: "a" },
        { ...openCase, id: "b", status: "filed" },
      ],
      TODAY,
    );

    expect(metrics.assignedToMe).toBe(1);
  });

  it("counts red and orange cases as high risk", () => {
    // Both cases share openCase's base shape, which always has an open
    // blocker (a missing required document, an unpaid balance, a missing
    // signature, and a review that has not started). A due date far in the
    // future is not enough on its own to make getRiskLevel call a case
    // "healthy" — with those blockers still open it falls through to
    // "blocked", which DEMO_RISK_TO_PRODUCTION maps to "orange". So both
    // cases here are high risk: the first for being overdue (red), the
    // second for being blocked (orange).
    const metrics = demoDashboardMetrics(
      [
        { ...openCase, id: "overdue-case", dueDate: "2026-06-01" },
        { ...openCase, id: "blocked-case", dueDate: "2026-12-01" },
      ],
      TODAY,
    );

    expect(metrics.highRisk).toBe(2);
  });
});

describe("demoDashboardDependencies", () => {
  it("satisfies the loader's dependency contract with demo figures", async () => {
    resetAnnualReturnCasesForTest();

    const [metrics, cases] = await Promise.all([
      demoDashboardDependencies.getAnnualReturnDashboardMetrics(),
      demoDashboardDependencies.listAnnualReturnCases({ data: {} }),
    ]);

    expect(cases.length).toBeGreaterThan(0);
    // Production vocabulary, not the demo store's kebab-case.
    for (const dashboardCase of cases) {
      expect(dashboardCase.currentStatus).toMatch(/^[A-Z]/);
      expect(["green", "yellow", "orange", "red"]).toContain(dashboardCase.riskLevel);
    }

    // Not the all-zero fallback — that is the defect this whole plan fixes.
    const total = Object.values(metrics).reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(0);
  });
});
