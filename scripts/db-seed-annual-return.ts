import "dotenv/config";
import { calculateFilingDueDate } from "../src/features/annual-return/workflow";
import type {
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "../src/features/annual-return/types";
import { createSqlClient } from "../src/server/db/client";

type UserRole = "Admin" | "Manager" | "Staff";
type UploadSource = "staff" | "client" | "system";
type VerificationStatus = "pending" | "verified" | "rejected";
type ActorType = "system" | "user";

type TeamFixture = {
  id: string;
  name: string;
  managerId: string;
};

type UserFixture = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  teamId: string;
};

type CompanyFixture = {
  id: string;
  caseId: string;
  companyName: string;
  crNumber: string;
  brNumber: string;
  incorporationDate: string;
  basisDate: string;
  registeredOffice: string;
  companySecretary: string;
  ownerId: string;
  reviewerId: string;
  teamId: string;
  currentStatus: AnnualReturnStatus;
  riskLevel: RiskLevel;
  remindersSent: number;
  filingReference: string | null;
  confirmationDocumentId: string | null;
};

type DocumentFixture = {
  id: string;
  companyId: string;
  caseId: string;
  fileType: string;
  fileName: string;
  storageUrl: string;
  uploadSource: UploadSource;
  verificationStatus: VerificationStatus;
  uploadedBy: string;
  uploadedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
};

type ChecklistFixture = {
  id: string;
  caseId: string;
  itemLabel: string;
  required: boolean;
  status: ChecklistStatus;
  receivedAt: string | null;
  verifiedAt: string | null;
  documentId: string | null;
};

type PaymentFixture = {
  id: string;
  companyId: string;
  caseId: string;
  invoiceNumber: string;
  amount: number;
  status: PaymentStatus;
  dueDate: string;
  paidAt: string | null;
  paymentProofDocumentId: string | null;
};

type TimelineFixture = {
  id: string;
  companyId: string;
  caseId: string;
  eventType: string;
  actorType: ActorType;
  actorId: string | null;
  description: string;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
};

type CaseIdRow = {
  company_id: string;
  id: string;
};

type PaymentIdRow = {
  case_id: string;
  id: string;
};

type StaffProfileIdRow = {
  user_id: string;
  id: string;
};

type BusinessCalendarIdRow = {
  name: string;
  version: number;
  id: string;
};

type SlaPolicyIdRow = {
  policy_key: string;
  version: number;
  id: string;
};

const FIXTURE_UUID_PREFIXES = {
  teams: "10000000",
  users: "20000000",
  companies: "30000000",
  cases: "40000000",
  documents: "50000000",
  checklistItems: "60000000",
  payments: "70000000",
  timelineEvents: "80000000",
  staffProfiles: "90000000",
  staffSkills: "91000000",
  memberships: "92000000",
  businessCalendars: "93000000",
  calendarHolidays: "94000000",
  slaPolicies: "95000000",
  workItems: "96000000",
} as const;

type FixtureUuidPrefix = (typeof FIXTURE_UUID_PREFIXES)[keyof typeof FIXTURE_UUID_PREFIXES];

// Reserved fixture UUID ranges: each seed-owned table uses one 8-digit prefix above.
function fixtureId(group: FixtureUuidPrefix, sequence: number): string {
  return `${group}-0000-0000-0000-${String(sequence).padStart(12, "0")}`;
}

function actualCaseIdFor(caseIdsByFixtureId: Map<string, string>, fixtureCaseId: string): string {
  const actualCaseId = caseIdsByFixtureId.get(fixtureCaseId);

  if (!actualCaseId) {
    throw new Error(`Missing adopted annual return case for fixture case ${fixtureCaseId}.`);
  }

  return actualCaseId;
}

function adoptedFixtureId(
  idsByFixtureId: Map<string, string>,
  fixtureId: string,
  label: string,
): string {
  const actualId = idsByFixtureId.get(fixtureId);
  if (!actualId) {
    throw new Error(`Missing adopted ${label} for fixture ${fixtureId}.`);
  }
  return actualId;
}

const teams: TeamFixture[] = [
  {
    id: fixtureId("10000000", 1),
    name: "Annual Return Control",
    managerId: fixtureId("20000000", 2),
  },
  {
    id: fixtureId("10000000", 2),
    name: "Client Evidence Desk",
    managerId: fixtureId("20000000", 4),
  },
];

