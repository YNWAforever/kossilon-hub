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

/** Latest annual-return payment status, mirroring the payments.status check constraint. */
export type ClientPaymentStatus =
  | "Not invoiced"
  | "Payment pending"
  | "Payment received"
  | "Overdue";

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
  companySecretary: string;
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
