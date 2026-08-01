import type { RiskLevel } from "@/features/annual-return/types";
import type { DashboardCase } from "@/features/dashboard/types";
import type {
  AnnualReturnCase as DemoAnnualReturnCase,
  AnnualReturnRiskLevel as DemoRiskLevel,
  AnnualReturnStatus as DemoStatus,
} from "@/lib/annual-return-store";
import { getRiskLevel } from "@/lib/annual-return-store";

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