const users: UserFixture[] = [
  {
    id: fixtureId("20000000", 1),
    name: "Amy Chan",
    email: "amy.chan@kossilon.hk",
    role: "Admin",
    teamId: teams[0].id,
  },
  {
    id: fixtureId("20000000", 2),
    name: "Ken Wong",
    email: "ken.wong@kossilon.hk",
    role: "Manager",
    teamId: teams[0].id,
  },
  {
    id: fixtureId("20000000", 3),
    name: "Mei Lam",
    email: "mei.lam@kossilon.hk",
    role: "Staff",
    teamId: teams[0].id,
  },
  {
    id: fixtureId("20000000", 4),
    name: "Priya Singh",
    email: "priya.singh@kossilon.hk",
    role: "Manager",
    teamId: teams[1].id,
  },
];

const staffProfiles = users.map((user, index) => ({
  id: fixtureId("90000000", index + 1),
  userId: user.id,
  authUserId: `neon-auth-staff-${user.email}`,
  role: user.role,
  teamId: user.teamId,
  capacityPoints: user.role === "Staff" ? 80 : 100,
}));

const staffSkills = [
  {
    id: fixtureId("91000000", 1),
    staffProfileId: staffProfiles[0].id,
    skillKey: "annual-return",
    proficiency: 4,
  },
  {
    id: fixtureId("91000000", 2),
    staffProfileId: staffProfiles[1].id,
    skillKey: "annual-return-review",
    proficiency: 5,
  },
  {
    id: fixtureId("91000000", 3),
    staffProfileId: staffProfiles[2].id,
    skillKey: "annual-return",
    proficiency: 5,
  },
];

const companies: CompanyFixture[] = [
  {
    id: fixtureId("30000000", 1),
    caseId: fixtureId("40000000", 1),
    companyName: "Harbour Trading Ltd",
    crNumber: "1200001",
    brNumber: "60000001",
    incorporationDate: "2021-07-01",
    basisDate: "2026-07-01",
    registeredOffice: "Room 1201, Central Plaza, 18 Harbour Road, Wan Chai, Hong Kong",
    companySecretary: "Kossilon Corporate Services Limited",
    ownerId: users[2].id,
    reviewerId: users[1].id,
    teamId: teams[0].id,
    currentStatus: "Documents pending",
    riskLevel: "green",
    remindersSent: 1,
    filingReference: null,
    confirmationDocumentId: null,
  },
  {
    id: fixtureId("30000000", 2),
    caseId: fixtureId("40000000", 2),
    companyName: "Kowloon Textiles Ltd",
    crNumber: "1200042",
    brNumber: "60000138",
    incorporationDate: "2020-06-15",
    basisDate: "2026-06-15",
    registeredOffice: "Unit 8, 11/F, Kwun Tong Industrial Centre, Hong Kong",
    companySecretary: "Kossilon Corporate Services Limited",
    ownerId: users[0].id,
    reviewerId: users[1].id,
    teamId: teams[0].id,
    currentStatus: "Payment pending",
    riskLevel: "yellow",
    remindersSent: 2,
    filingReference: null,
    confirmationDocumentId: null,
  },
  {
    id: fixtureId("30000000", 3),
    caseId: fixtureId("40000000", 3),
    companyName: "Victoria Peak Holdings Ltd",
    crNumber: "1200083",
    brNumber: "60000275",
    incorporationDate: "2019-05-20",
    basisDate: "2026-05-20",
    registeredOffice: "18/F, Admiralty Centre, 18 Harcourt Road, Hong Kong",
    companySecretary: "Kossilon Corporate Services Limited",
    ownerId: users[3].id,
    reviewerId: users[1].id,
    teamId: teams[1].id,
    currentStatus: "Filed",
    riskLevel: "green",
    remindersSent: 2,
    filingReference: "CR-NAR1-2026-1200083",
    confirmationDocumentId: fixtureId("50000000", 340),
  },
];

const clientAuthIdentity = {
  authUserId: "neon-auth-client-harbour",
  email: "client.harbour@example.test",
};

const clientCompanyMemberships = [
  {
    id: fixtureId("92000000", 1),
    authUserId: clientAuthIdentity.authUserId,
    companyId: companies[0].id,
    invitedBy: users[0].id,
    acceptedAt: "2026-06-01T09:00:00.000Z",
  },
];

const businessCalendars = [
  {
    id: fixtureId("93000000", 1),
    name: "Hong Kong Operations",
    timezone: "Asia/Hong_Kong",
    version: 1,
    weeklySchedule: {
      monday: [
        ["09:00", "12:30"],
        ["13:30", "18:00"],
      ],
      tuesday: [
        ["09:00", "12:30"],
        ["13:30", "18:00"],
      ],
      wednesday: [
        ["09:00", "12:30"],
        ["13:30", "18:00"],
      ],
      thursday: [
        ["09:00", "12:30"],
        ["13:30", "18:00"],
      ],
      friday: [
        ["09:00", "12:30"],
        ["13:30", "18:00"],
      ],
      saturday: [],
      sunday: [],
    },
    effectiveFrom: "2026-01-01",
    createdBy: users[0].id,
  },
];

