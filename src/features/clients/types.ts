import type { PaymentStatus } from "@/features/annual-return/types";

export type CompanyStatus = "active" | "inactive";

export type ServicePackage = {
  id: string;
  name: string;
  defaultFee: number;
  currency: "HKD";
  active: boolean;
  sortOrder: number;
};

export type CompanyContact = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type OfficerType = "director" | "secretary" | "designated_representative";

export type ControlBasis =
  | "shares_over_25pct"
  | "votes_over_25pct"
  | "board_appointment_right"
  | "significant_influence";
export type IdentificationType = "hkid" | "passport" | "br_number";

export type Officer = {
  id: string;
  companyId: string;
  officerType: OfficerType;
  name: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  appointmentDate: string;
  cessationDate: string | null;
};

export type Shareholding = {
  id: string;
  companyId: string;
  shareholderName: string;
  shareholderAddress: string | null;
  shareClass: string;
  numberOfShares: number;
  allotmentDate: string;
  cessationDate: string | null;
};

export type SignificantController = {
  id: string;
  companyId: string;
  controllerName: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  controlBases: ControlBasis[];
  registeredDate: string;
  cessationDate: string | null;
  registerUpdateDueDate: string | null;
};

export type InspectionRequest = {
  id: string;
  companyId: string;
  requesterName: string;
  requesterAuthority: string;
  requestDate: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
};

/** Latest annual-return payment status. Re-exported from the annual-return module so the
 *  payments.status check constraint has exactly one TypeScript definition. */
export type ClientPaymentStatus = PaymentStatus;

export type ClientSummary = {
  id: string;
  companyName: string;
  crNumber: string;
  brNumber: string;
  status: CompanyStatus;
  packageId: string | null;
  packageName: string | null;
  ownerId: string;
  ownerName: string;
  ownerInitials: string;
  teamId: string;
  teamName: string;
  /** Filing due date of the most recent annual-return case, or null when none exists. */
  arDueDate: string | null;
  paymentStatus: ClientPaymentStatus | null;
  invoiceAmount: number | null;
};

export type ClientTimelineEntry = {
  id: string;
  eventType: string;
  actorType: "system" | "user";
  actorName: string | null;
  description: string;
  createdAt: string;
};

export type ClientAnnualReturnEntry = {
  id: string;
  returnYear: number;
  madeUpDate: string;
  filingDueDate: string;
  currentStatus: string;
};

export type ClientDocument = {
  id: string;
  fileName: string;
  fileType: string;
  verificationStatus: "pending" | "verified" | "rejected";
  uploadedAt: string;
};

export type ClientDetail = ClientSummary & {
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  contacts: CompanyContact[];
  officers: Officer[];
  shareholdings: Shareholding[];
  significantControllers: SignificantController[];
  inspectionRequests: InspectionRequest[];
  timeline: ClientTimelineEntry[];
  annualReturnHistory: ClientAnnualReturnEntry[];
  documents: ClientDocument[];
};

/** Owner, team, and package choices for the create and edit forms. */
export type ClientAssignmentOptions = {
  owners: { id: string; name: string; teamId: string | null }[];
  teams: { id: string; name: string }[];
  packages: ServicePackage[];
};

export type ClientContactInput = {
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type CreateClientInput = {
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  annualReturnBasisDate: string;
  registeredOffice: string;
  companySecretary: string;
  ownerId: string;
  teamId: string;
  packageId: string | null;
  contacts: ClientContactInput[];
  actorId: string;
};

export type UpdateClientInput = {
  id: string;
  companyName: string;
  registeredOffice: string;
  status: CompanyStatus;
  ownerId: string;
  teamId: string;
  packageId: string | null;
  actorId: string;
};

export type AddContactInput = ClientContactInput & {
  companyId: string;
  actorId: string;
};

export type UpdateContactInput = ClientContactInput & {
  companyId: string;
  contactId: string;
  actorId: string;
};

export type RemoveContactInput = {
  companyId: string;
  contactId: string;
  actorId: string;
};

export type AppointOfficerInput = {
  companyId: string;
  officerType: OfficerType;
  name: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  appointmentDate: string;
  actorId: string;
};

export type CeaseOfficerInput = {
  companyId: string;
  officerId: string;
  cessationDate: string;
  actorId: string;
};

export type RecordShareholdingInput = {
  companyId: string;
  shareholderName: string;
  shareholderAddress: string | null;
  shareClass: string;
  numberOfShares: number;
  allotmentDate: string;
  actorId: string;
};

export type CeaseShareholdingInput = {
  companyId: string;
  shareholdingId: string;
  cessationDate: string;
  actorId: string;
};

export type RecordControllerInput = {
  companyId: string;
  controllerName: string;
  identificationType: IdentificationType | null;
  identificationNumber: string | null;
  address: string | null;
  controlBases: ControlBasis[];
  registeredDate: string;
  registerUpdateDueDate: string | null;
  actorId: string;
};

export type UpdateControllerParticularsInput = {
  companyId: string;
  controllerId: string;
  address: string | null;
  controlBases: ControlBasis[];
  registerUpdateDueDate: string | null;
  actorId: string;
};

export type CeaseControllerInput = {
  companyId: string;
  controllerId: string;
  cessationDate: string;
  actorId: string;
};

export type RecordInspectionRequestInput = {
  companyId: string;
  requesterName: string;
  requesterAuthority: string;
  requestDate: string;
  actorId: string;
};

export type ResolveInspectionRequestInput = {
  companyId: string;
  inspectionRequestId: string;
  resolutionNote: string;
  actorId: string;
};
