export const ANNUAL_RETURN_STATUSES = [
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
] as const;

export type AnnualReturnStatus = (typeof ANNUAL_RETURN_STATUSES)[number];

export type RiskLevel = "green" | "yellow" | "orange" | "red";

export type PaymentStatus = "Not invoiced" | "Payment pending" | "Payment received" | "Overdue";

export type ChecklistStatus = "Missing" | "Received" | "Verified" | "Rejected";

export type AnnualReturnCompany = {
  id: string;
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  status: "active" | "inactive";
  assignedOwnerId: string;
  assignedTeamId: string;
};

export type AnnualReturnChecklistItem = {
  id: string;
  caseId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistStatus;
  dueDate: string;
  receivedAt: string | null;
  verifiedAt: string | null;
  documentId: string | null;
};

export type AnnualReturnPayment = {
  id: string;
  caseId: string;
  invoiceNumber: string;
  amount: number;
  currency: "HKD";
  status: PaymentStatus;
  dueDate: string;
  paidAt: string | null;
  paymentProofDocumentId: string | null;
};

export type AnnualReturnCase = {
  id: string;
  companyId: string;
  companyName: string;
  returnYear: number;
  madeUpDate: string;
  filingDueDate: string;
  currentStatus: AnnualReturnStatus;
  riskLevel: RiskLevel;
  ownerId: string;
  ownerName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  remindersSent: number;
  filingReference: string | null;
  confirmationDocumentId: string | null;
  lockedAt: string | null;
  completedAt: string | null;
  checklist: AnnualReturnChecklistItem[];
  payment: AnnualReturnPayment | null;
};

export type CompletionBlocker = {
  code:
    | "required_checklist_unverified"
    | "payment_not_received"
    | "payment_proof_missing"
    | "filing_reference_missing"
    | "confirmation_document_missing";
  message: string;
};
