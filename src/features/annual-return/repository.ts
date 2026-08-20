import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { enqueueNotification } from "@/features/notifications/outbox";
import type postgres from "postgres";
import {
  buildReminderDraft,
  calculateFilingDueDate,
  daysBetween,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  offsetDateOnly,
  riskForCase,
} from "./workflow";
import { dueMilestone, type ReminderMilestone } from "./reminder-cadence";
import {
  assertAnnualReturnActionAllowed,
  assertAnnualReturnCaseCreatable,
  type AnnualReturnAction,
  type AnnualReturnActionActor,
  type AnnualReturnActorRole,
} from "./permissions";
import {
  CHECKLIST_EVIDENCE_FILE_TYPES,
  FILING_CONFIRMATION_FILE_TYPES,
  PAYMENT_PROOF_FILE_TYPES,
} from "./evidence-file-types";
import type {
  AnnualReturnCase,
  AnnualReturnCaseNote,
  AnnualReturnChecklistItem,
  AnnualReturnPayment,
  AnnualReturnStatus,
  ChecklistStatus,
  PaymentStatus,
  RiskLevel,
} from "./types";
import type { DocumentItem } from "@/features/checklist-templates/types";

type CaseRow = {
  id: string;
  company_id: string;
  company_team_id: string;
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

type CaseNoteRow = {
  id: string;
  case_id: string;
  author_id: string;
  body: string;
  created_at: string | Date;
};

type ActorRow = {
  id: string;
  role: AnnualReturnActorRole;
  team_id: string | null;
  active: boolean;
};

type LockedCaseRow = {
  id: string;
  company_id: string;
  company_name: string;
  company_team_id: string;
  current_status: AnnualReturnStatus;
  owner_id: string;
  reviewer_id: string | null;
  filing_reference: string | null;
  confirmation_document_id: string | null;
};

type EligibleCompanyRow = {
  id: string;
  company_name: string;
  cr_number: string;
  annual_return_basis_date: string | Date;
  assigned_owner_id: string;
  assigned_team_id: string;
  team_name: string;
};

type CompanyForCaseRow = {
  id: string;
  status: "active" | "inactive";
  annual_return_basis_date: string | Date;
  assigned_team_id: string;
};

type TemplateForCaseRow = {
  id: string;
  active: boolean;
  documents: DocumentItem[];
};

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CaseFilters = {
  ownerId?: string;
  teamId?: string;
  reviewerId?: string;
  risk?: RiskLevel;
  status?: AnnualReturnStatus;
  missingDocuments?: boolean;
  paymentStatus?: PaymentStatus;
  overdueOnly?: boolean;
  /**
   * Cases this user owns OR reviews. Not expressible through ownerId + reviewerId,
   * which are separate AND-ed clauses.
   */
  visibleToUserId?: string;
  /** The companies a client actor is a member of. Empty means no access at all. */
  companyIds?: readonly string[];
  limit?: number;
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

export type AssignAnnualReturnOwnerInput = {
  caseId: string;
  ownerId: string;
  actorId: string;
};

export type AddAnnualReturnCaseNoteInput = {
  caseId: string;
  body: string;
  actorId: string;
};

export type RecordAnnualReturnReminderInput = {
  caseId: string;
  actorId: string;
  templateLabel: string;
  recipientName: string;
  recipientPhone: string;
  draftBody: string;
  note: string;
};

export type UpdateAnnualReturnChecklistItemInput = {
  caseId: string;
  itemId: string;
  status: ChecklistStatus;
  documentId: string | null;
  actorId: string;
};

export type UpdateAnnualReturnPaymentInput = {
  caseId: string;
  status: PaymentStatus;
  paymentProofDocumentId: string | null;
  actorId: string;
};

export type UpdateAnnualReturnFilingProofInput = {
  caseId: string;
  filingReference: string;
  confirmationDocumentId: string;
  actorId: string;
};

export type CreateAnnualReturnRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
  today?: string | (() => string);
};

export type EligibleCompanyForCase = {
  id: string;
  companyName: string;
  crNumber: string;
  annualReturnBasisDate: string;
  assignedOwnerId: string;
  assignedTeamId: string;
  assignedTeamName: string;
};

export type CreateAnnualReturnCaseInput = {
  companyId: string;
  templateId: string;
  ownerId: string;
  invoiceNumber: string;
  feeAmount: number;
  actorId: string;
};

export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  listCompaniesEligibleForCase(): Promise<EligibleCompanyForCase[]>;
  createCase(input: CreateAnnualReturnCaseInput): Promise<AnnualReturnCase>;
  dashboardMetrics(
    today: string,
    currentUserId: string,
    scope?: CaseFilters,
  ): Promise<AnnualReturnDashboardMetrics>;
  assertCanMutateCase(caseId: string, actorId: string, action: AnnualReturnAction): Promise<void>;
  evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;
  updateStatus(
    caseId: string,
    nextStatus: AnnualReturnStatus,
    actorId: string,
  ): Promise<AnnualReturnCase>;
  assignOwner(input: AssignAnnualReturnOwnerInput): Promise<AnnualReturnCase>;
  listNotes(caseId: string): Promise<AnnualReturnCaseNote[]>;
  addNote(input: AddAnnualReturnCaseNoteInput): Promise<AnnualReturnCaseNote>;
  recordReminder(input: RecordAnnualReturnReminderInput): Promise<AnnualReturnCase>;
  updateChecklistItem(input: UpdateAnnualReturnChecklistItemInput): Promise<AnnualReturnCase>;
  updatePayment(input: UpdateAnnualReturnPaymentInput): Promise<AnnualReturnCase>;
  updateFilingProof(input: UpdateAnnualReturnFilingProofInput): Promise<AnnualReturnCase>;
  close(): Promise<void>;
};

// Re-exported so existing importers (server-fns.ts) keep working unchanged. The
// definition lives in ./workflow because that module imports nothing but ./types,
// which is what lets a browser component derive the same operational "today".
export { hongKongBusinessDate };

