export const CORPORATE_CHANGE_TYPES = [
  "name_change",
  "share_transfer",
  "officer_change",
  "address_change",
] as const;

export type CorporateChangeType = (typeof CORPORATE_CHANGE_TYPES)[number];

export const CORPORATE_CHANGE_STATUSES = [
  "Requested",
  "Documents pending",
  "Ready to file",
  "Filed with Registrar",
  "Completed",
  "Cancelled",
] as const;

export type CorporateChangeStatus = (typeof CORPORATE_CHANGE_STATUSES)[number];

export type ChecklistItemStatus = "Missing" | "Received" | "Verified" | "Rejected";

export type CorporateChangeChecklistItem = {
  id: string;
  requestId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistItemStatus;
  note: string | null;
  receivedAt: string | null;
  verifiedAt: string | null;
};

export type IdentificationType = "hkid" | "passport" | "br_number";
export type OfficerAction = "appoint" | "resign" | "detail_change";
export type NewOfficerType = "director" | "secretary";

export type CorporateChangeRequest = {
  id: string;
  companyId: string;
  changeType: CorporateChangeType;
  status: CorporateChangeStatus;
  ownerId: string;
  quotedFee: number;

  currentNameEn: string | null;
  currentNameZh: string | null;
  newNameEn: string | null;
  newNameZh: string | null;

  transferorShareholdingId: string | null;
  transfereeShareholdingId: string | null;
  transfereeNewShareholderName: string | null;
  transfereeNewShareholderAddress: string | null;
  sharesTransferred: number | null;
  consideration: number | null;
  stampDutyAmount: number | null;

  officerId: string | null;
  officerAction: OfficerAction | null;
  newOfficerType: NewOfficerType | null;
  newOfficerName: string | null;
  newOfficerIdentificationType: IdentificationType | null;
  newOfficerIdentificationNumber: string | null;
  newOfficerAddress: string | null;
  effectiveDate: string | null;

  currentRegisteredOffice: string | null;
  newRegisteredOffice: string | null;

  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CorporateChangeRequestDetail = CorporateChangeRequest & {
  checklistItems: CorporateChangeChecklistItem[];
};

export type CorporateChangeRequestSummary = Pick<
  CorporateChangeRequest,
  "id" | "companyId" | "changeType" | "status" | "ownerId" | "quotedFee" | "createdAt"
> & {
  companyName: string;
};

export type CreateNameChangeInput = {
  companyId: string;
  quotedFee: number;
  newNameEn: string;
  newNameZh: string | null;
  actorId: string;
};

export type CreateShareTransferInput = {
  companyId: string;
  quotedFee: number;
  transferorShareholdingId: string;
  sharesTransferred: number;
  consideration: number;
  stampDutyAmount: number;
  transfereeShareholdingId: string | null;
  transfereeNewShareholderName: string | null;
  transfereeNewShareholderAddress: string | null;
  actorId: string;
};

export type CreateOfficerChangeInput = {
  companyId: string;
  quotedFee: number;
  officerAction: OfficerAction;
  officerId: string | null;
  newOfficerType: NewOfficerType | null;
  newOfficerName: string | null;
  newOfficerIdentificationType: IdentificationType | null;
  newOfficerIdentificationNumber: string | null;
  newOfficerAddress: string | null;
  effectiveDate: string;
  actorId: string;
};

export type CreateAddressChangeInput = {
  companyId: string;
  quotedFee: number;
  newRegisteredOffice: string;
  actorId: string;
};

export type CreateCorporateChangeRequestInput =
  | ({ changeType: "name_change" } & CreateNameChangeInput)
  | ({ changeType: "share_transfer" } & CreateShareTransferInput)
  | ({ changeType: "officer_change" } & CreateOfficerChangeInput)
  | ({ changeType: "address_change" } & CreateAddressChangeInput);

export type UpdateChecklistItemStatusInput = {
  requestId: string;
  itemId: string;
  status: ChecklistItemStatus;
  note: string | null;
  actorId: string;
};

export type TransitionStatusInput = {
  requestId: string;
  toStatus: CorporateChangeStatus;
  actorId: string;
};

export type CancelRequestInput = {
  requestId: string;
  actorId: string;
};

export type CompleteRequestInput = {
  requestId: string;
  actorId: string;
};

export type ListCorporateChangeRequestsFilter = {
  changeType?: CorporateChangeType;
  status?: CorporateChangeStatus;
  teamId?: string;
};
