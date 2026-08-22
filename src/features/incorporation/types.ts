export const INCORPORATION_STATUSES = [
  "Intake",
  "Documents pending",
  "Ready to file",
  "Filed with Registrar",
  "Completed",
] as const;

export type IncorporationStatus = (typeof INCORPORATION_STATUSES)[number];

export type ChecklistItemStatus = "Missing" | "Received" | "Verified" | "Rejected";

export type IncorporationChecklistItem = {
  id: string;
  caseId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  receivedAt: string | null;
  verifiedAt: string | null;
};

export type IncorporationCase = {
  id: string;
  proposedCompanyNameEn: string;
  proposedCompanyNameZh: string | null;
  proposedRegisteredOffice: string;
  proposedCompanySecretary: string;
  registeredCapital: number;
  businessNature: string;
  status: IncorporationStatus;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  targetCompletionDate: string;
  companyId: string | null;
  completedAt: string | null;
  createdAt: string;
  checklist: IncorporationChecklistItem[];
};

export type IncorporationCaseSummary = Omit<IncorporationCase, "checklist">;

export type CreateIncorporationCaseInput = {
  proposedCompanyNameEn: string;
  proposedCompanyNameZh: string | null;
  proposedRegisteredOffice: string;
  proposedCompanySecretary: string;
  registeredCapital: number;
  businessNature: string;
  ownerId: string;
  teamId: string;
  targetCompletionDate: string;
  actorId: string;
};

export type UpdateChecklistItemInput = {
  caseId: string;
  itemId: string;
  status: ChecklistItemStatus;
  note: string | null;
  actorId: string;
};

export type UpdateCaseStatusInput = {
  caseId: string;
  status: IncorporationStatus;
  actorId: string;
};

export type CompleteIncorporationCaseInput = {
  caseId: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  actorId: string;
};
