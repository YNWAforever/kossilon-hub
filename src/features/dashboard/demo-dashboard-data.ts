import type { AnnualReturnDashboardMetrics } from "@/features/annual-return/repository";
import type { RiskLevel } from "@/features/annual-return/types";
import type { DashboardCase } from "@/features/dashboard/types";
import type {
  AnnualReturnCase as DemoAnnualReturnCase,
  AnnualReturnRiskLevel as DemoRiskLevel,
  AnnualReturnStatus as DemoStatus,
} from "@/lib/annual-return-store";
import { getAnnualReturnCases, getRiskLevel } from "@/lib/annual-return-store";

// Fabricating figures here is what demo mode is for. The rule this codebase
// enforces is no fabrication in production, which is why the same translation
// would be unacceptable on a production path.
//
// Mapping six demo statuses onto the eleven-value production vocabulary has no
// single correct answer. These tables encode one reading, and the tests pin
// them so a later change is deliberate rather than accidental.

export const DEMO_STATUS_TO_PRODUCTION: Record<DemoStatus, DashboardCase["currentStatus"]> = {
  preparing: "Upcoming",
  "waiting-documents": "Documents pending",
  "payment-pending": "Payment pending",
  "internal-review": "NAR1 prepared",
  "ready-to-file": "Ready to file",
  filed: "Filed",
};

export const DEMO_RISK_TO_PRODUCTION: Record<DemoRiskLevel, RiskLevel> = {
  overdue: "red",
  blocked: "orange",
  "due-soon": "yellow",
  healthy: "green",
  // A case that is ready to file, or already filed, carries no risk.
  "ready-to-file": "green",
  filed: "green",
};

const DEMO_PAYMENT_TO_PRODUCTION = {
  paid: "Payment received",
  pending: "Payment pending",
  overdue: "Overdue",
} as const;

export function toDashboardCase(demoCase: DemoAnnualReturnCase, today = new Date()): DashboardCase {
  return {
    id: demoCase.id,
    companyName: demoCase.companyName,
    currentStatus: DEMO_STATUS_TO_PRODUCTION[demoCase.status],
    filingDueDate: demoCase.dueDate,
    ownerName: demoCase.owner,
    riskLevel: DEMO_RISK_TO_PRODUCTION[getRiskLevel(demoCase, today)],
    // Production's checklist is the evidence list. The demo store keeps
    // evidence in `documents` — its `checklist` has no `required` flag, so it
    // cannot answer the question the dashboard asks.
    checklist: demoCase.documents.map((document) => ({
      required: document.required,
      status: document.received ? ("Verified" as const) : ("Missing" as const),
    })),
    payment: { status: DEMO_PAYMENT_TO_PRODUCTION[demoCase.paymentStatus] },
    filingReference: demoCase.submission?.reference ?? null,
    confirmationDocumentId: demoCase.receipt?.receiptNumber ?? null,
  };
}

// The demo store keeps this private, so it is restated here rather than
// exported from a read-only fixture module for one caller.
function daysUntil(date: string, today: Date): number {
  const target = new Date(`${date}T00:00:00`);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
}

// Everything demoDashboardMetrics reads directly, plus everything getRiskLevel
// reads underneath it. Keep these in step: getRiskLevel takes a full demo case,
// so the call below casts, and a field it reads that is missing here would
// throw at runtime with no compile error.
//
// `owner` is here because getRiskLevel's final branch calls getBlockers, which
// pushes an "owner" blocker via `caseItem.owner.trim()` — confirmed by a
// TypeError ("Cannot read properties of undefined (reading 'trim')") when this
// field was omitted, exactly the crash the cast makes possible with no
// compile-time warning.
type MetricsInput = Pick<
  DemoAnnualReturnCase,
  | "id"
  | "dueDate"
  | "status"
  | "paymentStatus"
  | "documents"
  | "checklist"
  | "signatureStatus"
  | "reviewStatus"
  | "owner"
>;

export function demoDashboardMetrics(
  demoCases: MetricsInput[],
  today = new Date(),
): AnnualReturnDashboardMetrics {
  const open = demoCases.filter((demoCase) => demoCase.status !== "filed");

  const missingRequired = (demoCase: MetricsInput) =>
    demoCase.documents.filter((document) => document.required && !document.received).length;

  return {
    dueIn7: open.filter((demoCase) => {
      const days = daysUntil(demoCase.dueDate, today);
      return days >= 0 && days <= 7;
    }).length,
    dueIn30: open.filter((demoCase) => {
      const days = daysUntil(demoCase.dueDate, today);
      return days >= 0 && days <= 30;
    }).length,
    overdue: open.filter((demoCase) => daysUntil(demoCase.dueDate, today) < 0).length,
    highRisk: open.filter((demoCase) => {
      const risk = DEMO_RISK_TO_PRODUCTION[getRiskLevel(demoCase as DemoAnnualReturnCase, today)];
      return risk === "red" || risk === "orange";
    }).length,
    missingDocuments: open.reduce((total, demoCase) => total + missingRequired(demoCase), 0),
    paymentPending: open.filter((demoCase) => demoCase.paymentStatus !== "paid").length,
    // The demo is a single-operator story, so every open case is the viewer's.
    assignedToMe: open.length,
  };
}

// Satisfies DashboardDataDependencies. The route loader swaps this in for the
// production server functions when dataMode is "demo".
//
// listAnnualReturnCases takes the same `{ data }` shape the production server
// function's caller passes (loadDashboardData calls it that way), even though
// demo mode ignores it — matching the call signature here rather than a
// zero-arg function keeps this a drop-in replacement.
export const demoDashboardDependencies = {
  getAnnualReturnDashboardMetrics: async () => demoDashboardMetrics(getAnnualReturnCases()),
  listAnnualReturnCases: async (_input: { data: Record<string, never> }) =>
    getAnnualReturnCases().map((demoCase) => toDashboardCase(demoCase)),
};