/**
 * Applied as a SQL LIMIT rather than a client-side slice, so hydrateCases loads
 * checklist and payment children for at most this many cases instead of for the
 * whole table.
 */
export const DEFAULT_CASE_LIMIT = 200;

/**
 * The window scanned when a `risk` filter is active.
 *
 * risk / missingDocuments / overdueOnly used to be applied in JS *after* the SQL
 * LIMIT, so past 200 cases a filtered board silently omitted matches: "high risk"
 * showed only the high-risk cases that happened to fall inside the 200 earliest
 * due dates, and the dashboard tiles counted the same truncated set.
 *
 * overdueOnly and missingDocuments are now SQL predicates and filter before the
 * limit. risk is derived from hydrated children, so it still filters afterwards
 * and instead widens the window it filters over.
 */
export const RISK_FILTER_SCAN_LIMIT = 2000;

/**
 * Dashboard tiles count the whole active book rather than a page of it. Still
 * bounded, because hydrateCases loads checklist and payment children per case.
 */
export const DASHBOARD_METRICS_SCAN_LIMIT = 5000;

const FILED_OR_COMPLETED_STATUSES = new Set<AnnualReturnStatus>(["Filed", "Completed"]);
const COMPLETED_CASE_LOCKED_MESSAGE = "Completed annual return cases are locked.";
// Accepted `documents.file_type` values per evidence kind. Previously three bare
// literals that only the seed script wrote — see ./evidence-file-types.
const CHECKLIST_EVIDENCE_FILE_TYPE = CHECKLIST_EVIDENCE_FILE_TYPES;
const PAYMENT_PROOF_FILE_TYPE = PAYMENT_PROOF_FILE_TYPES;
const FILING_CONFIRMATION_FILE_TYPE = FILING_CONFIRMATION_FILE_TYPES;

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

function requiredTimestampString(value: string | Date): string {
  const timestamp = timestampString(value);
  if (!timestamp) throw new Error("Required timestamp is missing.");
  return timestamp;
}

function hasOutstandingRequiredEvidence(item: AnnualReturnChecklistItem): boolean {
  return (
    item.required &&
    (item.status !== "Verified" ||
      item.receivedAt === null ||
      item.verifiedAt === null ||
      item.documentId === null)
  );
}

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiledOrCompleted(case_: AnnualReturnCase): boolean {
  return FILED_OR_COMPLETED_STATUSES.has(case_.currentStatus);
}

function isLockedOrCompleted(case_: AnnualReturnCase): boolean {
  return (
    case_.currentStatus === "Completed" || case_.lockedAt !== null || case_.completedAt !== null
  );
}

function assertCaseIsWritable(case_: AnnualReturnCase): void {
  if (isLockedOrCompleted(case_)) {
    throw new Error(COMPLETED_CASE_LOCKED_MESSAGE);
  }
}

function assertSingleMutatedRow(rows: { id: string }[], message: string): void {
  if (rows.length !== 1) {
    throw new Error(message);
  }
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
    companyTeamId: row.company_team_id,
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

/**
 * Only `risk` remains here. missingDocuments and overdueOnly are SQL predicates
 * now, so they narrow before the LIMIT instead of after it.
 */
function caseMatchesHydratedFilters(case_: AnnualReturnCase, filters: CaseFilters): boolean {
  return !filters.risk || case_.riskLevel === filters.risk;
}

function countOutstandingRequiredEvidence(case_: AnnualReturnCase): number {
  return case_.checklist.filter(hasOutstandingRequiredEvidence).length;
}

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return client.begin(handler) as Promise<T>;
  }

  return handler(client);
}