const businessCalendarHolidays = [
  {
    id: fixtureId("94000000", 1),
    businessCalendarId: businessCalendars[0].id,
    holidayDate: "2026-07-01",
    label: "Hong Kong Special Administrative Region Establishment Day",
  },
];

const slaPolicies = [
  {
    id: fixtureId("95000000", 1),
    policyKey: "annual-return-case",
    version: 1,
    name: "Annual return case response",
    workType: "annual_return_case",
    businessCalendarId: businessCalendars[0].id,
    warningMinutes: 240,
    dueMinutes: 480,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    createdBy: users[0].id,
  },
];

const workItemFixtures = companies.map((company, index) => ({
  id: fixtureId("96000000", index + 1),
  company,
  sourceEventKey: `seed:annual-return:${company.caseId}`,
  status: company.currentStatus === "Filed" ? "completed" : "open",
  priority: company.riskLevel === "yellow" ? 70 : 50,
  slaStartedAt: [
    "2026-07-02T01:00:00.000Z",
    "2026-07-03T01:00:00.000Z",
    "2026-06-28T08:00:00.000Z",
  ][index],
  slaWarningAt: [
    "2026-07-02T06:00:00.000Z",
    "2026-07-03T06:00:00.000Z",
    "2026-06-29T05:00:00.000Z",
  ][index],
  slaDueAt: ["2026-07-03T03:00:00.000Z", "2026-07-06T03:00:00.000Z", "2026-06-29T09:00:00.000Z"][
    index
  ],
}));

const checklistLabels = [
  "Signed NAR1 form",
  "Register of members (updated)",
  "Register of directors and secretaries",
  "Business registration certificate copy",
  "Proof of registered office address",
] as const;

function documentFixture(
  sequence: number,
  company: CompanyFixture,
  fileType: string,
  fileName: string,
  uploadedBy: string,
  uploadedAt: string,
  verifiedBy: string | null,
  verifiedAt: string | null,
): DocumentFixture {
  const id = fixtureId("50000000", sequence);

  return {
    id,
    companyId: company.id,
    caseId: company.caseId,
    fileType,
    fileName,
    storageUrl: `kossilon://annual-return-fixtures/${company.crNumber}/${fileName}`,
    uploadSource: "staff",
    verificationStatus: verifiedAt ? "verified" : "pending",
    uploadedBy,
    uploadedAt,
    verifiedBy,
    verifiedAt,
  };
}

const documents: DocumentFixture[] = [
  documentFixture(
    110,
    companies[0],
    "register",
    "harbour-registers-2026.pdf",
    users[2].id,
    "2026-07-02T09:00:00.000Z",
    null,
    null,
  ),
  documentFixture(
    111,
    companies[0],
    "business-registration",
    "harbour-br-copy-2026.pdf",
    users[2].id,
    "2026-07-02T09:15:00.000Z",
    users[1].id,
    "2026-07-03T10:00:00.000Z",
  ),
  ...checklistLabels.map((label, index) =>
    documentFixture(
      200 + index,
      companies[1],
      "annual-return-evidence",
      `kowloon-${index + 1}-${label.toLowerCase().replaceAll(" ", "-")}.pdf`,
      users[0].id,
      "2026-06-28T09:00:00.000Z",
      users[1].id,
      "2026-06-29T10:00:00.000Z",
    ),
  ),
  ...checklistLabels.map((label, index) =>
    documentFixture(
      300 + index,
      companies[2],
      "annual-return-evidence",
      `victoria-${index + 1}-${label.toLowerCase().replaceAll(" ", "-")}.pdf`,
      users[3].id,
      "2026-06-10T09:00:00.000Z",
      users[1].id,
      "2026-06-11T10:00:00.000Z",
    ),
  ),
  documentFixture(
    330,
    companies[2],
    "payment-proof",
    "victoria-payment-proof-2026.pdf",
    users[3].id,
    "2026-06-15T10:30:00.000Z",
    users[1].id,
    "2026-06-15T11:00:00.000Z",
  ),
  documentFixture(
    340,
    companies[2],
    "filing-confirmation",
    "victoria-nar1-filing-confirmation-2026.pdf",
    users[3].id,
    "2026-06-28T16:00:00.000Z",
    users[1].id,
    "2026-06-28T16:30:00.000Z",
  ),
];

