import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import {
  buildRequirementInstances,
  checklistLookupFor,
  type PartyType,
  type RequirementInstanceDraft,
} from "./requirement-template";
import { shouldChaseClient } from "./outstanding";
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
import { toHongKongBusinessDate } from "@/lib/hong-kong-time";
import { dueMilestone, type ReminderMilestone } from "./reminder-cadence";
import { parseAnnualReturnReminderKey } from "./reminder-idempotency-key";
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
import type { AuditEventRow, AssignmentEventRow } from "./case-history";
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
import { documentSafetyOf } from "@/features/documents/safety";
import type { DocumentStatus, ScanVerdictSource } from "@/features/documents/types";
import type {
  RequirementApplicability,
  RequirementEvidenceState,
  RequirementInstanceState,
} from "./requirements";

type CaseRow = {
  id: string;
  company_id: string;
  company_team_id: string;
  company_name: string;
  data_origin: import("@/features/clients/data-origin").CompanyDataOrigin;
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
  data_origin: import("@/features/clients/data-origin").CompanyDataOrigin;
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
  /** Server only allows an active Admin to request diagnostic fixture scope. */
  includeFixtures?: boolean;
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
  /**
   * Free text over company name and CR number, as a SQL predicate.
   *
   * It used to be a client-side filter over whatever the 200-row page happened
   * to contain -- board-filters.ts said so in its own comment -- so a case at
   * row 201 could not be found by typing its name, and the owner dropdown that
   * might have narrowed the query was itself built from the same truncated page.
   */
  q?: string;
  /** Keyset position from a previous page. Opaque to the caller. */
  cursor?: string;
  limit?: number;
};

/**
 * A page of cases plus where to resume.
 *
 * `nextCursor` comes from the SQL rows, before the post-hydration `risk` filter
 * runs, so "is there more" stays correct even when a page returns fewer rows
 * than were asked for.
 */
export type AnnualReturnCasePage = {
  cases: AnnualReturnCase[];
  nextCursor: string | null;
};

export type BoardTotals = {
  total: number;
  overdue: number;
  dueIn7: number;
  dueIn30: number;
  missingDocuments: number;
  paymentPending: number;
};

/**
 * The keyset is the full sort key, because none of its parts is unique on its
 * own: two cases share a due date constantly, and two companies can share a
 * name. Without the id a page boundary would silently skip or repeat rows.
 *
 * Base64url of the three parts, so the cursor stays opaque to the caller and
 * carries no separator a company name could contain.
 */
export function encodeCaseCursor(row: {
  filing_due_date: string | Date;
  company_name: string;
  id: string;
}): string {
  // selectCaseRows casts the column to text, but the row type still admits a Date
  // because other reads of the same table do not. Normalising here keeps the
  // cursor a date-only string whichever shape arrives.
  const dueDate =
    typeof row.filing_due_date === "string"
      ? row.filing_due_date.slice(0, 10)
      : row.filing_due_date.toISOString().slice(0, 10);
  const payload = JSON.stringify([dueDate, row.company_name, row.id]);
  return btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeCaseCursor(
  cursor: string | undefined,
): { dueDate: string; companyName: string; id: string } | null {
  if (!cursor) return null;
  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [dueDate, companyName, id] = parsed;
    if (typeof dueDate !== "string" || typeof companyName !== "string" || typeof id !== "string") {
      return null;
    }
    // A cursor arrives from the client, so its shape is checked rather than
    // trusted -- it goes straight into a SQL comparison.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { dueDate, companyName, id };
  } catch {
    return null;
  }
}

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
  dataOrigin?: import("@/features/clients/data-origin").CompanyDataOrigin | null;
  crNumber: string;
  annualReturnBasisDate: string;
  assignedOwnerId: string;
  assignedTeamId: string;
  assignedTeamName: string;
};

/**
 * A staff member an actor may name as an owner or reviewer.
 *
 * Exists so the case screen can offer people by name. It asked for an "Owner ID"
 * in a text box and validated it with isUuid, which meant assigning a case
 * required knowing a database identifier -- the plan's "no ordinary action needs
 * a UUID" is exactly this.
 */
export type AssignableStaffMember = {
  id: string;
  name: string;
  role: "Admin" | "Manager" | "Staff";
  teamId: string | null;
  teamName: string | null;
};

export type CreateAnnualReturnCaseInput = {
  companyId: string;
  templateId: string;
  ownerId: string;
  invoiceNumber: string;
  feeAmount: number;
  actorId: string;
};

export type CasePartyRecord = {
  id: string;
  caseId: string;
  officerId: string | null;
  partyType: PartyType;
  displayName: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  active: boolean;
};