export function createAnnualReturnRepository(
  options?: CreateAnnualReturnRepositoryOptions,
): AnnualReturnRepository;
export function createAnnualReturnRepository(
  databaseUrl: string | undefined,
  options?: CreateAnnualReturnRepositoryOptions,
): AnnualReturnRepository;
export function createAnnualReturnRepository(
  databaseUrlOrOptions?: string | CreateAnnualReturnRepositoryOptions,
  maybeOptions?: CreateAnnualReturnRepositoryOptions,
): AnnualReturnRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  function readToday(): string {
    if (typeof options.today === "function") {
      return options.today();
    }

    return options.today ?? hongKongBusinessDate();
  }

  function ensureAnnualReturnWorkItem(
    tx: TransactionSqlClient,
    lockedCase: LockedCaseRow,
    event: {
      sourceEventKey: string;
      sourceEventType: string;
      title: string;
      priority?: number;
    },
  ) {
    return ensureWorkItemForEvent(tx, {
      companyId: lockedCase.company_id,
      caseType: "annual_return",
      annualReturnCaseId: lockedCase.id,
      sourceEventKey: event.sourceEventKey,
      sourceEventType: event.sourceEventType,
      workType: "annual_return_case",
      requiredSkillKey: "annual-return",
      title: event.title,
      priority: event.priority,
      ownerId: lockedCase.owner_id,
      reviewerId: lockedCase.reviewer_id,
      teamId: lockedCase.company_team_id,
    });
  }

  async function writeAuditEvent(
    tx: TransactionSqlClient,
    input: {
      case_: Pick<AnnualReturnCase, "id" | "companyId">;
      companyId?: string;
      actor: AnnualReturnActionActor;
      action: AnnualReturnAction;
      summary: string;
      metadata: postgres.JSONValue;
    },
  ): Promise<void> {
    await tx`
      insert into annual_return_audit_events (
        case_id,
        company_id,
        actor_id,
        actor_role,
        action,
        result,
        summary,
        metadata
      )
      values (
        ${input.case_.id},
        ${input.companyId ?? input.case_.companyId},
        ${input.actor.id},
        ${input.actor.role},
        ${input.action},
        'succeeded',
        ${input.summary},
        ${tx.json(input.metadata)}
      )
    `;
  }

  async function tryLockWritableCase(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<LockedCaseRow | null> {
    const rows = await tx<LockedCaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        c.assigned_team_id as company_team_id,
        arc.current_status,
        arc.owner_id,
        arc.reviewer_id,
        arc.filing_reference,
        arc.confirmation_document_id
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      where arc.id = ${caseId}
        and arc.locked_at is null
        and arc.completed_at is null
        and arc.current_status <> 'Completed'
      for update
    `;

    return rows[0] ?? null;
  }

  async function lockWritableCase(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<LockedCaseRow> {
    const lockedCase = await tryLockWritableCase(tx, caseId);
    if (!lockedCase) throw new Error(COMPLETED_CASE_LOCKED_MESSAGE);
    return lockedCase;
  }

  async function assertActorCanMutateLockedCase(
    tx: TransactionSqlClient,
    actorId: string,
    lockedCase: LockedCaseRow,
    action: AnnualReturnAction,
  ): Promise<AnnualReturnActionActor> {
    const actorRows = await tx<ActorRow[]>`
      select id, role, team_id, active
      from users
      where id = ${actorId}
      limit 1
    `;
    const [actorRow] = actorRows;

    if (!actorRow) {
      throw new Error("Annual return actor not found.");
    }

    const actor: AnnualReturnActionActor = {
      id: actorRow.id,
      role: actorRow.role,
      teamId: actorRow.team_id,
      active: actorRow.active,
    };

    assertAnnualReturnActionAllowed(
      actor,
      {
        id: lockedCase.id,
        companyName: lockedCase.company_name,
        companyTeamId: lockedCase.company_team_id,
        ownerId: lockedCase.owner_id,
        reviewerId: lockedCase.reviewer_id,
      },
      action,
    );

    return actor;
  }

  async function selectCaseRows(filters: CaseFilters, today: string): Promise<CaseRow[]> {
    const ownerId = filters.ownerId ?? null;
    const teamId = filters.teamId ?? null;
    const reviewerId = filters.reviewerId ?? null;
    const status = filters.status ?? null;
    const paymentStatus = filters.paymentStatus ?? null;
    const visibleToUserId = filters.visibleToUserId ?? null;
    const companyIds = filters.companyIds ? [...filters.companyIds] : null;
    const overdueOnly = filters.overdueOnly === true ? today : null;
    const missingDocuments = typeof filters.missingDocuments === "boolean" ? today : null;
    const wantsMissingDocuments = filters.missingDocuments === true;
    // `risk` stays a post-hydration filter — riskForCase derives it from the
    // checklist, payment and filing state, and duplicating that in SQL is exactly
    // the kind of drift that made the evidence guards unsatisfiable. It is applied
    // to a wider window instead, so the LIMIT no longer truncates before filtering.
    const limit = filters.limit ?? (filters.risk ? RISK_FILTER_SCAN_LIMIT : DEFAULT_CASE_LIMIT);

    return sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.assigned_team_id as company_team_id,
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
        and (
          ${visibleToUserId}::uuid is null
          or arc.owner_id = ${visibleToUserId}::uuid
          or arc.reviewer_id = ${visibleToUserId}::uuid
        )
        and (${companyIds}::uuid[] is null or arc.company_id = any(${companyIds}::uuid[]))
        and (${overdueOnly}::date is null or arc.filing_due_date < ${overdueOnly}::date)
        and (
          ${missingDocuments}::date is null
          or ${wantsMissingDocuments} = exists (
            -- Mirrors hasOutstandingRequiredEvidence exactly; the two are pinned
            -- together by a test.
            select 1
            from annual_return_checklist_items i
            where i.case_id = arc.id
              and i.required = true
              and (
                i.status <> 'Verified'
                or i.received_at is null
                or i.verified_at is null
                or i.document_id is null
              )
          )
        )
      order by arc.filing_due_date asc, c.company_name asc
      limit ${limit}
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
    const rows = await selectCaseRows(filters, today);
    const cases = await hydrateCases(rows, today);
    return cases.filter((case_) => caseMatchesHydratedFilters(case_, filters));
  }

  async function listCases(filters: CaseFilters): Promise<AnnualReturnCase[]> {
    return listCasesForToday(filters, readToday());
  }

  async function getCase(id: string): Promise<AnnualReturnCase | null> {
    const rows = await sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.assigned_team_id as company_team_id,
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

  async function listCompaniesEligibleForCase(): Promise<EligibleCompanyForCase[]> {
    const rows = await sql<EligibleCompanyRow[]>`
      select
        c.id,
        c.company_name,
        c.cr_number,
        c.annual_return_basis_date::text as annual_return_basis_date,
        c.assigned_owner_id,
        c.assigned_team_id,
        t.name as team_name
      from companies c
      join teams t on t.id = c.assigned_team_id
      where c.status = 'active'
        and not exists (
          select 1
          from annual_return_cases arc
          where arc.company_id = c.id
            and arc.return_year = extract(year from c.annual_return_basis_date)::int
        )
      order by c.company_name asc
    `;

    return rows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      crNumber: row.cr_number,
      annualReturnBasisDate: dateOnly(row.annual_return_basis_date),
      assignedOwnerId: row.assigned_owner_id,
      assignedTeamId: row.assigned_team_id,
      assignedTeamName: row.team_name,
    }));
  }

  async function createCase(input: CreateAnnualReturnCaseInput): Promise<AnnualReturnCase> {
    const caseId = await withTransaction(sql, async (tx) => {
      const actorRows = await tx<ActorRow[]>`
        select id, role, team_id, active
        from users
        where id = ${input.actorId}
        limit 1
      `;
      const [actorRow] = actorRows;
      if (!actorRow) throw new Error("Annual return actor not found.");

      const actor: AnnualReturnActionActor = {
        id: actorRow.id,
        role: actorRow.role,
        teamId: actorRow.team_id,
        active: actorRow.active,
      };

      const companyRows = await tx<CompanyForCaseRow[]>`
        select
          id, status, annual_return_basis_date::text as annual_return_basis_date, assigned_team_id
        from companies
        where id = ${input.companyId}
        for update
      `;
      const company = companyRows[0];
      if (!company || company.status !== "active") {
        throw new Error("Company not found or inactive.");
      }

      assertAnnualReturnCaseCreatable(actor, { teamId: company.assigned_team_id });

      const basisDate = dateOnly(company.annual_return_basis_date);
      const returnYear = Number(basisDate.slice(0, 4));

      const existingRows = await tx<{ id: string }[]>`
        select id from annual_return_cases
        where company_id = ${input.companyId} and return_year = ${returnYear}
        limit 1
      `;
      if (existingRows.length > 0) {
        throw new Error(`This company already has a case for ${returnYear}.`);
      }

      const templateRows = await tx<TemplateForCaseRow[]>`
        select id, active, documents
        from checklist_templates
        where id = ${input.templateId}
        limit 1
      `;
      const template = templateRows[0];
      if (!template || !template.active) {
        throw new Error("Checklist template not found or inactive.");
      }

      const ownerRows = await tx<{ id: string }[]>`
        select id
        from users
        where id = ${input.ownerId}
          and active = true
        limit 1
      `;
      if (ownerRows.length !== 1) {
        throw new Error("Annual return owner not found or inactive.");
      }

      const filingDueDate = calculateFilingDueDate(basisDate);

      const caseRows = await tx<{ id: string }[]>`
        insert into annual_return_cases (
          company_id, return_year, made_up_date, filing_due_date, current_status, owner_id
        )
        values (
          ${input.companyId}, ${returnYear}, ${basisDate}, ${filingDueDate}, 'Upcoming', ${input.ownerId}
        )
        returning id
      `;
      const newCaseId = caseRows[0]?.id;
      if (!newCaseId) throw new Error("Annual return case was not created.");

      for (const document of template.documents) {
        const dueDate = offsetDateOnly(filingDueDate, -document.daysBeforeDue);
        await tx`
          insert into annual_return_checklist_items (case_id, item_label, required, status, due_date)
          values (${newCaseId}, ${document.label}, ${document.required}, 'Missing', ${dueDate})
        `;
      }

      await tx`
        insert into payments (company_id, case_id, invoice_number, amount, due_date)
        values (
          ${input.companyId}, ${newCaseId}, ${input.invoiceNumber}, ${input.feeAmount}, ${filingDueDate}
        )
      `;

      await ensureWorkItemForEvent(tx, {
        companyId: input.companyId,
        caseType: "annual_return",
        annualReturnCaseId: newCaseId,
        sourceEventKey: `annual-return:${newCaseId}:created`,
        sourceEventType: "annual_return_case_created",
        workType: "annual_return_case",
        requiredSkillKey: "annual-return",
        title: "Set up new annual return case",
        ownerId: input.ownerId,
        reviewerId: null,
        teamId: company.assigned_team_id,
      });

      await tx`
        insert into timeline_events (
          company_id, case_id, event_type, actor_type, actor_id, description, metadata
        )
        values (
          ${input.companyId}, ${newCaseId}, 'annual_return_case_created', 'user', ${input.actorId},
          'Annual return case created.',
          ${tx.json({ templateId: input.templateId, returnYear })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: { id: newCaseId, companyId: input.companyId },
        companyId: input.companyId,
        actor,
        action: "create_case",
        summary: "Annual return case created.",
        metadata: { templateId: input.templateId, returnYear },
      });

      return newCaseId;
    });

    return hydratedCaseAfterMutation(caseId, "case creation");
  }

  /**
   * `scope` is the same narrowing the board applies. Without it the tiles counted
   * the whole firm for every staff role, so a user whose board showed their own
   * cases saw headline numbers for books they cannot open.
   */
  async function dashboardMetrics(
    today: string,
    currentUserId: string,
    scope: CaseFilters = {},
  ): Promise<AnnualReturnDashboardMetrics> {
    // TODO: Move dashboard tiles to SQL aggregates and paginated reads as case volume grows.
    const cases = await listCasesForToday({ ...scope, limit: DASHBOARD_METRICS_SCAN_LIMIT }, today);
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
        (count, case_) => count + countOutstandingRequiredEvidence(case_),
        0,
      ),
      paymentPending: activeCases.filter((case_) => case_.payment?.status !== "Payment received")
        .length,
      assignedToMe: cases.filter(
        (case_) => case_.ownerId === currentUserId && case_.currentStatus !== "Completed",
      ).length,
    };
  }

  async function hydratedCaseAfterMutation(caseId: string, actionLabel: string) {
    const updated = await getCase(caseId);

    if (!updated) {
      throw new Error(`Annual return case disappeared after ${actionLabel}.`);
    }

    return updated;
  }

  async function completionBlockerMessagesForLockedCase(
    tx: TransactionSqlClient,
    caseId: string,
    companyId: string,
    filingReference: string | null,
    confirmationDocumentId: string | null,
  ): Promise<string[]> {
    const blockers: string[] = [];
    const unverifiedRequiredRows = await tx<{ id: string }[]>`
      select arci.id
      from annual_return_checklist_items arci
      left join documents d on d.id = arci.document_id
        and d.case_id = arci.case_id
        and d.company_id = ${companyId}
        and d.verification_status = 'verified'
        and d.file_type = any(${CHECKLIST_EVIDENCE_FILE_TYPE})
      where arci.case_id = ${caseId}
        and arci.required = true
        and (
          arci.status <> 'Verified'
          or arci.received_at is null
          or arci.verified_at is null
          or arci.document_id is null
          or d.id is null
        )
      for update of arci
    `;

    if (unverifiedRequiredRows.length > 0) {
      blockers.push(
        `${unverifiedRequiredRows.length} required checklist item${
          unverifiedRequiredRows.length === 1 ? " is" : "s are"
        } not verified.`,
      );
    }

    const paymentRows = await tx<
      {
        id: string;
        status: PaymentStatus;
        payment_proof_document_id: string | null;
        verified_payment_proof_document_id: string | null;
      }[]
    >`
      select
        p.id,
        p.status,
        p.payment_proof_document_id,
        d.id as verified_payment_proof_document_id
      from payments p
      left join documents d on d.id = p.payment_proof_document_id
        and d.case_id = p.case_id
        and d.company_id = ${companyId}
        and d.verification_status = 'verified'
        and d.file_type = any(${PAYMENT_PROOF_FILE_TYPE})
      where p.case_id = ${caseId}
      for update of p
    `;

    const [paymentRow] = paymentRows;

    if (!paymentRow || paymentRow.status !== "Payment received") {
      blockers.push("Payment must be marked as received.");
    } else if (
      !paymentRow.payment_proof_document_id ||
      !paymentRow.verified_payment_proof_document_id
    ) {
      blockers.push("Verified payment proof document is required.");
    }

    if (!hasText(filingReference)) {
      blockers.push("Filing reference is required.");
    }

    if (!confirmationDocumentId) {
      blockers.push("Filing confirmation document is required.");
    } else {
      const filingConfirmationRows = await tx<{ id: string }[]>`
        select id
        from documents
        where id = ${confirmationDocumentId}
          and case_id = ${caseId}
          and company_id = ${companyId}
          and verification_status = 'verified'
          and file_type = any(${FILING_CONFIRMATION_FILE_TYPE})
        limit 1
      `;

      if (filingConfirmationRows.length !== 1) {
        blockers.push("Verified filing confirmation document is required.");
      }
    }

    return blockers;
  }

  async function assignOwner(input: AssignAnnualReturnOwnerInput): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);
    if (!current) throw new Error("Annual return case not found.");
    assertCaseIsWritable(current);

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, input.caseId);
      const actor = await assertActorCanMutateLockedCase(
        tx,
        input.actorId,
        lockedCase,
        "assign_owner",
      );
      const ownerRows = await tx<{ id: string }[]>`
        select id
        from users
        where id = ${input.ownerId}
          and active = true
        limit 1
      `;

      if (ownerRows.length !== 1) {
        throw new Error("Annual return owner not found or inactive.");
      }

      const updatedRows = await tx<{ id: string }[]>`
        update annual_return_cases
        set owner_id = ${input.ownerId},
            updated_at = now()
        where id = ${input.caseId}
          and locked_at is null
          and completed_at is null
          and current_status <> 'Completed'
        returning id
      `;
      assertSingleMutatedRow(updatedRows, COMPLETED_CASE_LOCKED_MESSAGE);

      await tx`
        with candidates as (
          select id, owner_id, version
          from work_items
          where case_id = ${input.caseId}
            and status in ('open', 'in_progress', 'blocked')
            and owner_id is distinct from ${input.ownerId}
          for update
        ),
        updated as (
          update work_items wi
          set owner_id = ${input.ownerId},
              version = wi.version + 1,
              updated_at = now()
          from candidates candidate
          where wi.id = candidate.id
          returning wi.id
        )
        insert into assignment_events (
          work_item_id,
          previous_assignee_id,
          assigned_to_id,
          assigned_by_id,
          recommendation_factors,
          decision,
          expected_version
        )
        select
          candidate.id,
          candidate.owner_id,
          ${input.ownerId},
          ${input.actorId},
          '{}'::jsonb,
          'manual',
          candidate.version
        from candidates candidate
        join updated on updated.id = candidate.id
      `;

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${input.caseId},
          'annual_return_owner_assigned',
          'user',
          ${input.actorId},
          'Annual return owner assigned.',
          ${tx.json({
            previousOwnerId: lockedCase.owner_id,
            ownerId: input.ownerId,
          })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action: "assign_owner",
        summary: "Annual return owner assigned.",
        metadata: {
          previousOwnerId: lockedCase.owner_id,
          ownerId: input.ownerId,
        },
      });
    });

    return hydratedCaseAfterMutation(input.caseId, "owner assignment");
  }

  async function listNotes(caseId: string): Promise<AnnualReturnCaseNote[]> {
    const rows = await sql<CaseNoteRow[]>`
      select id, case_id, author_id, body, created_at
      from case_notes
      where case_id = ${caseId}
      order by created_at asc, id asc
    `;

    return rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      authorId: row.author_id,
      body: row.body,
      createdAt: requiredTimestampString(row.created_at),
    }));
  }

  async function addNote(input: AddAnnualReturnCaseNoteInput): Promise<AnnualReturnCaseNote> {
    const current = await getCase(input.caseId);
    if (!current) throw new Error("Annual return case not found.");
    assertCaseIsWritable(current);

    const body = input.body.trim();
    if (!body) throw new Error("Annual return case note cannot be empty.");
    if (body.length > 2000) {
      throw new Error("Annual return case note cannot exceed 2000 characters.");
    }

    return withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, input.caseId);
      const actor = await assertActorCanMutateLockedCase(tx, input.actorId, lockedCase, "add_note");
      const noteRows = await tx<CaseNoteRow[]>`
        insert into case_notes (case_id, author_id, body)
        values (${input.caseId}, ${input.actorId}, ${body})
        returning id, case_id, author_id, body, created_at
      `;
      const [noteRow] = noteRows;
      if (!noteRow) throw new Error("Annual return case note was not created.");

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${input.caseId},
          'case_note_added',
          'user',
          ${input.actorId},
          'Case note added.',
          ${tx.json({ noteId: noteRow.id })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action: "add_note",
        summary: "Case note added.",
        metadata: { noteId: noteRow.id },
      });

      return {
        id: noteRow.id,
        caseId: noteRow.case_id,
        authorId: noteRow.author_id,
        body: noteRow.body,
        createdAt: requiredTimestampString(noteRow.created_at),
      };
    });
  }
  async function updateStatus(
    caseId: string,
    nextStatus: AnnualReturnStatus,
    actorId: string,
  ): Promise<AnnualReturnCase> {
    const current = await getCase(caseId);

    if (!current) {
      throw new Error("Annual return case not found.");
    }

    const completing = nextStatus === "Completed";
    const action = completing ? "complete" : "change_status";
    assertCaseIsWritable(current);

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, caseId);
      const actor = await assertActorCanMutateLockedCase(tx, actorId, lockedCase, action);

      if (completing) {
        const blockers = await completionBlockerMessagesForLockedCase(
          tx,
          caseId,
          lockedCase.company_id,
          lockedCase.filing_reference,
          lockedCase.confirmation_document_id,
        );

        if (blockers.length > 0) {
          throw new Error(`Cannot complete annual return case: ${blockers.join(" ")}`);
        }
      } else if (!isAllowedStatusTransition(lockedCase.current_status, nextStatus)) {
        throw new Error(`Cannot move from ${lockedCase.current_status} to ${nextStatus}.`);
      }

      const updatedRows = await tx<{ id: string; updated_at: string | Date }[]>`
        update annual_return_cases
        set current_status = ${nextStatus},
            locked_at = case when ${completing} then coalesce(locked_at, now()) else locked_at end,
            completed_at = case when ${completing} then coalesce(completed_at, now()) else completed_at end,
            updated_at = now()
        where id = ${caseId}
          and locked_at is null
          and completed_at is null
          and current_status <> 'Completed'
        returning id, updated_at
      `;

      assertSingleMutatedRow(updatedRows, COMPLETED_CASE_LOCKED_MESSAGE);

      await ensureAnnualReturnWorkItem(tx, lockedCase, {
        sourceEventKey: `annual-return:${caseId}:status:${crypto.randomUUID()}`,
        sourceEventType: "annual_return_status_changed",
        title: `Review annual return status: ${nextStatus}`,
        priority: completing ? 80 : 60,
      });

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${caseId},
          'status_changed',
          'user',
          ${actorId},
          ${`Status changed from ${lockedCase.current_status} to ${nextStatus}.`},
          ${tx.json({ from: lockedCase.current_status, to: nextStatus })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action,
        summary: `Status changed from ${lockedCase.current_status} to ${nextStatus}.`,
        metadata: { from: lockedCase.current_status, to: nextStatus },
      });
    });

    return hydratedCaseAfterMutation(caseId, "status update");
  }

  async function recordReminder(input: RecordAnnualReturnReminderInput): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);

    if (!current) {
      throw new Error("Annual return case not found.");
    }

    assertCaseIsWritable(current);

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, input.caseId);
      const actor = await assertActorCanMutateLockedCase(
        tx,
        input.actorId,
        lockedCase,
        "record_reminder",
      );

      const updatedRows = await tx<{ id: string }[]>`
        update annual_return_cases
        set reminders_sent = reminders_sent + 1,
            current_status = case
              when current_status = 'Upcoming' then 'Client reminder sent'
              else current_status
            end,
            updated_at = now()
        where id = ${input.caseId}
          and locked_at is null
          and completed_at is null
          and current_status <> 'Completed'
        returning id
      `;

      assertSingleMutatedRow(updatedRows, COMPLETED_CASE_LOCKED_MESSAGE);

      await tx`
        insert into reminder_logs (
          case_id,
          channel,
          template_label,
          recipient_name,
          recipient_phone,
          draft_body,
          recorded_sent_at,
          staff_actor_id,
          note
        )
        values (
          ${input.caseId},
          'WhatsApp',
          ${input.templateLabel},
          ${input.recipientName},
          ${input.recipientPhone},
          ${input.draftBody},
          now(),
          ${input.actorId},
          ${input.note}
        )
      `;

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${input.caseId},
          'client_reminder_logged',
          'user',
          ${input.actorId},
          ${`Manual WhatsApp reminder logged for ${input.recipientName}.`},
          ${tx.json({
            channel: "WhatsApp",
            templateLabel: input.templateLabel,
            recipientPhone: input.recipientPhone,
          })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action: "record_reminder",
        summary: `Manual WhatsApp reminder logged for ${input.recipientName}.`,
        metadata: {
          channel: "WhatsApp",
          templateLabel: input.templateLabel,
          recipientPhone: input.recipientPhone,
        },
      });
    });

    return hydratedCaseAfterMutation(input.caseId, "reminder logging");
  }

  async function updateChecklistItem(
    input: UpdateAnnualReturnChecklistItemInput,
  ): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);

    if (!current) {
      throw new Error("Annual return case not found.");
    }

    assertCaseIsWritable(current);

    const documentId = input.status === "Missing" ? null : input.documentId;
    const hasReceivedEvidence = input.status !== "Missing";
    const hasVerifiedEvidence = input.status === "Verified";

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, input.caseId);
      const actor = await assertActorCanMutateLockedCase(
        tx,
        input.actorId,
        lockedCase,
        "update_checklist",
      );

      if (hasVerifiedEvidence && !documentId) {
        throw new Error("Verified checklist items require a document.");
      }

      if (hasVerifiedEvidence && documentId) {
        const documentRows = await tx<{ id: string }[]>`
          select id
          from documents
          where id = ${documentId}
            and case_id = ${input.caseId}
            and company_id = ${lockedCase.company_id}
            and verification_status = 'verified'
            and file_type = any(${CHECKLIST_EVIDENCE_FILE_TYPE})
          limit 1
        `;

        if (documentRows.length !== 1) {
          throw new Error(
            "Verified checklist items require a same-case verified annual return evidence document.",
          );
        }
      }

      const currentItemRows = await tx<{ status: ChecklistStatus; document_id: string | null }[]>`
        select status, document_id from annual_return_checklist_items
        where id = ${input.itemId} and case_id = ${input.caseId} for update
      `;
      if (!currentItemRows[0]) throw new Error("Checklist item not found for annual return case.");
      const eventChanged =
        currentItemRows[0].status !== input.status || currentItemRows[0].document_id !== documentId;

      const updatedRows = await tx<{ id: string; item_label: string; updated_at: string | Date }[]>`
        update annual_return_checklist_items
        set status = ${input.status},
            document_id = ${documentId},
            received_at = case when ${hasReceivedEvidence} then coalesce(received_at, now()) else null end,
            verified_at = case when ${hasVerifiedEvidence} then coalesce(verified_at, now()) else null end,
            updated_at = now()
        where id = ${input.itemId}
          and case_id = ${input.caseId}
        returning id, item_label, updated_at
      `;

      if (updatedRows.length !== 1) {
        throw new Error("Checklist item not found for annual return case.");
      }

      if (eventChanged) {
        await ensureAnnualReturnWorkItem(tx, lockedCase, {
          sourceEventKey: `annual-return:${input.caseId}:checklist:${input.itemId}:${crypto.randomUUID()}`,
          sourceEventType: "annual_return_document_updated",
          title: `Review document: ${updatedRows[0].item_label}`,
          priority: input.status === "Verified" ? 55 : 70,
        });
      }

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${input.caseId},
          'checklist_item_updated',
          'user',
          ${input.actorId},
          ${`${updatedRows[0].item_label} marked as ${input.status}.`},
          ${tx.json({
            itemId: input.itemId,
            itemLabel: updatedRows[0].item_label,
            status: input.status,
            documentId,
          })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action: "update_checklist",
        summary: `${updatedRows[0].item_label} marked as ${input.status}.`,
        metadata: {
          itemId: input.itemId,
          itemLabel: updatedRows[0].item_label,
          status: input.status,
          documentId,
        },
      });
    });

    return hydratedCaseAfterMutation(input.caseId, "checklist update");
  }

  async function updatePayment(input: UpdateAnnualReturnPaymentInput): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);

    if (!current) {
      throw new Error("Annual return case not found.");
    }

    assertCaseIsWritable(current);

    const isPaymentReceived = input.status === "Payment received";
    const paymentProofDocumentId = isPaymentReceived ? input.paymentProofDocumentId : null;

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, input.caseId);
      const actor = await assertActorCanMutateLockedCase(
        tx,
        input.actorId,
        lockedCase,
        "update_payment",
      );

      if (isPaymentReceived && !paymentProofDocumentId) {
        throw new Error("Payment received requires a payment proof document.");
      }

      if (isPaymentReceived && paymentProofDocumentId) {
        const documentRows = await tx<{ id: string }[]>`
          select id
          from documents
          where id = ${paymentProofDocumentId}
            and case_id = ${input.caseId}
            and company_id = ${lockedCase.company_id}
            and verification_status = 'verified'
            and file_type = any(${PAYMENT_PROOF_FILE_TYPE})
          limit 1
        `;

        if (documentRows.length !== 1) {
          throw new Error("Payment received requires a same-case verified payment proof document.");
        }
      }

      const currentPaymentRows = await tx<
        { status: PaymentStatus; payment_proof_document_id: string | null }[]
      >`
        select status, payment_proof_document_id from payments
        where case_id = ${input.caseId} for update
      `;
      if (!currentPaymentRows[0]) throw new Error("Annual return payment not found.");
      const eventChanged =
        currentPaymentRows[0].status !== input.status ||
        currentPaymentRows[0].payment_proof_document_id !== paymentProofDocumentId;

      const updatedRows = await tx<
        { id: string; invoice_number: string; updated_at: string | Date }[]
      >`
        update payments
        set status = ${input.status},
            payment_proof_document_id = ${paymentProofDocumentId},
            paid_at = case when ${isPaymentReceived} then coalesce(paid_at, now()) else null end,
            updated_at = now()
        where case_id = ${input.caseId}
        returning id, invoice_number, updated_at
      `;

      if (updatedRows.length !== 1) {
        throw new Error("Annual return payment not found.");
      }

      if (eventChanged) {
        await ensureAnnualReturnWorkItem(tx, lockedCase, {
          sourceEventKey: `annual-return:${input.caseId}:payment:${updatedRows[0].id}:${crypto.randomUUID()}`,
          sourceEventType: "annual_return_payment_updated",
          title: `Review payment: ${updatedRows[0].invoice_number}`,
          priority: input.status === "Payment received" ? 65 : 75,
        });
      }

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${input.caseId},
          'payment_updated',
          'user',
          ${input.actorId},
          ${`Payment status changed to ${input.status}.`},
          ${tx.json({
            paymentId: updatedRows[0].id,
            invoiceNumber: updatedRows[0].invoice_number,
            status: input.status,
            paymentProofDocumentId,
          })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action: "update_payment",
        summary: `Payment status changed to ${input.status}.`,
        metadata: {
          paymentId: updatedRows[0].id,
          invoiceNumber: updatedRows[0].invoice_number,
          status: input.status,
          paymentProofDocumentId,
        },
      });
    });

    return hydratedCaseAfterMutation(input.caseId, "payment update");
  }

  async function updateFilingProof(
    input: UpdateAnnualReturnFilingProofInput,
  ): Promise<AnnualReturnCase> {
    const current = await getCase(input.caseId);

    if (!current) {
      throw new Error("Annual return case not found.");
    }

    assertCaseIsWritable(current);

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, input.caseId);
      const actor = await assertActorCanMutateLockedCase(
        tx,
        input.actorId,
        lockedCase,
        "update_filing_proof",
      );

      if (lockedCase.filing_reference !== null || lockedCase.confirmation_document_id !== null) {
        if (
          lockedCase.filing_reference === input.filingReference &&
          lockedCase.confirmation_document_id === input.confirmationDocumentId
        ) {
          return;
        }

        throw new Error("Filing receipt has already been accepted.");
      }
      const documentRows = await tx<{ id: string }[]>`
        select id
        from documents
        where id = ${input.confirmationDocumentId}
          and case_id = ${input.caseId}
          and company_id = ${lockedCase.company_id}
          and verification_status = 'verified'
          and file_type = any(${FILING_CONFIRMATION_FILE_TYPE})
        limit 1
      `;

      if (documentRows.length !== 1) {
        throw new Error("Filing proof requires a same-case verified filing confirmation document.");
      }

      const eventChanged =
        lockedCase.filing_reference !== input.filingReference ||
        lockedCase.confirmation_document_id !== input.confirmationDocumentId;

      const updatedRows = await tx<{ id: string; updated_at: string | Date }[]>`
        update annual_return_cases
        set filing_reference = ${input.filingReference},
            confirmation_document_id = ${input.confirmationDocumentId},
            updated_at = now()
        where id = ${input.caseId}
          and locked_at is null
          and completed_at is null
          and current_status <> 'Completed'
          and filing_reference is null
          and confirmation_document_id is null
        returning id, updated_at
      `;

      assertSingleMutatedRow(updatedRows, COMPLETED_CASE_LOCKED_MESSAGE);

      if (eventChanged) {
        await ensureAnnualReturnWorkItem(tx, lockedCase, {
          sourceEventKey: `annual-return:${input.caseId}:filing:${crypto.randomUUID()}`,
          sourceEventType: "annual_return_filing_proof_updated",
          title: `Review filing proof: ${input.filingReference}`,
          priority: 85,
        });
      }

      await tx`
        insert into timeline_events (
          company_id,
          case_id,
          event_type,
          actor_type,
          actor_id,
          description,
          metadata
        )
        values (
          ${lockedCase.company_id},
          ${input.caseId},
          'filing_proof_updated',
          'user',
          ${input.actorId},
          'Filing reference and confirmation proof updated.',
          ${tx.json({
            filingReference: input.filingReference,
            confirmationDocumentId: input.confirmationDocumentId,
          })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: current,
        companyId: lockedCase.company_id,
        actor,
        action: "update_filing_proof",
        summary: "Filing reference and confirmation proof updated.",
        metadata: {
          filingReference: input.filingReference,
          confirmationDocumentId: input.confirmationDocumentId,
        },
      });
    });

    return hydratedCaseAfterMutation(input.caseId, "filing proof update");
  }

  async function assertCanMutateCase(
    caseId: string,
    actorId: string,
    action: AnnualReturnAction,
  ): Promise<void> {
    const current = await getCase(caseId);

    if (!current) {
      throw new Error("Annual return case not found.");
    }

    assertCaseIsWritable(current);

    await withTransaction(sql, async (tx) => {
      const lockedCase = await lockWritableCase(tx, caseId);
      await assertActorCanMutateLockedCase(tx, actorId, lockedCase, action);
    });
  }

  async function evaluateReminders(
    now: string = readToday(),
  ): Promise<{ sent: number; skipped: number }> {
    const candidates = await listCasesForToday({ limit: DASHBOARD_METRICS_SCAN_LIMIT }, now);
    const openCases = candidates.filter(
      (case_) => case_.currentStatus !== "Filed" && case_.currentStatus !== "Completed",
    );

    let sent = 0;
    let skipped = 0;

    for (const case_ of openCases) {
      const outcome = await withTransaction(sql, async (tx) => {
        const lockedCase = await tryLockWritableCase(tx, case_.id);
        if (!lockedCase) return null;
        // openCases is a snapshot taken before this loop started. tryLockWritableCase's
        // WHERE clause re-checks locked_at/completed_at/<> 'Completed', but 'Filed' is a
        // distinct, earlier status than 'Completed' in this workflow, so a case a staff
        // member marks Filed while an earlier case in this same sweep is still processing
        // would otherwise pass the fresh re-fetch and receive a live client-facing
        // reminder about a case that no longer needs one.
        if (lockedCase.current_status === "Filed") return null;

        const firedRows = await tx<{ milestone: ReminderMilestone }[]>`
          select milestone from annual_return_reminder_events where case_id = ${case_.id}
        `;
        const milestone = dueMilestone(
          case_.filingDueDate,
          now,
          firedRows.map((row) => row.milestone),
        );
        if (!milestone) return null;

        const insertedEvent = await tx<{ id: string }[]>`
          insert into annual_return_reminder_events (case_id, milestone, occurred_at)
          values (${case_.id}, ${milestone}, ${now})
          on conflict (case_id, milestone) do nothing
          returning id
        `;
        if (!insertedEvent[0]) return null;

        const contactRows = await tx<
          { name: string; email: string | null; phone: string | null }[]
        >`
          select name, email, phone from company_contacts
          where company_id = ${lockedCase.company_id} and is_primary = true
          limit 1
        `;
        const contact = contactRows[0];

        if (!contact) {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_skipped',
              'system', null, 'Automated reminder skipped: no primary contact on file.',
              ${tx.json({ milestone, reason: "no_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        const channel: "whatsapp" | "email" = contact.phone ? "whatsapp" : "email";
        const recipient = contact.phone ?? contact.email;

        // company_contacts only guarantees email IS NOT NULL OR phone IS NOT NULL, not
        // that either is a non-empty string, so this is reachable on a data anomaly (e.g.
        // phone: ''). withTransaction's `for` loop has no try/catch around it, so throwing
        // here would propagate out of the whole evaluateReminders() call and silently
        // abandon every case still queued behind this one for the rest of the sweep.
        // Skip this case the same way an entirely missing contact is skipped above.
        if (!recipient) {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_skipped',
              'system', null, 'Automated reminder skipped: primary contact has neither phone nor email.',
              ${tx.json({ milestone, reason: "unreachable_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        await enqueueNotification(tx, {
          companyId: lockedCase.company_id,
          channel,
          notificationType: `annual_return_reminder_${milestone}`,
          recipient,
          payload: {
            caseId: case_.id,
            milestone,
            subject: `「${case_.companyName}」周年申報表提醒 — 請於 ${case_.filingDueDate} 前提供文件`,
            body: buildReminderDraft(case_, contact.name, now),
          },
        });

        await tx`
          update annual_return_cases
          set reminders_sent = reminders_sent + 1,
              current_status = case
                when current_status = 'Upcoming' then 'Client reminder sent'
                else current_status
              end,
              updated_at = now()
          where id = ${case_.id}
        `;

        await tx`
          insert into timeline_events (
            company_id, case_id, event_type, actor_type, actor_id, description, metadata
          ) values (
            ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_sent',
            'system', null, 'Automated reminder sent.',
            ${tx.json({ milestone, channel })}
          )
        `;

        return "sent" as const;
      });

      if (outcome === "sent") sent += 1;
      else if (outcome === "skipped") skipped += 1;
    }

    return { sent, skipped };
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) {
      await sql.end();
    }
  }

  return {
    listCases,
    getCase,
    listCompaniesEligibleForCase,
    createCase,
    dashboardMetrics,
    assertCanMutateCase,
    evaluateReminders,
    assignOwner,
    listNotes,
    addNote,
    updateStatus,
    recordReminder,
    updateChecklistItem,
    updatePayment,
    updateFilingProof,
    close,
  };
}