const checklists: ChecklistFixture[] = [
  {
    id: fixtureId("60000000", 101),
    caseId: companies[0].caseId,
    itemLabel: checklistLabels[0],
    required: true,
    status: "Missing",
    receivedAt: null,
    verifiedAt: null,
    documentId: null,
  },
  {
    id: fixtureId("60000000", 102),
    caseId: companies[0].caseId,
    itemLabel: checklistLabels[1],
    required: true,
    status: "Received",
    receivedAt: "2026-07-02T09:00:00.000Z",
    verifiedAt: null,
    documentId: fixtureId("50000000", 110),
  },
  {
    id: fixtureId("60000000", 103),
    caseId: companies[0].caseId,
    itemLabel: checklistLabels[2],
    required: true,
    status: "Missing",
    receivedAt: null,
    verifiedAt: null,
    documentId: null,
  },
  {
    id: fixtureId("60000000", 104),
    caseId: companies[0].caseId,
    itemLabel: checklistLabels[3],
    required: true,
    status: "Verified",
    receivedAt: "2026-07-02T09:15:00.000Z",
    verifiedAt: "2026-07-03T10:00:00.000Z",
    documentId: fixtureId("50000000", 111),
  },
  {
    id: fixtureId("60000000", 105),
    caseId: companies[0].caseId,
    itemLabel: checklistLabels[4],
    required: true,
    status: "Missing",
    receivedAt: null,
    verifiedAt: null,
    documentId: null,
  },
  ...checklistLabels.map(
    (label, index): ChecklistFixture => ({
      id: fixtureId("60000000", 201 + index),
      caseId: companies[1].caseId,
      itemLabel: label,
      required: true,
      status: "Verified",
      receivedAt: "2026-06-28T09:00:00.000Z",
      verifiedAt: "2026-06-29T10:00:00.000Z",
      documentId: fixtureId("50000000", 200 + index),
    }),
  ),
  ...checklistLabels.map(
    (label, index): ChecklistFixture => ({
      id: fixtureId("60000000", 301 + index),
      caseId: companies[2].caseId,
      itemLabel: label,
      required: true,
      status: "Verified",
      receivedAt: "2026-06-10T09:00:00.000Z",
      verifiedAt: "2026-06-11T10:00:00.000Z",
      documentId: fixtureId("50000000", 300 + index),
    }),
  ),
];

const payments: PaymentFixture[] = [
  {
    id: fixtureId("70000000", 1),
    companyId: companies[0].id,
    caseId: companies[0].caseId,
    invoiceNumber: "KOS-AR-2026-1200001",
    amount: 3800,
    status: "Payment pending",
    dueDate: "2026-08-05",
    paidAt: null,
    paymentProofDocumentId: null,
  },
  {
    id: fixtureId("70000000", 2),
    companyId: companies[1].id,
    caseId: companies[1].caseId,
    invoiceNumber: "KOS-AR-2026-1200042",
    amount: 4200,
    status: "Payment pending",
    dueDate: "2026-07-20",
    paidAt: null,
    paymentProofDocumentId: null,
  },
  {
    id: fixtureId("70000000", 3),
    companyId: companies[2].id,
    caseId: companies[2].caseId,
    invoiceNumber: "KOS-AR-2026-1200083",
    amount: 5200,
    status: "Payment received",
    dueDate: "2026-06-24",
    paidAt: "2026-06-15T10:30:00.000Z",
    paymentProofDocumentId: fixtureId("50000000", 330),
  },
];