export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  listCaseRequirements(caseId: string): Promise<RequirementInstanceState[]>;
  /**
   * Materialises the approved template's instances for a case.
   *
   * Insert-only, deliberately. An instance can carry a human decision -- a
   * waiver, a not-applicable with a reason, an authorising user -- and a sync
   * that deleted rows the template no longer produces would erase that decision
   * the first time a director was removed from the party list. Pruning stale
   * instances is a separate action a person takes, not a side effect of
   * recomputing the template.
   *
   * Idempotent: the two partial unique indexes from migration 0026 make a repeat
   * run a no-op rather than a duplicate.
   */
  syncRequirementInstances(
    caseId: string,
    drafts: readonly RequirementInstanceDraft[],
  ): Promise<{ created: number }>;
  /**
   * Creates candidate parties from the company's officer register.
   *
   * Nothing wrote case_parties at all, so the per-party requirement model Phase B
   * built was unreachable: no party ever existed, and only company-level
   * requirements could ever be produced.
   *
   * Candidates, not parties. Every row lands unconfirmed, because `case_parties`
   * states the rule plainly -- "a requirement must never be judged complete or
   * incomplete against a guess about who the parties are". The register is
   * evidence about who the officers are; it is not a person confirming that these
   * are the parties for this filing.
   *
   * Serving officers only (cessation_date is null), and insert-only: the partial
   * unique index on (case_id, officer_id) makes a repeat run a no-op rather than
   * a duplicate, and a party somebody has already confirmed is never rewritten.
   */
  syncCasePartiesFromOfficers(caseId: string): Promise<{ created: number }>;
  listCaseParties(caseId: string): Promise<CasePartyRecord[]>;
  /**
   * A person confirms a party, and the requirements that party owes appear.
   *
   * The sync runs in the same transaction as the confirmation: a confirmed party
   * whose requirements were never created would read as a party owing nothing,
   * which is precisely the false-completeness this model exists to prevent.
   */
  confirmCaseParty(input: {
    caseId: string;
    partyId: string;
    confirmedByUserId: string;
  }): Promise<{ confirmed: boolean; requirementsCreated: number }>;
  listCasePage(filters: CaseFilters): Promise<AnnualReturnCasePage>;
  listAllCases(
    filters: CaseFilters,
    options?: { pageSize?: number; maxPages?: number },
  ): Promise<AnnualReturnCase[]>;
  boardTotals(filters: CaseFilters): Promise<BoardTotals>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  listCompaniesEligibleForCase(filters?: {
    includeFixtures?: boolean;
  }): Promise<EligibleCompanyForCase[]>;
  listAssignableStaff(scope: { teamId?: string }): Promise<AssignableStaffMember[]>;
  createCase(input: CreateAnnualReturnCaseInput): Promise<AnnualReturnCase>;
  dashboardMetrics(
    today: string,
    currentUserId: string,
    scope?: CaseFilters,
  ): Promise<AnnualReturnDashboardMetrics>;
  assertCanMutateCase(caseId: string, actorId: string, action: AnnualReturnAction): Promise<void>;
  /** A Hong Kong business date (YYYY-MM-DD); a full ISO instant is normalised to one. */
  evaluateReminders(businessDateOrInstant?: string): Promise<{ sent: number; skipped: number }>;
  updateStatus(
    caseId: string,
    nextStatus: AnnualReturnStatus,
    actorId: string,
  ): Promise<AnnualReturnCase>;
  assignOwner(input: AssignAnnualReturnOwnerInput): Promise<AnnualReturnCase>;
  listNotes(caseId: string): Promise<AnnualReturnCaseNote[]>;
  listAuditEventsForCase(caseId: string): Promise<AuditEventRow[]>;
  listAssignmentEventsForCase(caseId: string): Promise<AssignmentEventRow[]>;
  addNote(input: AddAnnualReturnCaseNoteInput): Promise<AnnualReturnCaseNote>;
  /**
   * The phone numbers the firm already holds for a company.
   *
   * Exists so an outbound message can be checked against the recipients the firm
   * actually has a relationship with, rather than trusting a number typed into a
   * form: a manual reminder carries the client's company name and statutory due
   * date, and a mistyped digit sends that to a stranger.
   */
  listCompanyContactPhones(companyId: string): Promise<string[]>;
  /**
   * Retracts the "client reminder sent" claim for a reminder whose outbox row can
   * never be delivered, and records the failure where a person will see it.
   * Driven by evaluateReminders, which is what the five-minute cron calls.
   */
  reconcileFailedReminders(now: string): Promise<{ retracted: number }>;
  recordReminder(input: RecordAnnualReturnReminderInput): Promise<AnnualReturnCase>;
  updateChecklistItem(input: UpdateAnnualReturnChecklistItemInput): Promise<AnnualReturnCase>;
  /**
   * Record that a document satisfies the requirement instances on a checklist
   * item.
   *
   * `requirement_evidence_links` had exactly one writer in the whole repository
   * -- the one-shot backfill inside migration 0026 -- so every instance created
   * at runtime afterwards was unsatisfiable: `listCaseRequirements` reads
   * evidence only through this table, and `requirementStatusOf` returns
   * "satisfied" only when an evidence entry exists. A document could be
   * uploaded, scanned and approved and its requirement still reported
   * `outstanding`, permanently. Two design specs asserted the opposite.
   */
  linkRequirementEvidence(input: {
    caseId: string;
    checklistItemId: string;
    documentId: string;
    linkedBy: string;
  }): Promise<{ linked: number }>;
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

/**
 * Row cap for each of the two case-history sources (audit events and
 * assignment events), applied independently in listAuditEventsForCase and
 * listAssignmentEventsForCase. Because the cap is per-source, a case whose
 * audit and assignment event counts both exceed this limit can produce a
 * merged history whose tail looks quieter than it really was: the recent
 * activity truncation is invisible in the merged list. This is a known,
 * accepted limitation — see the design spec's "Explicitly out of scope"
 * section on pagination — not a bug, but it must stay visible here rather
 * than only in that doc.
 */
