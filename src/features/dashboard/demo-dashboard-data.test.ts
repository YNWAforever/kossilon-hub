import { describe, expect, it } from "vitest";
import {
  DEMO_RISK_TO_PRODUCTION,
  DEMO_STATUS_TO_PRODUCTION,
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