const timelineEvents: TimelineFixture[] = [
  {
    id: fixtureId("80000000", 101),
    companyId: companies[0].id,
    caseId: companies[0].caseId,
    eventType: "case_generated",
    actorType: "system",
    actorId: null,
    description: "Annual return case opened 90 days before the filing deadline.",
    metadata: { returnYear: 2026, status: companies[0].currentStatus },
    createdAt: "2026-05-14T00:00:00.000Z",
  },
  {
    id: fixtureId("80000000", 102),
    companyId: companies[0].id,
    caseId: companies[0].caseId,
    eventType: "client_reminder_logged",
    actorType: "user",
    actorId: users[2].id,
    description: "Manual WhatsApp reminder logged for outstanding NAR1 evidence.",
    metadata: { channel: "WhatsApp", remindersSent: 1 },
    createdAt: "2026-06-20T09:30:00.000Z",
  },
  {
    id: fixtureId("80000000", 103),
    companyId: companies[0].id,
    caseId: companies[0].caseId,
    eventType: "documents_received",
    actorType: "user",
    actorId: users[2].id,
    description: "Client supplied registers and business registration copy.",
    metadata: { receivedDocuments: 2 },
    createdAt: "2026-07-02T09:20:00.000Z",
  },
  {
    id: fixtureId("80000000", 201),
    companyId: companies[1].id,
    caseId: companies[1].caseId,
    eventType: "case_generated",
    actorType: "system",
    actorId: null,
    description: "Annual return case opened 90 days before the filing deadline.",
    metadata: { returnYear: 2026, status: companies[1].currentStatus },
    createdAt: "2026-04-28T00:00:00.000Z",
  },
  {
    id: fixtureId("80000000", 202),
    companyId: companies[1].id,
    caseId: companies[1].caseId,
    eventType: "documents_verified",
    actorType: "user",
    actorId: users[1].id,
    description: "All required annual return documents verified by reviewer.",
    metadata: { verifiedDocuments: checklistLabels.length },
    createdAt: "2026-06-29T10:15:00.000Z",
  },
  {
    id: fixtureId("80000000", 203),
    companyId: companies[1].id,
    caseId: companies[1].caseId,
    eventType: "invoice_issued",
    actorType: "user",
    actorId: users[0].id,
    description: "Annual return invoice issued and awaiting settlement.",
    metadata: { invoiceNumber: payments[1].invoiceNumber, amount: payments[1].amount },
    createdAt: "2026-07-01T11:00:00.000Z",
  },
  {
    id: fixtureId("80000000", 301),
    companyId: companies[2].id,
    caseId: companies[2].caseId,
    eventType: "case_generated",
    actorType: "system",
    actorId: null,
    description: "Annual return case opened 90 days before the filing deadline.",
    metadata: { returnYear: 2026, status: companies[2].currentStatus },
    createdAt: "2026-04-02T00:00:00.000Z",
  },
  {
    id: fixtureId("80000000", 302),
    companyId: companies[2].id,
    caseId: companies[2].caseId,
    eventType: "payment_received",
    actorType: "user",
    actorId: users[3].id,
    description: "Annual return filing fee received and proof uploaded.",
    metadata: { invoiceNumber: payments[2].invoiceNumber, amount: payments[2].amount },
    createdAt: "2026-06-15T10:45:00.000Z",
  },
  {
    id: fixtureId("80000000", 303),
    companyId: companies[2].id,
    caseId: companies[2].caseId,
    eventType: "nar1_filed",
    actorType: "user",
    actorId: users[3].id,
    description: "NAR1 filed with Companies Registry and confirmation attached.",
    metadata: { filingReference: "CR-NAR1-2026-1200083" },
    createdAt: "2026-06-28T16:35:00.000Z",
  },
];

const sql = createSqlClient(undefined, { max: 1 });