export const CASE_HISTORY_ROW_LIMIT = 200;

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
    dataOrigin: row.data_origin,
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
        c.data_origin,
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
    // Escaped so a name containing % or _ matches literally rather than turning
    // into a wildcard the user did not type.
    const query = filters.q?.trim()
      ? `%${filters.q.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
      : null;
    const cursor = decodeCaseCursor(filters.cursor);

    return sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.assigned_team_id as company_team_id,
        c.company_name,
        c.data_origin,
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
        and (${filters.includeFixtures === true} or c.data_origin <> 'fixture')
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
        and (
          ${query}::text is null
          or c.company_name ilike ${query} escape '\\'
          or c.cr_number ilike ${query} escape '\\'
        )
        and (
          ${cursor === null}
          or (arc.filing_due_date, c.company_name, arc.id)
             > (${cursor?.dueDate ?? null}::date, ${cursor?.companyName ?? ""}, ${cursor?.id ?? null}::uuid)
        )
      -- arc.id is part of the sort key, not decoration: without it the keyset
      -- has no unique tiebreaker and a page boundary silently skips or repeats
      -- rows whenever two cases share a due date and company name.
      order by arc.filing_due_date asc, c.company_name asc, arc.id asc
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

  /**
   * Requirement instances for one case, with their parties and evidence.
   *
   * Evidence carries both dimensions -- the reviewer's decision and the scan
   * verdict source -- because a requirement is only answered when both agree,
   * and the scan verdict lives on the upload intent rather than the document.
   */
  async function listCaseRequirements(caseId: string): Promise<RequirementInstanceState[]> {
    const rows = await sql<
      {
        id: string;
        checklist_item_id: string;
        party_id: string | null;
        party_name: string | null;
        requirement_key: string;
        applicability: RequirementApplicability;
        applicability_reason: string | null;
        document_id: string | null;
        review_status: "pending" | "verified" | "rejected" | null;
        upload_status: DocumentStatus | null;
        scan_verdict_source: ScanVerdictSource | null;
        page_from: number | null;
        page_to: number | null;
      }[]
    >`
      select
        r.id,
        r.checklist_item_id,
        r.party_id,
        p.display_name as party_name,
        r.requirement_key,
        r.applicability,
        r.applicability_reason,
        d.id as document_id,
        d.verification_status as review_status,
        i.status as upload_status,
        i.scan_verdict_source,
        l.page_from,
        l.page_to
      from case_requirement_instances r
      left join case_parties p on p.id = r.party_id
      left join requirement_evidence_links l on l.requirement_instance_id = r.id
      left join documents d on d.id = l.document_id
      left join document_upload_intents i on i.document_id = d.id
      where r.case_id = ${caseId}
      order by p.display_name asc nulls first, r.requirement_key asc, l.created_at asc
    `;

    // One row per evidence link, so instances are folded back together here
    // rather than issuing a query per requirement.
    const byId = new Map<string, RequirementInstanceState>();
    for (const row of rows) {
      let instance = byId.get(row.id);
      if (!instance) {
        instance = {
          id: row.id,
          checklistItemId: row.checklist_item_id,
          partyId: row.party_id,
          partyName: row.party_name,
          requirementKey: row.requirement_key,
          applicability: row.applicability,
          applicabilityReason: row.applicability_reason,
          evidence: [],
        };
        byId.set(row.id, instance);
      }
      if (!row.document_id || !row.review_status) continue;
      (instance.evidence as RequirementEvidenceState[]).push({
        documentId: row.document_id,
        reviewStatus: row.review_status,
        safety: documentSafetyOf({
          uploadStatus: row.upload_status ?? "created",
          scanVerdictSource: row.scan_verdict_source,
        }),
        pageFrom: row.page_from,
        pageTo: row.page_to,
      });
    }
    return [...byId.values()];
  }

  async function listCases(filters: CaseFilters): Promise<AnnualReturnCase[]> {
    return listCasesForToday(filters, readToday());
  }

  /**
   * One page, plus where to resume.
   *
   * `nextCursor` is taken from the last SQL row, before the post-hydration `risk`
   * filter runs. Deriving it from the returned cases instead would stall
   * pagination the moment a whole page was filtered out, and deriving "has more"
   * from `cases.length === limit` would be wrong for the same reason -- which is
   * how the board's "Showing the first 200" warning could be absent while
   * truncation had happened.
   */
  async function listCasePage(filters: CaseFilters): Promise<AnnualReturnCasePage> {
    const today = readToday();
    const rows = await selectCaseRows(filters, today);
    const limit = filters.limit ?? DEFAULT_CASE_LIMIT;
    const hydrated = await hydrateCases(rows, today);
    const cases = hydrated.filter((case_) => caseMatchesHydratedFilters(case_, filters));
    const last = rows.at(-1);
    return {
      cases,
      nextCursor: rows.length === limit && last ? encodeCaseCursor(last) : null,
    };
  }

  /**
   * Every case matching the filters, drained page by page.
   *
   * For callers that must not silently stop at a page boundary. The production
   * WhatsApp follow-up drafts were built from `listCases({})`, which is the 200
   * earliest-due cases, so every client past that row was never chased at all --
   * a correctness bug rather than a display one.
   */
  async function listAllCases(
    filters: CaseFilters,
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<AnnualReturnCase[]> {
    const pageSize = options.pageSize ?? DEFAULT_CASE_LIMIT;
    // A ceiling so a bug here cannot become an unbounded scan; at the default
    // page size this is 20,000 cases, far beyond any real firm's book.
    const maxPages = options.maxPages ?? 100;
    const all: AnnualReturnCase[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await listCasePage({ ...filters, limit: pageSize, cursor });
      all.push(...result.cases);
      if (!result.nextCursor) return all;
      cursor = result.nextCursor;
    }
    return all;
  }

  /**
   * Board tiles, counted in SQL over the whole authorized scope.
   *
   * They were computed in the browser over the same truncated page the board
   * rendered, so "12 overdue" meant "12 overdue among the 200 earliest-due cases
   * we happened to load".
   *
   * `highRisk` is deliberately absent. riskForCase derives it from checklist,
   * payment and filing state, and reproducing that in SQL is exactly the drift
   * the selectCaseRows comment already warns about -- so the caller shows it as
   * covering the loaded page rather than the scope.
   */
  async function boardTotals(filters: CaseFilters): Promise<BoardTotals> {
    const today = readToday();
    // Deliberately ignores `q` and `cursor`: these are the totals for the
    // actor's scope, not for whatever they have typed into the search box, and
    // the caller labels them that way.
    const counted = await sql<
      {
        total: string;
        overdue: string;
        due_in_7: string;
        due_in_30: string;
        missing_documents: string;
        payment_pending: string;
      }[]
    >`
      select
        count(*) total,
        count(*) filter (where arc.filing_due_date < ${today}::date) overdue,
        count(*) filter (
          where arc.filing_due_date >= ${today}::date
            and arc.filing_due_date <= ${today}::date + 7
        ) due_in_7,
        count(*) filter (
          where arc.filing_due_date >= ${today}::date
            and arc.filing_due_date <= ${today}::date + 30
        ) due_in_30,
        count(*) filter (
          where exists (
            select 1 from annual_return_checklist_items i
            where i.case_id = arc.id and i.required = true
              and (
                i.status <> 'Verified' or i.received_at is null
                or i.verified_at is null or i.document_id is null
              )
          )
        ) missing_documents,
        count(*) filter (
          where exists (
            select 1 from payments p
            where p.case_id = arc.id and p.status = 'Payment pending'
          )
        ) payment_pending
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      where (${filters.ownerId ?? null}::uuid is null or arc.owner_id = ${filters.ownerId ?? null}::uuid)
        and (${filters.includeFixtures === true} or c.data_origin <> 'fixture')
        and (${filters.teamId ?? null}::uuid is null or c.assigned_team_id = ${filters.teamId ?? null}::uuid)
        and (${filters.reviewerId ?? null}::uuid is null or arc.reviewer_id = ${filters.reviewerId ?? null}::uuid)
        and (${filters.status ?? null}::text is null or arc.current_status = ${filters.status ?? null})
        and (
          ${filters.visibleToUserId ?? null}::uuid is null
          or arc.owner_id = ${filters.visibleToUserId ?? null}::uuid
          or arc.reviewer_id = ${filters.visibleToUserId ?? null}::uuid
        )
        and (
          ${filters.companyIds ? [...filters.companyIds] : null}::uuid[] is null
          or arc.company_id = any(${filters.companyIds ? [...filters.companyIds] : null}::uuid[])
        )
    `;
    const row = counted[0];
    return {
      total: Number(row?.total ?? 0),
      overdue: Number(row?.overdue ?? 0),
      dueIn7: Number(row?.due_in_7 ?? 0),
      dueIn30: Number(row?.due_in_30 ?? 0),
      missingDocuments: Number(row?.missing_documents ?? 0),
      paymentPending: Number(row?.payment_pending ?? 0),
    };
  }

  async function getCase(id: string): Promise<AnnualReturnCase | null> {
    const rows = await sql<CaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.assigned_team_id as company_team_id,
        c.company_name,
        c.data_origin,
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

  async function listCompaniesEligibleForCase(
    filters: { includeFixtures?: boolean } = {},
  ): Promise<EligibleCompanyForCase[]> {
    const rows = await sql<EligibleCompanyRow[]>`
      select
        c.id,
        c.company_name,
        c.data_origin,
        c.cr_number,
        c.annual_return_basis_date::text as annual_return_basis_date,
        c.assigned_owner_id,
        c.assigned_team_id,
        t.name as team_name
      from companies c
      join teams t on t.id = c.assigned_team_id
      where c.status = 'active'
        and (${filters.includeFixtures ?? false}::boolean or c.data_origin <> 'fixture')
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
      dataOrigin: row.data_origin,
      crNumber: row.cr_number,
      annualReturnBasisDate: dateOnly(row.annual_return_basis_date),
      assignedOwnerId: row.assigned_owner_id,
      assignedTeamId: row.assigned_team_id,
      assignedTeamName: row.team_name,
    }));
  }

  /**
   * Scoped so the picker never offers a person the server would then refuse:
   * assertAnnualReturnCaseCreatable and getAnnualReturnActionPermission both
   * narrow by team for anyone who is not an Admin, so the list narrows the same
   * way. An inactive user is never offered.
   */
  async function listAssignableStaff(scope: { teamId?: string }): Promise<AssignableStaffMember[]> {
    const rows = await sql<
      {
        id: string;
        name: string;
        role: "Admin" | "Manager" | "Staff";
        team_id: string | null;
        team_name: string | null;
      }[]
    >`
      select u.id, u.name, u.role, u.team_id, t.name as team_name
      from users u
      left join teams t on t.id = u.team_id
      where u.active = true
        and (${scope.teamId ?? null}::uuid is null or u.team_id = ${scope.teamId ?? null})
      order by u.name asc
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      teamId: row.team_id,
      teamName: row.team_name,
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
          where annual_return_case_id = ${input.caseId}
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

  async function listAuditEventsForCase(caseId: string): Promise<AuditEventRow[]> {
    return sql<AuditEventRow[]>`
      select
        e.id, e.actor_id, u.name as actor_name, e.actor_role,
        e.action, e.result, e.summary, e.metadata, e.created_at
      from annual_return_audit_events e
      left join users u on u.id = e.actor_id
      where e.case_id = ${caseId}
      order by e.created_at desc, e.id desc
      -- See CASE_HISTORY_ROW_LIMIT: capped independently of the assignment
      -- events query, so a case with more audit events than this limit but
      -- few assignment events can look like recent activity went quiet.
      limit ${CASE_HISTORY_ROW_LIMIT}
    `;
  }

  async function listAssignmentEventsForCase(caseId: string): Promise<AssignmentEventRow[]> {
    return sql<AssignmentEventRow[]>`
      select
        a.id, a.work_item_id,
        a.previous_assignee_id, pu.name as previous_assignee_name,
        a.assigned_to_id, tu.name as assigned_to_name,
        a.assigned_by_id, bu.name as assigned_by_name,
        a.decision, a.override_reason, a.recommendation_rank, a.recommendation_score,
        a.recommendation_factors, a.created_at
      from assignment_events a
      join work_items w on w.id = a.work_item_id
      left join users pu on pu.id = a.previous_assignee_id
      join users tu on tu.id = a.assigned_to_id
      join users bu on bu.id = a.assigned_by_id
      where w.annual_return_case_id = ${caseId}
      order by a.created_at desc, a.id desc
      -- See CASE_HISTORY_ROW_LIMIT: capped independently of the audit events
      -- query, so a case with more assignment events than this limit but few
      -- audit events can look like recent activity went quiet.
      limit ${CASE_HISTORY_ROW_LIMIT}
    `;
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

  async function listCompanyContactPhones(companyId: string): Promise<string[]> {
    const rows = await sql<{ phone: string }[]>`
      select phone from company_contacts
      where company_id = ${companyId} and phone is not null
    `;
    return rows.map((row) => row.phone);
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

  /**
   * Written as one statement whose joins ARE the authorization.
   *
   * The instance, the checklist item and the document must all agree on the same
   * case. A caller that checked "may this actor see case X" and then inserted by
   * id alone could pair a visible case with a document from a case the actor
   * cannot see; keeping the check and the write in one statement leaves nothing
   * to slip between them -- the same shape `confirmCaseParty` uses.
   *
   * `on conflict do nothing` against requirement_evidence_links_uidx, so a
   * second review of the same item is a no-op rather than a duplicate.
   */
  async function linkRequirementEvidence(input: {
    caseId: string;
    checklistItemId: string;
    documentId: string;
    linkedBy: string;
  }): Promise<{ linked: number }> {
    const rows = await sql<{ id: string }[]>`
      insert into requirement_evidence_links (
        requirement_instance_id, document_id, linked_by, note
      )
      select r.id, d.id, ${input.linkedBy},
             'Linked when the checklist item was verified.'
      from case_requirement_instances r
      join annual_return_checklist_items i on i.id = r.checklist_item_id
      join documents d on d.id = ${input.documentId}
      where r.checklist_item_id = ${input.checklistItemId}
        and r.case_id = ${input.caseId}
        and i.case_id = ${input.caseId}
        and d.case_id = ${input.caseId}
      on conflict do nothing
      returning id
    `;
    return { linked: rows.length };
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

  /**
   * Retracts "we reminded this client" for a reminder that can never be sent.
   *
   * reminders_sent + 1, the 'Client reminder sent' status and the
   * "Automated reminder sent." timeline event are all written in the ENQUEUE
   * transaction, because that is the only moment this sweep is still holding the
   * case. Nothing was dispatched at that point, and if the outbox row later failed
   * terminally nothing reconciled it: the milestone was already spent, so
   * dueMilestone never fired again, and the case went on telling staff -- and any
   * audit of the firm -- that a statutory reminder had gone out when none had.
   *
   * The claim is retracted rather than deferred to markSent because the dispatcher
   * is generic over every producer and knows nothing about annual-return cases;
   * teaching it would couple the outbox to one feature. The window is one cron
   * tick's worth of optimism, and it closes with a visible failure rather than
   * with silence.
   *
   * Deliberately NOT re-firing the milestone: the failed outbox row still holds
   * this reminder's idempotency key, so a re-enqueue would deduplicate against it
   * and count as sent all over again. A permanent failure is a thing a person has
   * to look at, which is what the timeline event is for.
   *
   * Keyed on idempotency_key rather than on the payload because retention nulls
   * the payload, and a row redacted before anyone reconciled it would silently
   * keep the false claim forever.
   */
  async function reconcileFailedReminders(now: string): Promise<{ retracted: number }> {
    const rows = await sql<
      { idempotency_key: string; outbox_id: string; outcome_unknown: boolean }[]
    >`
      select
        -- The whole key, parsed in TypeScript rather than pulled apart with
        -- split_part here. Two key shapes carry this prefix and segment 3 is the
        -- milestone in only one of them; in the other it is the client's phone
        -- number, which this function used to write into the timeline as
        -- "milestone" -- mislabelled, and outside the outbox's 90-day redaction.
        idempotency_key,
        id as outbox_id,
        -- 'dispatch_outcome_unknown' is failStranded saying the provider MAY
        -- already hold the message. Such a row is 'failed' with its attempts
        -- spent, so it matched this selector exactly and was retracted as a
        -- definite non-delivery. It gets its own arm below instead.
        last_error_code = 'dispatch_outcome_unknown' as outcome_unknown
      from notification_outbox
      where idempotency_key like 'annual-return-reminder:%'
        and (
          status = 'cancelled'
          or (status = 'failed' and attempt_count >= max_attempts)
        )
        -- Already-retracted rows are excluded HERE, not merely skipped inside the
        -- loop. Nothing about reconciling a row changes it: redactExpired leaves
        -- idempotency_key alone, so it keeps matching the prefix forever, and
        -- because it is settled its updated_at never moves again -- which puts it
        -- permanently at the front of "order by updated_at asc". Past 200 settled
        -- reminders the window is entirely historical and a reminder that fails
        -- tomorrow never reaches the loop at all, so the case goes on claiming the
        -- client was reminded. The per-row dedupe cannot catch that; only this can.
        --
        -- BOTH outcomes are excluded here, not just the retraction: a row this
        -- pass has already recorded as unresolved is as settled as one it has
        -- retracted, and leaving it in the window would starve out new failures
        -- exactly the same way.
        and not exists (
          select 1 from timeline_events
          where event_type in (
              'annual_return_reminder_failed',
              'annual_return_reminder_outcome_unknown'
            )
            and metadata->>'outboxId' = notification_outbox.id::text
        )
      order by updated_at asc
      limit 200
    `;

    let retracted = 0;
    for (const row of rows) {
      // `${row.case_id}::uuid` was the FIRST statement of every transaction here,
      // on a value taken straight out of a key this function does not own. A
      // producer using this prefix with a non-uuid second segment therefore threw
      // before anything else ran -- and because the row is settled it never goes
      // away, so the reminder sweep would die on it on every five-minute tick,
      // forever. That is the failure mode the cancelFixtureOriginNotifications
      // comment above warns about, and the fix is the same: skip the row, say so,
      // and carry on reconciling the rest.
      const parsed = parseAnnualReturnReminderKey(row.idempotency_key);
      if (!parsed) {
        console.error(
          `Skipping annual-return reminder reconciliation for outbox row ${row.outbox_id}: malformed idempotency key.`,
        );
        continue;
      }
      const caseId = parsed.caseId;

      const applied = await withTransaction(sql, async (tx) => {
        const caseRows = await tx<{ id: string; company_id: string }[]>`
          select id, company_id from annual_return_cases where id = ${caseId}::uuid for update
        `;
        if (!caseRows[0]) return false;

        // The ordinary case: the outbox is certain nothing was delivered.
        if (!row.outcome_unknown) {
          // One retraction per outbox row, whatever else shares the case. Without
          // this the counter would be decremented again on every five-minute tick.
          const inserted = await tx<{ id: string }[]>`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            )
            select
              ${caseRows[0].company_id}, ${caseId}::uuid, 'annual_return_reminder_failed',
              'system', null,
              'Automated reminder could not be delivered. The client has NOT been reminded.',
              -- Built from the parsed key and nothing else, so a manual reminder's
              -- phone number can no longer arrive here labelled as a milestone.
              ${tx.json({ milestone: parsed.milestone, outboxId: row.outbox_id, reconciledAt: now })}
            where not exists (
              select 1 from timeline_events
              where case_id = ${caseId}::uuid
                and event_type = 'annual_return_reminder_failed'
                and metadata->>'outboxId' = ${row.outbox_id}
            )
            returning id
          `;
          if (!inserted[0]) return false;

          await tx`
            update annual_return_cases
            set reminders_sent = greatest(reminders_sent - 1, 0),
                -- Only the status this sweep itself set is rolled back. A person may
                -- have moved the case on since, and undoing their work to correct our
                -- bookkeeping would be the worse error.
                current_status = case
                  when current_status = 'Client reminder sent' then 'Upcoming'
                  else current_status
                end,
                updated_at = now()
            where id = ${caseId}::uuid
          `;
          return true;
        }

        // 'dispatch_outcome_unknown': deliberately no decrement and no status
        // rollback. The outbox says the provider may already hold this message, so
        // asserting either "sent" or "not sent" would be a guess -- and the
        // retraction arm above guesses the one direction that tells a client's
        // case file they were never reminded when they may be holding the message.
        // The counter already reads as sent; the one honest action left is to put
        // the doubt on the record where a person will see it and decide.
        const noted = await tx<{ id: string }[]>`
          insert into timeline_events (
            company_id, case_id, event_type, actor_type, actor_id, description, metadata
          )
          select
            ${caseRows[0].company_id}, ${caseId}::uuid,
            'annual_return_reminder_outcome_unknown',
            'system', null,
            'A send was begun for this automated reminder and no outcome was recorded. Whether the client received it could not be determined -- please check before reminding again.',
            ${tx.json({ milestone: parsed.milestone, outboxId: row.outbox_id, reconciledAt: now })}
          where not exists (
            select 1 from timeline_events
            where case_id = ${caseId}::uuid
              and event_type = 'annual_return_reminder_outcome_unknown'
              and metadata->>'outboxId' = ${row.outbox_id}
          )
          returning id
        `;
        return Boolean(noted[0]);
      });
      if (applied) retracted += 1;
    }

    return { retracted };
  }

  async function evaluateReminders(
    businessDateOrInstant: string = readToday(),
  ): Promise<{ sent: number; skipped: number }> {
    // Normalised here, not only at the call site. The parameter feeds a `date`
    // comparison and a day count the client reads, so a caller that hands down
    // a raw cron instant must not be able to make this sweep run on the UTC day:
    // 16:00Z onward is already tomorrow in Hong Kong.
    const now = toHongKongBusinessDate(businessDateOrInstant);
    // Before this tick's enqueues, so a reminder that failed terminally since the
    // last tick stops claiming to have been sent as early as possible. Run here
    // rather than wired separately into maintenance: this is already the pass the
    // five-minute cron calls, and a reconciliation nobody scheduled is a
    // reconciliation that never runs.
    await reconcileFailedReminders(now);

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

        /**
         * Records a skip WITHOUT consuming the milestone, once per reason.
         *
         * The milestone row used to be inserted here, before any of the skip
         * checks below, and those checks commit -- so a case skipped for having no
         * primary contact spent its milestone on a reminder that was never sent.
         * dueMilestone never fired again, and adding the contact the next day
         * changed nothing: the client simply was not reminded before their
         * statutory deadline.
         *
         * Not consuming it means the sweep re-evaluates this case every five
         * minutes until the condition clears, so the timeline event is written
         * only when an identical one is not already there. Otherwise the history
         * that is supposed to explain the silence would bury it.
         */
        const recordSkip = async (reason: string, description: string) => {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            )
            select
              ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_skipped',
              'system', null, ${description},
              ${tx.json({ milestone, reason })}
            where not exists (
              select 1 from timeline_events
              where case_id = ${case_.id}
                and event_type = 'annual_return_reminder_skipped'
                and metadata->>'milestone' = ${milestone}
                and metadata->>'reason' = ${reason}
            )
          `;
          return "skipped" as const;
        };

        // Does this client actually owe us anything?
        //
        // Phase B added outstanding.ts precisely so a document the client has
        // already sent is never chased for again -- Received sits unreviewed and
        // `Received !== "Verified"`, which is what made the old checks wrong.
        // But it was only wired into the paths that COMPOSE drafts: the portal,
        // the work views, the follow-up screen. This sweep is the one that
        // actually sends, on the five-minute cron, and it consulted nothing but
        // the case status. A client whose every required document was Received
        // still got a live reminder asking for them.
        //
        // Re-read under the lock rather than trusting the pre-loop snapshot: the
        // staleness window is small, but it runs in exactly the wrong direction
        // -- a document that arrived since the snapshot would be chased for.
        const checklistForChase = await tx<{ required: boolean; status: ChecklistStatus }[]>`
          select required, status from annual_return_checklist_items
          where case_id = ${case_.id}
        `;

        // `unknown` (no checklist rows at all) deliberately does NOT suppress.
        // A case whose requirements nobody has recorded is not evidence that
        // nothing is owed, and staying silent before a statutory deadline is the
        // worse error.
        if (!shouldChaseClient({ checklist: checklistForChase })) {
          return recordSkip(
            "nothing_outstanding",
            "Automated reminder skipped: nothing is outstanding from the client.",
          );
        }

        const contactRows = await tx<
          { name: string; email: string | null; phone: string | null }[]
        >`
          select name, email, phone from company_contacts
          where company_id = ${lockedCase.company_id} and is_primary = true
          limit 1
        `;
        const contact = contactRows[0];

        if (!contact) {
          return recordSkip(
            "no_primary_contact",
            "Automated reminder skipped: no primary contact on file.",
          );
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
          return recordSkip(
            "unreachable_primary_contact",
            "Automated reminder skipped: primary contact has neither phone nor email.",
          );
        }

        // Only now, with every reason to stay silent ruled out, is the milestone
        // spent. `on conflict do nothing` still makes a concurrent sweep a no-op,
        // so a milestone genuinely acted on is never acted on twice.
        const insertedEvent = await tx<{ id: string }[]>`
          insert into annual_return_reminder_events (case_id, milestone, occurred_at)
          values (${case_.id}, ${milestone}, ${now})
          on conflict (case_id, milestone) do nothing
          returning id
        `;
        if (!insertedEvent[0]) return null;

        const queued = await enqueueNotification(tx, {
          companyId: lockedCase.company_id,
          channel,
          notificationType: `annual_return_reminder_${milestone}`,
          recipient,
          // Scoped to the CASE, not just the company.
          //
          // The default key is company + type + recipient, and the type carries
          // only the milestone -- so next year's annual return for the same
          // company produced a byte-identical key. `on conflict do nothing`
          // matched last year's spent row, no message was queued, and the sweep
          // counted it as sent anyway. From the second year onward the client was
          // never reminded and the system reported that they were.
          //
          // One case per company per return year (unique on company_id,
          // return_year), so the case id is the period.
          idempotencyKey: `annual-return-reminder:${case_.id}:${milestone}:${channel}:${recipient}`,
          payload: {
            caseId: case_.id,
            milestone,
            subject: `「${case_.companyName}」周年申報表提醒 — 請於 ${case_.filingDueDate} 前提供文件`,
            body: buildReminderDraft(case_, contact.name, now),
          },
        });

        // A deduplicated enqueue is not a send. Counting one would repeat exactly
        // the accounting lie this key fixes.
        if (queued.idempotentReplay) {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_skipped',
              'system', null, 'Automated reminder skipped: an identical notification was already queued.',
              ${tx.json({ milestone, reason: "duplicate_notification" })}
            )
          `;
          return "skipped" as const;
        }

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

  async function syncRequirementInstances(
    caseId: string,
    drafts: readonly RequirementInstanceDraft[],
  ): Promise<{ created: number }> {
    if (drafts.length === 0) return { created: 0 };

    let created = 0;
    await withTransaction(sql, async (tx) => {
      for (const draft of drafts) {
        // `do nothing` against both partial unique indexes: (checklist_item_id,
        // party_id) where party_id is not null, and (checklist_item_id) where it
        // is null. A second run adds nothing and changes nothing.
        const rows = await tx<{ id: string }[]>`
          insert into case_requirement_instances (
            case_id, checklist_item_id, party_id, requirement_key, template_version, reference_date
          ) values (
            ${caseId}, ${draft.checklistItemId}, ${draft.partyId}, ${draft.requirementKey},
            ${draft.templateVersion}, ${draft.referenceDate}
          )
          on conflict do nothing
          returning id
        `;
        if (rows.length === 1) created += 1;
      }
    });

    return { created };
  }

  async function syncCasePartiesFromOfficers(caseId: string): Promise<{ created: number }> {
    const rows = await sql<{ id: string }[]>`
      insert into case_parties (case_id, officer_id, party_type, display_name)
      select c.id, o.id, o.officer_type, o.name
      from annual_return_cases c
      join officers o on o.company_id = c.company_id
      where c.id = ${caseId}
        -- Serving officers only. A director who has ceased is not a party to
        -- this filing, and the register records that with a cessation date.
        and o.cessation_date is null
      -- Unconfirmed by construction: confirmed_by and confirmed_at are left
      -- null, so buildRequirementInstances produces nothing for these until a
      -- person says they are right.
      on conflict do nothing
      returning id
    `;
    return { created: rows.length };
  }

  async function listCaseParties(caseId: string): Promise<CasePartyRecord[]> {
    const rows = await sql<
      {
        id: string;
        case_id: string;
        officer_id: string | null;
        party_type: PartyType;
        display_name: string;
        confirmed_by: string | null;
        confirmed_at: string | Date | null;
        active: boolean;
      }[]
    >`
      select id, case_id, officer_id, party_type, display_name, confirmed_by, confirmed_at, active
      from case_parties
      where case_id = ${caseId}
      order by party_type asc, display_name asc
    `;

    return rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      officerId: row.officer_id,
      partyType: row.party_type,
      displayName: row.display_name,
      confirmedByUserId: row.confirmed_by,
      confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at).toISOString(),
      active: row.active,
    }));
  }

  async function confirmCaseParty(input: {
    caseId: string;
    partyId: string;
    confirmedByUserId: string;
  }): Promise<{ confirmed: boolean; requirementsCreated: number }> {
    return withTransaction(sql, async (tx) => {
      // Scoped to the case in the UPDATE, so a party id from another case cannot
      // be confirmed by pairing it with a case the actor may see. The check and
      // the write are one statement; nothing can slip between them.
      const confirmedRows = await tx<{ id: string }[]>`
        update case_parties
        set confirmed_by = ${input.confirmedByUserId}, confirmed_at = now(), updated_at = now()
        where id = ${input.partyId}
          and case_id = ${input.caseId}
          and confirmed_by is null
        returning id
      `;
      if (confirmedRows.length === 0) return { confirmed: false, requirementsCreated: 0 };

      const partyRows = await tx<
        { id: string; party_type: PartyType; display_name: string; active: boolean }[]
      >`
        select id, party_type, display_name, active from case_parties where case_id = ${input.caseId}
      `;
      const confirmedIds = new Set(
        (
          await tx<{ id: string }[]>`
            select id from case_parties
            where case_id = ${input.caseId} and confirmed_by is not null
          `
        ).map((row) => row.id),
      );

      const checklistRows = await tx<{ id: string; item_label: string }[]>`
        select id, item_label from annual_return_checklist_items where case_id = ${input.caseId}
      `;
      const caseRows = await tx<{ made_up_date: string | Date }[]>`
        select made_up_date from annual_return_cases where id = ${input.caseId}
      `;

      const lookup = checklistLookupFor(
        checklistRows.map((row) => ({ id: row.id, itemLabel: row.item_label })),
      );

      const { drafts } = buildRequirementInstances({
        parties: partyRows.map((row) => ({
          id: row.id,
          partyType: row.party_type,
          displayName: row.display_name,
          confirmed: confirmedIds.has(row.id),
          active: row.active,
        })),
        checklistItemIdFor: lookup.checklistItemIdFor,
        // The made-up date is the case's own stated anchor for evidence age.
        // Never today: the schema forbids that, because it would silently re-age
        // every document each time it was read.
        referenceDate: caseRows[0]
          ? new Date(caseRows[0].made_up_date).toISOString().slice(0, 10)
          : null,
      });

      let requirementsCreated = 0;
      for (const draft of drafts) {
        const inserted = await tx<{ id: string }[]>`
          insert into case_requirement_instances (
            case_id, checklist_item_id, party_id, requirement_key, template_version, reference_date
          ) values (
            ${input.caseId}, ${draft.checklistItemId}, ${draft.partyId}, ${draft.requirementKey},
            ${draft.templateVersion}, ${draft.referenceDate}
          )
          on conflict do nothing
          returning id
        `;
        if (inserted.length === 1) requirementsCreated += 1;
      }

      return { confirmed: true, requirementsCreated };
    });
  }

  return {
    listCases,
    listCaseRequirements,
    syncRequirementInstances,
    syncCasePartiesFromOfficers,
    listCaseParties,
    confirmCaseParty,
    listCasePage,
    listAllCases,
    boardTotals,
    getCase,
    listCompaniesEligibleForCase,
    listAssignableStaff,
    createCase,
    dashboardMetrics,
    assertCanMutateCase,
    evaluateReminders,
    assignOwner,
    listNotes,
    listAuditEventsForCase,
    listAssignmentEventsForCase,
    addNote,
    updateStatus,
    listCompanyContactPhones,
    reconcileFailedReminders,
    recordReminder,
    updateChecklistItem,
    linkRequirementEvidence,
    updatePayment,
    updateFilingProof,
    close,
  };
}
