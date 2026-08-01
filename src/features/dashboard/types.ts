import type {
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "@/features/annual-return/types";

// The fields the dashboard actually renders, in the production vocabulary.
//
// This exists because the production and demo case types are irreconcilable:
// production statuses are "Upcoming" / "Documents pending" / ..., the demo
// store uses "preparing" / "waiting-documents" / .... Neither type can satisfy
// the other, but both can produce this one.
//
// The nested shapes are deliberately narrower than production's. The dashboard
// only asks the checklist whether required evidence is verified, and only asks
// the payment whether it was received, so carrying invoice numbers and
// document ids here would mean fabricating them on the demo side for nothing.
export type DashboardCase = {
  id: string;
  companyName: string;
  currentStatus: AnnualReturnStatus;
  filingDueDate: string;
  ownerName: string;
  riskLevel: RiskLevel;
  checklist: Array<{ required: boolean; status: ChecklistStatus }>;
  payment: { status: PaymentStatus } | null;
  filingReference: string | null;
  confirmationDocumentId: string | null;
};