try {
  await sql.begin(async (tx) => {
    await tx`
      insert into teams ${tx(
        teams.map((team) => ({
          id: team.id,
          name: team.name,
          active: true,
        })),
        "id",
        "name",
        "active",
      )}
      on conflict (id) do update set
        name = excluded.name,
        active = excluded.active,
        updated_at = now()
    `;

    await tx`
      insert into users ${tx(
        users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          team_id: user.teamId,
          active: true,
        })),
        "id",
        "name",
        "email",
        "role",
        "team_id",
        "active",
      )}
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        role = excluded.role,
        team_id = excluded.team_id,
        active = excluded.active,
        updated_at = now()
    `;

    for (const team of teams) {
      await tx`
        update teams
        set manager_id = ${team.managerId}, updated_at = now()
        where id = ${team.id}
      `;
    }

    await tx`
      insert into companies ${tx(
        companies.map((company) => ({
          id: company.id,
          company_name: company.companyName,
          cr_number: company.crNumber,
          br_number: company.brNumber,
          incorporation_date: company.incorporationDate,
          annual_return_basis_date: company.basisDate,
          registered_office: company.registeredOffice,
          company_secretary: company.companySecretary,
          status: "active",
          assigned_owner_id: company.ownerId,
          assigned_team_id: company.teamId,
        })),
        "id",
        "company_name",
        "cr_number",
        "br_number",
        "incorporation_date",
        "annual_return_basis_date",
        "registered_office",
        "company_secretary",
        "status",
        "assigned_owner_id",
        "assigned_team_id",
      )}
      on conflict (id) do update set
        company_name = excluded.company_name,
        cr_number = excluded.cr_number,
        br_number = excluded.br_number,
        incorporation_date = excluded.incorporation_date,
        annual_return_basis_date = excluded.annual_return_basis_date,
        registered_office = excluded.registered_office,
        company_secretary = excluded.company_secretary,
        status = excluded.status,
        assigned_owner_id = excluded.assigned_owner_id,
        assigned_team_id = excluded.assigned_team_id,
        updated_at = now()
    `;

    const caseRows = (await tx`
      insert into annual_return_cases ${tx(
        companies.map((company) => ({
          id: company.caseId,
          company_id: company.id,
          return_year: 2026,
          made_up_date: company.basisDate,
          filing_due_date: calculateFilingDueDate(company.basisDate),
          current_status: company.currentStatus,
          risk_level: company.riskLevel,
          owner_id: company.ownerId,
          reviewer_id: company.reviewerId,
          reminders_sent: company.remindersSent,
          filing_reference: company.filingReference,
          confirmation_document_id: null,
        })),
        "id",
        "company_id",
        "return_year",
        "made_up_date",
        "filing_due_date",
        "current_status",
        "risk_level",
        "owner_id",
        "reviewer_id",
        "reminders_sent",
        "filing_reference",
        "confirmation_document_id",
      )}
      on conflict (company_id, return_year) do update set
        made_up_date = excluded.made_up_date,
        filing_due_date = excluded.filing_due_date,
        risk_level = excluded.risk_level,
        owner_id = excluded.owner_id,
        reviewer_id = excluded.reviewer_id,
        updated_at = now()
      returning company_id, id
    `) as CaseIdRow[];

    const caseIdsByFixtureId = new Map<string, string>();

    for (const company of companies) {
      const caseRow = caseRows.find((row) => row.company_id === company.id);

      if (!caseRow) {
        throw new Error(`Missing annual return case for fixture company ${company.id}.`);
      }

      caseIdsByFixtureId.set(company.caseId, caseRow.id);
    }

    const staffProfileRows = (await tx`
      insert into staff_profiles ${tx(
        staffProfiles.map((profile) => ({
          id: profile.id,
          user_id: profile.userId,
          auth_user_id: profile.authUserId,
          role: profile.role,
          team_id: profile.teamId,
          capacity_points: profile.capacityPoints,
          active: true,
        })),
        "id",
        "user_id",
        "auth_user_id",
        "role",
        "team_id",
        "capacity_points",
        "active",
      )}
      on conflict (user_id) do update set
        auth_user_id = excluded.auth_user_id,
        role = excluded.role,
        team_id = excluded.team_id,
        capacity_points = excluded.capacity_points,
        active = excluded.active,
        updated_at = now()
      returning user_id, id
    `) as StaffProfileIdRow[];

    const staffProfileIdsByFixtureId = new Map<string, string>();
    for (const profile of staffProfiles) {
      const row = staffProfileRows.find((candidate) => candidate.user_id === profile.userId);
      if (!row) {
        throw new Error(`Missing adopted staff profile for fixture user ${profile.userId}.`);
      }
      staffProfileIdsByFixtureId.set(profile.id, row.id);
    }

    await tx`
      insert into staff_skills ${tx(
        staffSkills.map((skill) => ({
          id: skill.id,
          staff_profile_id: adoptedFixtureId(
            staffProfileIdsByFixtureId,
            skill.staffProfileId,
            "staff profile",
          ),
          skill_key: skill.skillKey,
          proficiency: skill.proficiency,
          active: true,
        })),
        "id",
        "staff_profile_id",
        "skill_key",
        "proficiency",
        "active",
      )}
      on conflict (staff_profile_id, skill_key) do update set
        proficiency = excluded.proficiency,
        active = excluded.active,
        updated_at = now()
    `;

    await tx`
      insert into client_company_memberships ${tx(
        clientCompanyMemberships.map((membership) => ({
          id: membership.id,
          auth_user_id: membership.authUserId,
          company_id: membership.companyId,
          role: "Client",
          active: true,
          invited_by: membership.invitedBy,
          invited_at: "2026-05-30T09:00:00.000Z",
          accepted_at: membership.acceptedAt,
        })),
        "id",
        "auth_user_id",
        "company_id",
        "role",
        "active",
        "invited_by",
        "invited_at",
        "accepted_at",
      )}
      on conflict (auth_user_id, company_id) do update set
        role = excluded.role,
        active = excluded.active,
        invited_by = excluded.invited_by,
        accepted_at = coalesce(client_company_memberships.accepted_at, excluded.accepted_at),
        updated_at = now()
    `;

    const businessCalendarRows = (await tx`
      insert into business_calendars ${tx(
        businessCalendars.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          timezone: calendar.timezone,
          version: calendar.version,
          weekly_schedule: tx.json(calendar.weeklySchedule),
          effective_from: calendar.effectiveFrom,
          active: true,
          created_by: calendar.createdBy,
        })),
        "id",
        "name",
        "timezone",
        "version",
        "weekly_schedule",
        "effective_from",
        "active",
        "created_by",
      )}
      on conflict (name, version) do update set
        timezone = excluded.timezone,
        weekly_schedule = excluded.weekly_schedule,
        effective_from = excluded.effective_from,
        active = excluded.active,
        updated_at = now()
      returning name, version, id
    `) as BusinessCalendarIdRow[];

    const businessCalendarIdsByFixtureId = new Map<string, string>();
    for (const calendar of businessCalendars) {
      const row = businessCalendarRows.find(
        (candidate) => candidate.name === calendar.name && candidate.version === calendar.version,
      );
      if (!row) {
        throw new Error(`Missing adopted business calendar ${calendar.name} v${calendar.version}.`);
      }
      businessCalendarIdsByFixtureId.set(calendar.id, row.id);
    }

    await tx`
      insert into business_calendar_holidays ${tx(
        businessCalendarHolidays.map((holiday) => ({
          id: holiday.id,
          business_calendar_id: adoptedFixtureId(
            businessCalendarIdsByFixtureId,
            holiday.businessCalendarId,
            "business calendar",
          ),
          holiday_date: holiday.holidayDate,
          label: holiday.label,
          closed: true,
          working_intervals: null,
        })),
        "id",
        "business_calendar_id",
        "holiday_date",
        "label",
        "closed",
        "working_intervals",
      )}
      on conflict (business_calendar_id, holiday_date) do update set
        label = excluded.label,
        closed = excluded.closed,
        working_intervals = excluded.working_intervals
    `;

    const slaPolicyRows = (await tx`
      insert into sla_policies ${tx(
        slaPolicies.map((policy) => ({
          id: policy.id,
          policy_key: policy.policyKey,
          version: policy.version,
          name: policy.name,
          work_type: policy.workType,
          business_calendar_id: adoptedFixtureId(
            businessCalendarIdsByFixtureId,
            policy.businessCalendarId,
            "business calendar",
          ),
          warning_minutes: policy.warningMinutes,
          due_minutes: policy.dueMinutes,
          effective_from: policy.effectiveFrom,
          active: true,
          created_by: policy.createdBy,
        })),
        "id",
        "policy_key",
        "version",
        "name",
        "work_type",
        "business_calendar_id",
        "warning_minutes",
        "due_minutes",
        "effective_from",
        "active",
        "created_by",
      )}
      on conflict (policy_key, version) do update set
        name = excluded.name,
        work_type = excluded.work_type,
        business_calendar_id = excluded.business_calendar_id,
        warning_minutes = excluded.warning_minutes,
        due_minutes = excluded.due_minutes,
        effective_from = excluded.effective_from,
        active = excluded.active,
        updated_at = now()
      returning policy_key, version, id
    `) as SlaPolicyIdRow[];

    const slaPolicyIdsByFixtureId = new Map<string, string>();
    for (const policy of slaPolicies) {
      const row = slaPolicyRows.find(
        (candidate) =>
          candidate.policy_key === policy.policyKey && candidate.version === policy.version,
      );
      if (!row) {
        throw new Error(`Missing adopted SLA policy ${policy.policyKey} v${policy.version}.`);
      }
      slaPolicyIdsByFixtureId.set(policy.id, row.id);
    }

    await tx`
      insert into work_items ${tx(
        workItemFixtures.map((item) => ({
          id: item.id,
          company_id: item.company.id,
          case_id: actualCaseIdFor(caseIdsByFixtureId, item.company.caseId),
          source_event_key: item.sourceEventKey,
          source_event_type: "annual_return_case_seeded",
          work_type: "annual_return_case",
          title: `Annual return 2026 - ${item.company.companyName}`,
          status: item.status,
          priority: item.priority,
          owner_id: item.company.ownerId,
          reviewer_id: item.company.reviewerId,
          team_id: item.company.teamId,
          sla_policy_version_id: adoptedFixtureId(
            slaPolicyIdsByFixtureId,
            slaPolicies[0].id,
            "SLA policy",
          ),
          sla_started_at: item.slaStartedAt,
          sla_warning_at: item.slaWarningAt,
          sla_due_at: item.slaDueAt,
          sla_breached_at: null,
          version: 1,
          completed_at: item.status === "completed" ? "2026-06-28T16:35:00.000Z" : null,
        })),
        "id",
        "company_id",
        "case_id",
        "source_event_key",
        "source_event_type",
        "work_type",
        "title",
        "status",
        "priority",
        "owner_id",
        "reviewer_id",
        "team_id",
        "sla_policy_version_id",
        "sla_started_at",
        "sla_warning_at",
        "sla_due_at",
        "sla_breached_at",
        "version",
        "completed_at",
      )}
      on conflict (source_event_key) do update set
        company_id = excluded.company_id,
        case_id = excluded.case_id,
        source_event_type = excluded.source_event_type,
        work_type = excluded.work_type,
        title = excluded.title,
        priority = excluded.priority,
        team_id = excluded.team_id,
        sla_policy_version_id = excluded.sla_policy_version_id,
        updated_at = now()
    `;

    await tx`
      insert into documents ${tx(
        documents.map((document) => ({
          id: document.id,
          company_id: document.companyId,
          case_id: actualCaseIdFor(caseIdsByFixtureId, document.caseId),
          file_type: document.fileType,
          file_name: document.fileName,
          storage_url: document.storageUrl,
          upload_source: document.uploadSource,
          verification_status: document.verificationStatus,
          uploaded_by: document.uploadedBy,
          uploaded_at: document.uploadedAt,
          verified_by: document.verifiedBy,
          verified_at: document.verifiedAt,
        })),
        "id",
        "company_id",
        "case_id",
        "file_type",
        "file_name",
        "storage_url",
        "upload_source",
        "verification_status",
        "uploaded_by",
        "uploaded_at",
        "verified_by",
        "verified_at",
      )}
      on conflict (id) do update set
        company_id = excluded.company_id,
        case_id = excluded.case_id,
        file_type = excluded.file_type,
        file_name = excluded.file_name,
        storage_url = excluded.storage_url,
        upload_source = excluded.upload_source,
        verification_status = excluded.verification_status,
        uploaded_by = excluded.uploaded_by,
        uploaded_at = excluded.uploaded_at,
        verified_by = excluded.verified_by,
        verified_at = excluded.verified_at
    `;

    const checklistRows = checklists.map((item) => {
      const company = companies.find((candidate) => candidate.caseId === item.caseId);

      if (!company) {
        throw new Error(`Missing company fixture for checklist item ${item.id}.`);
      }

      return {
        id: item.id,
        case_id: actualCaseIdFor(caseIdsByFixtureId, item.caseId),
        item_label: item.itemLabel,
        required: item.required,
        status: item.status,
        due_date: calculateFilingDueDate(company.basisDate),
        received_at: item.receivedAt,
        verified_at: item.verifiedAt,
        document_id: item.documentId,
      };
    });

    await tx`
      insert into annual_return_checklist_items ${tx(
        checklistRows,
        "id",
        "case_id",
        "item_label",
        "required",
        "status",
        "due_date",
        "received_at",
        "verified_at",
        "document_id",
      )}
      on conflict (id) do update set
        case_id = excluded.case_id,
        item_label = excluded.item_label,
        required = excluded.required,
        due_date = excluded.due_date,
        updated_at = now()
    `;

    const paymentRows = (await tx`
      insert into payments ${tx(
        payments.map((payment) => ({
          id: payment.id,
          company_id: payment.companyId,
          case_id: actualCaseIdFor(caseIdsByFixtureId, payment.caseId),
          invoice_number: payment.invoiceNumber,
          amount: payment.amount,
          currency: "HKD",
          status: payment.status,
          due_date: payment.dueDate,
          paid_at: payment.paidAt,
          payment_proof_document_id: payment.paymentProofDocumentId,
        })),
        "id",
        "company_id",
        "case_id",
        "invoice_number",
        "amount",
        "currency",
        "status",
        "due_date",
        "paid_at",
        "payment_proof_document_id",
      )}
      on conflict (case_id) do update set
        company_id = excluded.company_id,
        invoice_number = excluded.invoice_number,
        amount = excluded.amount,
        currency = excluded.currency,
        due_date = excluded.due_date,
        updated_at = now()
      returning case_id, id
    `) as PaymentIdRow[];

    if (paymentRows.length !== payments.length) {
      throw new Error("Missing adopted annual return payments for fixture cases.");
    }

    for (const company of companies) {
      await tx`
        update annual_return_cases
        set confirmation_document_id = coalesce(
              annual_return_cases.confirmation_document_id,
              ${company.confirmationDocumentId}
            ),
            updated_at = now()
        where id = ${actualCaseIdFor(caseIdsByFixtureId, company.caseId)}
      `;
    }

    for (const event of timelineEvents) {
      await tx`
        insert into timeline_events (
          id,
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata,
          created_at
        )
        values (
          ${event.id},
          ${event.companyId},
          ${actualCaseIdFor(caseIdsByFixtureId, event.caseId)},
          ${event.eventType},
          ${event.actorType},
          ${event.actorId},
          ${event.description},
          ${tx.json(event.metadata)},
          ${event.createdAt}
        )
        on conflict (id) do update set
          company_id = excluded.company_id,
          case_id = excluded.case_id,
          event_type = excluded.event_type,
          actor_type = excluded.actor_type,
          actor_id = excluded.actor_id,
          description = excluded.description,
          metadata = excluded.metadata,
          created_at = excluded.created_at
      `;
    }
  });

  console.log(`Seeded ${companies.length} companies and annual return cases.`);
} finally {
  await sql.end();
}
