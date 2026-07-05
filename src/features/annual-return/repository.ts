import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { daysBetween, riskForCase } from "./workflow";
import type {
  AnnualReturnCase,
  AnnualReturnChecklistItem,
  AnnualReturnPayment,
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "./types";

type CaseRow = {
  id: string;
  company_id: string;
  company_name: string;
  return_year: number;
  made_up_date: string | Date;
  filing_due_date: string | Date;
  current_status: AnnualReturnStatus;
  risk_level: RiskLevel;
  owner_id: string;
  owner_name: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reminders_sent: number;
  filing_reference: string | null;
  confirmation_document_id: string | null;
  locked_at: string | Date | null;
  completed_at: string | Date | null;
};

type ChecklistRow = {
  id: string;
  case_id: string;
  item_label: string;
  required: boolean;
  status: ChecklistStatus;
  due_date: string | Date;
  received_at: string | Date | null;
  verified_at: string | Date | null;
  document_id: string | null;
};

type PaymentRow = {
  id: string;
  case_id: string;
  invoice_number: string;
  amount: number;
  currency: "HKD";
  status: PaymentStatus;
  due_date: string | Date;
  paid_at: string | Date | null;
  payment_proof_document_id: string | null;
};

export type CaseFilters = {
  ownerId?: string;
  teamId?: string;
  reviewerId?: string;
  risk?: RiskLevel;
  status?: AnnualReturnStatus;
  missingDocuments?: boolean;
  paymentStatus?: PaymentStatus;
  overdueOnly?: boolean;
};

export type AnnualReturnDashboardMetrics = {
  dueIn7: number;
  dueIn30: number;
  overdue: number;
  highRisk: number;
  missingDocuments: number;
  paymentPending: number;
  assignedToMe: number;
};

export type CreateAnnualReturnRepositoryOptions = CreateSqlClientOptions & {
  sql?: SqlClient;
  today?: string | (() => string);
};

export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  dashboardMetrics(today: string, currentUserId: string): Promise<AnnualReturnDashboardMetrics>;
  close(): Promise<void>;
};

const FILED_OR_COMPLETED_STATUSES = new Set<AnnualReturnStatus>(["Filed", "Completed"]);

function systemToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function timestampString(value: string | Date | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function hasMissingRequiredDocument(item: AnnualReturnChecklistItem): boolean {
  return (
    item.required &&
    (item.status === "Missing" || item.status === "Rejected" || item.documentId === null)
  );
}

function isFiledOrCompleted(case_: AnnualReturnCase): boolean {
  return FILED_OR_COMPLETED_STATUSES.has(case_.currentStatus);
}

function isActiveForOperationalMetrics(case_: AnnualReturnCase): boolean {
  return !isFiledOrCompleted(case_);
}

function mapChecklist(row: ChecklistRow): AnnualReturnChecklistItem {
  return {
    id: row.id,
    caseId: row.case_id,
    itemLabel: row.item_label,
    required: row.required,
    status: row.status,
    dueDate: dateOnly(row.due_date),
    receivedAt: timestampString(row.received_at),
    verifiedAt: timestampString(row.verified_at),
    documentId: row.document_id,
  };
}

function mapPayment(row: PaymentRow): AnnualReturnPayment {
  return {
    id: row.id,
    caseId: row.case_id,
    invoiceNumber: row.invoice_number,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    dueDate: dateOnly(row.due_date),
    paidAt: timestampString(row.paid_at),
    paymentProofDocumentId: row.payment_proof_document_id,
  };
}

function hydrateCase(
  row: CaseRow,
  checklist: AnnualReturnChecklistItem[],
  payment: AnnualReturnPayment | null,
  today: string,
): AnnualReturnCase {
  const case_: AnnualReturnCase = {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    returnYear: row.return_year,
    madeUpDate: dateOnly(row.made_up_date),
    filingDueDate: dateOnly(row.filing_due_date),
    currentStatus: row.current_status,
    riskLevel: row.risk_level,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    remindersSent: row.reminders_sent,
    filingReference: row.filing_reference,
    confirmationDocumentId: row.confirmation_document_id,
    lockedAt: timestampString(row.locked_at),
    completedAt: timestampString(row.completed_at),
    checklist,
    payment,
  };

  return {
    ...case_,
    riskLevel: riskForCase(case_, today),
  };
}

function caseMatchesHydratedFilters(
  case_: AnnualReturnCase,
  filters: CaseFilters,
  today: string,
): boolean {
  if (filters.risk && case_.riskLevel !== filters.risk) {
    return false;
  }

  if (typeof filters.missingDocuments === "boolean") {
    const hasMissingDocuments = case_.checklist.some(hasMissingRequiredDocument);

    if (hasMissingDocuments !== filters.missingDocuments) {
      return false;
    }
  }

  if (filters.overdueOnly && daysBetween(today, case_.filingDueDate) >= 0) {
    return false;
  }

  return true;
}

function countMissingRequiredDocuments(case_: AnnualReturnCase): number {
  return case_.checklist.filter(hasMissingRequiredDocument).length;
}

export function createAnnualReturnRepository(
  databaseUrl?: string,
  options?: CreateAnnualReturnRepositoryOptions,
): AnnualReturnRepository;
export function createAnnualReturnRepository(
  options?: CreateAnnualReturnRepositoryOptions,
): AnnualReturnRepository;
export function createAnnualReturnRepository(
  databaseUrlOrOptions?: string | CreateAnnualReturnRepositoryOptions,
  maybeOptions: CreateAnnualReturnRepositoryOptions = {},
): AnnualReturnRepository {
  const options =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  function readToday(): string {
    if (typeof options.today === "function") {
      return options.today();
    }

    return options.today ?? systemToday();
  }

  async function selectCaseRows(filters: CaseFilters): Promise<CaseRow[]> {
    const ownerId = filters.ownerId ?? null;
    const teamId = filters.teamId ?? null;
    const reviewerId = filters.reviewerId ?? null;
    const status = filters.status ?? null;
    const paymentStatus = filters.paymentStatus ?? null;

    return sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        arc.return_year,
        arc.made_up_date::text as made_up_date,
        arc.filing_due_date::text as filing_due_date,
        arc.current_status,
        arc.risk_level,
        arc.owner_id,
        owner.name as owner_name,
        arc.reviewer_id,
        reviewer.name as reviewer_name,
        arc.reminders_sent,
        arc.filing_reference,
        arc.confirmation_document_id,
        arc.locked_at::text as locked_at,
        arc.completed_at::text as completed_at
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      join users owner on owner.id = arc.owner_id
      left join users reviewer on reviewer.id = arc.reviewer_id
      where (${ownerId}::uuid is null or arc.owner_id = ${ownerId}::uuid)
        and (${teamId}::uuid is null or c.assigned_team_id = ${teamId}::uuid)
        and (${reviewerId}::uuid is null or arc.reviewer_id = ${reviewerId}::uuid)
        and (${status}::text is null or arc.current_status = ${status})
        and (
          ${paymentStatus}::text is null
          or exists (
            select 1
            from payments p
            where p.case_id = arc.id
              and p.status = ${paymentStatus}
          )
        )
      order by arc.filing_due_date asc, c.company_name asc
    `;
  }

  async function hydrateCases(rows: CaseRow[], today: string): Promise<AnnualReturnCase[]> {
    if (rows.length === 0) {
      return [];
    }

    const caseIds = rows.map((row) => row.id);
    const checklistRows = await sql<ChecklistRow[]>`
      select
        id,
        case_id,
        item_label,
        required,
        status,
        due_date::text as due_date,
        received_at::text as received_at,
        verified_at::text as verified_at,
        document_id
      from annual_return_checklist_items
      where case_id = any(${caseIds}::uuid[])
      order by due_date asc, item_label asc
    `;
    const paymentRows = await sql<PaymentRow[]>`
      select
        id,
        case_id,
        invoice_number,
        amount,
        currency,
        status,
        due_date::text as due_date,
        paid_at::text as paid_at,
        payment_proof_document_id
      from payments
      where case_id = any(${caseIds}::uuid[])
    `;

    const checklistByCaseId = new Map<string, AnnualReturnChecklistItem[]>();
    const paymentByCaseId = new Map<string, AnnualReturnPayment>();

    for (const row of checklistRows) {
      const checklist = checklistByCaseId.get(row.case_id) ?? [];
      checklist.push(mapChecklist(row));
      checklistByCaseId.set(row.case_id, checklist);
    }

    for (const row of paymentRows) {
      paymentByCaseId.set(row.case_id, mapPayment(row));
    }

    return rows.map((row) =>
      hydrateCase(
        row,
        checklistByCaseId.get(row.id) ?? [],
        paymentByCaseId.get(row.id) ?? null,
        today,
      ),
    );
  }

  async function listCasesForToday(
    filters: CaseFilters,
    today: string,
  ): Promise<AnnualReturnCase[]> {
    const rows = await selectCaseRows(filters);
    const cases = await hydrateCases(rows, today);
    return cases.filter((case_) => caseMatchesHydratedFilters(case_, filters, today));
  }

  async function listCases(filters: CaseFilters): Promise<AnnualReturnCase[]> {
    return listCasesForToday(filters, readToday());
  }

  async function getCase(id: string): Promise<AnnualReturnCase | null> {
    const rows = await sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        arc.return_year,
        arc.made_up_date::text as made_up_date,
        arc.filing_due_date::text as filing_due_date,
        arc.current_status,
        arc.risk_level,
        arc.owner_id,
        owner.name as owner_name,
        arc.reviewer_id,
        reviewer.name as reviewer_name,
        arc.reminders_sent,
        arc.filing_reference,
        arc.confirmation_document_id,
        arc.locked_at::text as locked_at,
        arc.completed_at::text as completed_at
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      join users owner on owner.id = arc.owner_id
      left join users reviewer on reviewer.id = arc.reviewer_id
      where arc.id = ${id}
      limit 1
    `;

    const [case_] = await hydrateCases(rows, readToday());
    return case_ ?? null;
  }

  async function dashboardMetrics(
    today: string,
    currentUserId: string,
  ): Promise<AnnualReturnDashboardMetrics> {
    const cases = await listCasesForToday({}, today);
    const activeCases = cases.filter(isActiveForOperationalMetrics);

    return {
      dueIn7: activeCases.filter((case_) => {
        const daysLeft = daysBetween(today, case_.filingDueDate);
        return daysLeft >= 0 && daysLeft <= 7;
      }).length,
      dueIn30: activeCases.filter((case_) => {
        const daysLeft = daysBetween(today, case_.filingDueDate);
        return daysLeft >= 0 && daysLeft <= 30;
      }).length,
      overdue: activeCases.filter((case_) => daysBetween(today, case_.filingDueDate) < 0).length,
      highRisk: activeCases.filter((case_) => case_.riskLevel === "red").length,
      missingDocuments: activeCases.reduce(
        (count, case_) => count + countMissingRequiredDocuments(case_),
        0,
      ),
      paymentPending: activeCases.filter((case_) => case_.payment?.status !== "Payment received")
        .length,
      assignedToMe: cases.filter(
        (case_) => case_.ownerId === currentUserId && case_.currentStatus !== "Completed",
      ).length,
    };
  }

  async function close(): Promise<void> {
    if (ownsClient) {
      await sql.end();
    }
  }

  return {
    listCases,
    getCase,
    dashboardMetrics,
    close,
  };
}
