import { assertAssignableStaffTarget } from "@/features/auth/staff-target";
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
import type { OperationalMetrics } from "./operational-metrics";
import { WORK_VIEWS, type WorkViewPage, type WorkViewKey } from "./work-views";
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
  legacy_completion_eligible: boolean;
  assignment_revision: number;
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
  version_id: string;
  service_type: string;
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
  missingEvidenceItems: number;
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
  expectedAssignmentRevision?: number;
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
  listWorkViewPage(input: {
    scope: CaseFilters;
    viewerId: string | null;
    view: import("./work-views").WorkViewKey;
    filters?: { q?: string; ownerId?: string };
    cursor?: string;
    limit: number;
    asOf: string;
  }): Promise<import("./work-views").WorkViewPage>;
  boardTotals(filters: CaseFilters): Promise<BoardTotals>;
  operationalMetrics(
    filters: CaseFilters,
    today: string,
    currentUserId: string | null,
  ): Promise<OperationalMetrics>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  listCompaniesEligibleForCase(): Promise<EligibleCompanyForCase[]>;
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
export const DEFAULT_CASE_LIMIT = 50;

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
export const RISK_FILTER_SCAN_LIMIT = 200;

/**
 * Dashboard tiles count the whole active book rather than a page of it. Still
 * bounded, because hydrateCases loads checklist and payment children per case.
 */

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

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
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
        arc.confirmation_document_id,
        arc.legacy_completion_eligible,
        arc.assignment_revision
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
    if (filters.cursor !== undefined && cursor === null) {
      throw new Error("Invalid annual return case cursor.");
    }

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
            -- Mirrors the domain evidence oracle; the two are pinned
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
        checksum_sha256: string | null;
        expected_size_bytes: string | number | null;
        verified_checksum_sha256: string | null;
        verified_byte_size: string | number | null;
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
        i.checksum_sha256,
        i.expected_size_bytes,
        v.verified_checksum_sha256,
        v.verified_byte_size,
        l.page_from,
        l.page_to
      from case_requirement_instances r
      left join case_parties p on p.id = r.party_id
      left join requirement_evidence_links l on l.requirement_instance_id = r.id
      left join documents d on d.id = l.document_id
      left join document_upload_intents i on i.document_id = d.id
      left join document_versions v on v.document_id = d.id and v.superseded_by_version_id is null
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
          checksum: row.checksum_sha256 ?? undefined,
          sizeBytes: row.expected_size_bytes === null ? undefined : Number(row.expected_size_bytes),
          verifiedChecksum: row.verified_checksum_sha256,
          verifiedByteSize: row.verified_byte_size === null ? null : Number(row.verified_byte_size),
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
    const limit = filters.limit ?? (filters.risk ? RISK_FILTER_SCAN_LIMIT : DEFAULT_CASE_LIMIT);
    // Fetch one extra SQL row to distinguish an exact full final page from
    // another page. Hydrate only the requested rows; the lookahead is solely
    // an existence proof, never a row shown or included in the cursor.
    const rows = await selectCaseRows({ ...filters, limit: limit + 1 }, today);
    const pageRows = rows.slice(0, limit);
    const hydrated = await hydrateCases(pageRows, today);
    const cases = hydrated.filter((case_) => caseMatchesHydratedFilters(case_, filters));
    const last = pageRows.at(-1);
    return {
      cases,
      nextCursor: rows.length > limit && last ? encodeCaseCursor(last) : null,
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
    const pageSize = options.pageSize ?? 200;
    // Non-interactive callers must fail visibly if their safety ceiling is hit.
    const maxPages = options.maxPages ?? 100;
    const all: AnnualReturnCase[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await listCasePage({ ...filters, limit: pageSize, cursor });
      all.push(...result.cases);
      if (!result.nextCursor) return all;
      cursor = result.nextCursor;
    }
    throw new Error("Annual return case scan exceeded its page safety ceiling.");
  }

  /**
   * One SQL statement counts the authorized view and selects its keyset page
   * against the same database snapshot. Expensive blocker aggregation happens
   * only for the selected page, never for every case in the firm.
   */
  async function listWorkViewPage(input: {
    scope: CaseFilters;
    viewerId: string | null;
    view: WorkViewKey;
    filters?: { q?: string; ownerId?: string };
    cursor?: string;
    limit: number;
    asOf: string;
  }): Promise<WorkViewPage> {
    const definition = WORK_VIEWS.find((item) => item.key === input.view);
    if (!definition) throw new Error("Unknown work view.");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
      throw new Error("Work-view page limit must be between 1 and 200.");
    }
    const cursor = decodeCaseCursor(input.cursor);
    if (input.cursor && !cursor) throw new Error("Invalid work-view cursor.");
    const teamId = input.scope.teamId ?? null;
    const visibleToUserId = input.scope.visibleToUserId ?? null;
    const companyIds = input.scope.companyIds ? [...input.scope.companyIds] : null;
    const ownerId = input.filters?.ownerId ?? null;
    const query = input.filters?.q?.trim()
      ? `%${input.filters.q.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
      : null;
    const viewerId = input.viewerId;
    const view = input.view;
    const asOf = input.asOf;
    const limit = input.limit;
    type WorkViewSqlRow = {
      total: string | number;
      id: string | null;
      company_name: string | null;
      return_year: number | null;
      filing_due_date: string | null;
      owner_name: string | null;
      blocker: string | null;
      document_id: string | null;
    };
    const result = await sql<WorkViewSqlRow[]>`
      with eligible as materialized (
        select arc.id, c.company_name, arc.return_year,
               arc.filing_due_date::text as filing_due_date, owner.name as owner_name
        from annual_return_cases arc
        join companies c on c.id = arc.company_id
        join users owner on owner.id = arc.owner_id
        where (${teamId}::uuid is null or c.assigned_team_id = ${teamId}::uuid)
          and (${visibleToUserId}::uuid is null
               or arc.owner_id = ${visibleToUserId}::uuid
               or arc.reviewer_id = ${visibleToUserId}::uuid)
          and (${companyIds}::uuid[] is null or arc.company_id = any(${companyIds}::uuid[]))
          and (${ownerId}::uuid is null or arc.owner_id = ${ownerId}::uuid)
          and (${query}::text is null
               or c.company_name ilike ${query} escape '\\'
               or c.cr_number ilike ${query} escape '\\')
          and (
            (${view} = 'readyToFile'
             and arc.current_status not in ('Filed','Completed')
             and arc.locked_at is null and arc.completed_at is null
             and exists (
               select 1 from filing_packages fp
               where fp.case_id = arc.id and fp.state = 'approved'
                 and fp.approved_by is not null
                 and not exists (
                   select 1 from filing_packages newer
                   where newer.case_id = arc.id and newer.revision > fp.revision
                 )
             )
             and not exists (
               select 1 from package_handoffs ph
               where ph.case_id = arc.id
                 and ph.status in ('prepared','recorded_submission','transmitted','acknowledged')
             ))
            or
            (${view} = 'returnsAndExceptions'
             and exists (
               select 1 from handoff_returns hr
               where hr.case_id = arc.id and hr.source_kind is not null
                 and (hr.reconciled_at is null or hr.match_state <> 'reconciled'
                      or hr.outcome in ('rejected','partial','unmatched'))
             ))
            or
            (arc.current_status not in ('Filed','Completed')
             and arc.locked_at is null and arc.completed_at is null
             and (
               (${view} = 'chaseToday'
                and arc.filing_due_date <= ${asOf}::date + 30
                and exists (
                  select 1 from annual_return_checklist_items i
                  where i.case_id = arc.id and i.required = true
                    and i.status in ('Missing','Rejected')
                ))
               or
               (${view} in ('newlyReceived','awaitingMyReview')
                and (${view} <> 'awaitingMyReview'
                     or arc.owner_id = ${viewerId}::uuid
                     or arc.reviewer_id = ${viewerId}::uuid)
                and exists (
                  select 1 from annual_return_checklist_items i
                  where i.case_id = arc.id and i.status = 'Received'
                ))
             ))
          )
      ),
      counted as (select count(*)::bigint as total from eligible),
      page as (
        select * from eligible
        where (${cursor === null}
               or (filing_due_date::date, company_name, id)
                  > (${cursor?.dueDate ?? null}::date, ${cursor?.companyName ?? ""}, ${cursor?.id ?? null}::uuid))
        order by filing_due_date asc, company_name asc, id asc
        limit ${limit + 1}
      )
      select counted.total, page.*,
        case
          when ${view} = 'readyToFile' then '已批准套件，待核實當前文件、付款及儲存檔案'
          when ${view} = 'chaseToday' then (
            select string_agg(i.item_label, '、' order by i.id)
            from annual_return_checklist_items i
            where i.case_id = page.id and i.required = true
              and i.status in ('Missing','Rejected')
          )
          when ${view} in ('newlyReceived','awaitingMyReview') then (
            select count(*)::text || ' 份文件待覆核'
            from annual_return_checklist_items i
            where i.case_id = page.id and i.status = 'Received'
          )
          else (
            select count(*)::text || ' 份回件待核對或處理'
            from handoff_returns hr
            where hr.case_id = page.id and hr.source_kind is not null
              and (hr.reconciled_at is null or hr.match_state <> 'reconciled'
                   or hr.outcome in ('rejected','partial','unmatched'))
          )
        end as blocker,
        case when ${view} in ('newlyReceived','awaitingMyReview') then (
          select i.document_id from annual_return_checklist_items i
          where i.case_id = page.id and i.status = 'Received'
          order by i.id asc limit 1
        ) else null end as document_id
      from counted left join page on true
      order by page.filing_due_date asc nulls last, page.company_name asc, page.id asc
    `;
    const pageRows = result.filter((row): row is WorkViewSqlRow & { id: string } =>
      Boolean(row.id),
    );
    const rows = pageRows.slice(0, limit);
    const last = rows.at(-1);
    return {
      definition:
        input.view === "returnsAndExceptions"
          ? { ...definition, released: true, unavailableReason: undefined }
          : definition,
      rows: rows.map((row) => ({
        caseId: row.id,
        companyName: row.company_name ?? "",
        returnYear: row.return_year ?? 0,
        filingDueDate: row.filing_due_date ?? "",
        daysRemaining: daysBetween(asOf, row.filing_due_date ?? asOf),
        ownerName: row.owner_name ?? "",
        blocker: row.blocker ?? "待負責同事核對",
        ...(row.document_id ? { documentId: row.document_id } : {}),
      })),
      total: Number(result[0]?.total ?? 0),
      nextCursor:
        pageRows.length > limit && last
          ? encodeCaseCursor({
              filing_due_date: last.filing_due_date ?? asOf,
              company_name: last.company_name ?? "",
              id: last.id,
            })
          : null,
      asOf,
    };
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
  async function aggregateOperationalMetrics(
    filters: CaseFilters,
    today: string,
    currentUserId: string | null,
  ): Promise<
    OperationalMetrics & {
      totalCases: number;
      dueIn7: number;
      dueIn30: number;
      highRisk: number;
    }
  > {
    // One authorized scope and one as-of date for both board and dashboard.
    // Aggregate checklist rows once within the authorized case set. A lateral
    // count per case can degrade to repeated full scans when planner statistics
    // lag a large import; this plan stays set-based at 20k+ cases.
    const counted = await sql<
      {
        total: string;
        active_cases: string;
        overdue: string;
        due_in_7: string;
        due_in_30: string;
        missing_evidence_cases: string;
        missing_evidence_items: string;
        payment_pending: string;
        assigned_to_me: string;
        high_risk: string;
      }[]
    >`
      with scoped as materialized (
        select arc.id,arc.company_id,arc.current_status,arc.filing_due_date,
          arc.owner_id,arc.risk_level
        from annual_return_cases arc
        join companies c on c.id = arc.company_id
        where (${filters.ownerId ?? null}::uuid is null or arc.owner_id = ${filters.ownerId ?? null}::uuid)
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
      ),
      missing as (
        select i.case_id,count(*)::bigint as missing_items
        from annual_return_checklist_items i
        join scoped s on s.id = i.case_id
        where i.required = true
          and (i.status <> 'Verified' or i.received_at is null
               or i.verified_at is null or i.document_id is null)
        group by i.case_id
      )
      select
        count(*) total,
        count(*) filter (where arc.current_status not in ('Filed', 'Completed')) active_cases,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and arc.filing_due_date < ${today}::date
        ) overdue,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and arc.filing_due_date between ${today}::date and ${today}::date + 7
        ) due_in_7,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and arc.filing_due_date between ${today}::date and ${today}::date + 30
        ) due_in_30,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and missing.missing_items > 0
        ) missing_evidence_cases,
        coalesce(sum(missing.missing_items) filter (
          where arc.current_status not in ('Filed', 'Completed')
        ), 0) missing_evidence_items,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and (coalesce(p.status, '') <> 'Payment received' or p.payment_proof_document_id is null)
        ) payment_pending,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and arc.owner_id = ${currentUserId}::uuid
        ) assigned_to_me,
        count(*) filter (
          where arc.current_status not in ('Filed', 'Completed')
            and arc.risk_level = 'red'
        ) high_risk
      from scoped arc
      left join payments p on p.case_id = arc.id
      left join missing on missing.case_id = arc.id
    `;
    const row = counted[0];
    return {
      totalCases: Number(row?.total ?? 0),
      activeCases: Number(row?.active_cases ?? 0),
      overdueCases: Number(row?.overdue ?? 0),
      dueIn7: Number(row?.due_in_7 ?? 0),
      dueIn30: Number(row?.due_in_30 ?? 0),
      missingEvidenceCases: Number(row?.missing_evidence_cases ?? 0),
      missingEvidenceItems: Number(row?.missing_evidence_items ?? 0),
      paymentPendingCases: Number(row?.payment_pending ?? 0),
      assignedToMe: Number(row?.assigned_to_me ?? 0),
      highRisk: Number(row?.high_risk ?? 0),
      scopeLabel: filters.visibleToUserId ? "本人可見案件" : "可見案件",
      asOf: today,
    };
  }

  async function operationalMetrics(
    filters: CaseFilters,
    today: string,
    currentUserId: string | null,
  ): Promise<OperationalMetrics> {
    const counts = await aggregateOperationalMetrics(filters, today, currentUserId);
    return {
      activeCases: counts.activeCases,
      overdueCases: counts.overdueCases,
      missingEvidenceCases: counts.missingEvidenceCases,
      missingEvidenceItems: counts.missingEvidenceItems,
      paymentPendingCases: counts.paymentPendingCases,
      assignedToMe: counts.assignedToMe,
      scopeLabel: counts.scopeLabel,
      asOf: counts.asOf,
    };
  }

  async function boardTotals(filters: CaseFilters): Promise<BoardTotals> {
    const counts = await aggregateOperationalMetrics(filters, readToday(), null);
    return {
      total: counts.totalCases,
      overdue: counts.overdueCases,
      dueIn7: counts.dueIn7,
      dueIn30: counts.dueIn30,
      missingDocuments: counts.missingEvidenceCases,
      missingEvidenceItems: counts.missingEvidenceItems,
      paymentPending: counts.paymentPendingCases,
    };
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
        select t.id,t.active,v.id version_id,v.service_type,v.documents
        from checklist_templates t
        join checklist_template_versions v on v.id=t.published_version_id
        where t.id = ${input.templateId} and t.archived_at is null
        for share of t,v
      `;
      const template = templateRows[0];
      if (!template || !template.active) {
        throw new Error("Checklist template not found or inactive.");
      }
      if (
        !["Annual Return — Private Ltd", "Annual Return — Public Ltd"].includes(
          template.service_type,
        )
      )
        throw new Error("An annual-return published template is required.");
      if (
        new Set(template.documents.map((document) => document.id)).size !==
        template.documents.length
      )
        throw new Error("Published template has duplicate document IDs.");

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
          company_id, return_year, made_up_date, filing_due_date, current_status, owner_id,
          template_version_id
        )
        values (
          ${input.companyId}, ${returnYear}, ${basisDate}, ${filingDueDate}, 'Upcoming', ${input.ownerId},
          ${template.version_id}
        )
        returning id
      `;
      const newCaseId = caseRows[0]?.id;
      if (!newCaseId) throw new Error("Annual return case was not created.");

      for (const document of template.documents) {
        const dueDate = offsetDateOnly(filingDueDate, -document.daysBeforeDue);
        await tx`
          insert into annual_return_checklist_items
            (case_id, item_label, required, status, due_date, template_document_id)
          values (${newCaseId}, ${document.label}, ${document.required}, 'Missing', ${dueDate}, ${document.id})
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
          ${tx.json({ templateId: input.templateId, templateVersionId: template.version_id, returnYear })}
        )
      `;

      await writeAuditEvent(tx, {
        case_: { id: newCaseId, companyId: input.companyId },
        companyId: input.companyId,
        actor,
        action: "create_case",
        summary: "Annual return case created.",
        metadata: {
          templateId: input.templateId,
          templateVersionId: template.version_id,
          returnYear,
        },
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
    const counts = await aggregateOperationalMetrics(scope, today, currentUserId);
    return {
      dueIn7: counts.dueIn7,
      dueIn30: counts.dueIn30,
      overdue: counts.overdueCases,
      highRisk: counts.highRisk,
      // This public tile counts cases. The separate operational contract
      // retains the item count for staff who need to plan document chasing.
      missingDocuments: counts.missingEvidenceCases,
      paymentPending: counts.paymentPendingCases,
      assignedToMe: counts.assignedToMe,
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
    currentStatus: AnnualReturnStatus,
    legacyCompletionEligible: boolean,
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

    // A pre-migration Filed case may retain its verified legacy confirmation path.
    // All other cases require the approved package, submission and accepted return.
    const packageRows = await tx<{ id: string }[]>`
      select id from filing_packages where case_id = ${caseId} limit 1
    `;
    if (packageRows.length > 0) {
      const completeHandoffRows = await tx<{ id: string }[]>`
        select fp.id
        from filing_packages fp
        join package_handoffs ph on ph.package_id = fp.id
          and ph.case_id = fp.case_id
          and ph.manifest_sha256 = fp.manifest_sha256
          and ph.submission_mode = 'manual'
          and ph.status = 'recorded_submission'
          and ph.submitted_at is not null
          and ph.recorded_at is not null
        join document_versions sv on sv.id = ph.proof_version_id
          and sv.superseded_by_version_id is null
          and sv.verified_checksum_sha256 is not null
        join documents sd on sd.id = sv.document_id
          and sd.case_id = fp.case_id
          and sd.company_id = ${companyId}
          and sd.file_type = 'submission'
          and sd.verification_status = 'verified'
        join handoff_returns hr on hr.handoff_id = ph.id
          and hr.case_id = fp.case_id
          and hr.company_id = ${companyId}
          and hr.external_reference = ph.destination_reference
          and hr.manifest_sha256 = fp.manifest_sha256
          and hr.match_state = 'reconciled'
          and hr.outcome = 'accepted'
          and hr.reconciliation_decision = 'confirm'
          and hr.reconciled_at is not null
          and hr.reconciled_by is not null
        left join document_versions rv on rv.id = hr.document_version_id
          and rv.superseded_by_version_id is null
          and rv.verified_checksum_sha256 = hr.source_sha256
        left join documents rd on rd.id = rv.document_id
          and rd.case_id = fp.case_id
          and rd.company_id = ${companyId}
          and rd.file_type = 'receipt'
          and rd.verification_status = 'verified'
        left join filing_return_source_objects fso on fso.id::text = hr.source_object_id
          and fso.source_sha256 = hr.source_sha256
          and fso.object_version = hr.source_version
          and fso.scan_state = 'verified'
        where fp.case_id = ${caseId}
          and fp.state = 'approved'
          and (
            (hr.source_kind = 'internal' and fso.id is not null)
            or (hr.source_kind is distinct from 'internal' and rv.id is not null and rd.id is not null)
          )
          and fp.revision = (
            select max(revision) from filing_packages where case_id = ${caseId}
          )
          and not exists (
            select 1 from handoff_returns outstanding
            where outstanding.case_id = ${caseId}
              and outstanding.source_kind is not null
              and (
                outstanding.reconciled_at is null
                or outstanding.match_state <> 'reconciled'
                or outstanding.outcome <> 'accepted'
              )
          )
        limit 1
      `;
      if (completeHandoffRows.length === 0) {
        blockers.push(
          "Current approved package, recorded submission proof and reconciled accepted return are required.",
        );
      }
    } else if (legacyCompletionEligible && currentStatus === "Filed") {
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
    } else {
      blockers.push(
        "Current approved package, recorded submission proof and reconciled accepted return are required.",
      );
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
      if (input.expectedAssignmentRevision !== undefined) {
        if (
          !Number.isSafeInteger(input.expectedAssignmentRevision) ||
          input.expectedAssignmentRevision < 1 ||
          lockedCase.assignment_revision !== input.expectedAssignmentRevision
        )
          throw new Error("Case owner assignment revision changed; preview again.");
      }
      await assertAssignableStaffTarget(
        tx,
        input.ownerId,
        actor.role === "Admin" ? undefined : lockedCase.company_team_id,
      );

      const updatedRows = await tx<{ id: string }[]>`
        update annual_return_cases
        set owner_id = ${input.ownerId},
            assignment_revision = assignment_revision + 1,
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
          lockedCase.current_status,
          lockedCase.legacy_completion_eligible,
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
        { id: string; status: PaymentStatus; payment_proof_document_id: string | null }[]
      >`
        select id, status, payment_proof_document_id from payments
        where case_id = ${input.caseId} for update
      `;
      if (!currentPaymentRows[0]) throw new Error("Annual return payment not found.");
      const eventChanged =
        currentPaymentRows[0].status !== input.status ||
        currentPaymentRows[0].payment_proof_document_id !== paymentProofDocumentId;
      if (isPaymentReceived && eventChanged) {
        // A verified document is evidence about bytes, not an amount or an
        // invoice. Only the T13 reconciliation service can create this unique
        // allocation, in the same transaction, after checking the canonical
        // invoice, amount, currency and current proof version. Direct case
        // commands cannot bypass it by sending Payment received plus a doc id.
        const allocations = await tx<{ id: string }[]>`
          select a.id from payment_proof_allocations a
          join payments p on p.id = a.payment_id
          join document_versions v on v.id = a.proof_version_id
            and v.superseded_by_version_id is null
          join document_upload_intents i on i.id = v.intent_id
          where a.payment_id = ${currentPaymentRows[0].id}
            and v.document_id = ${paymentProofDocumentId}
            and a.amount_minor = p.amount::bigint * 100
            and a.currency = p.currency
            and a.invoice_ref = p.invoice_number
            and i.status = 'available' and i.scan_verdict_source = 'provider'
            and v.verified_checksum_sha256 = i.checksum_sha256
            and v.verified_byte_size = i.expected_size_bytes
          limit 1`;
        if (allocations.length !== 1) {
          throw new Error("Payment received requires a reconciled proof allocation.");
        }
      }

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
    businessDateOrInstant: string = readToday(),
  ): Promise<{ sent: number; skipped: number }> {
    // Normalised here, not only at the call site. The parameter feeds a `date`
    // comparison and a day count the client reads, so a caller that hands down
    // a raw cron instant must not be able to make this sweep run on the UTC day:
    // 16:00Z onward is already tomorrow in Hong Kong.
    const now = toHongKongBusinessDate(businessDateOrInstant);
    let sent = 0;
    let skipped = 0;
    let cursor: string | undefined;
    // The scheduled sweep keeps a bounded page in memory and advances by the
    // stable SQL sort key. A 5,000-case cutoff silently omitted later clients.
    while (true) {
      const candidates = await listCasesForToday({ limit: 200, cursor }, now);
      if (candidates.length === 0) break;
      const openCases = candidates.filter(
        (case_) => case_.currentStatus !== "Filed" && case_.currentStatus !== "Completed",
      );
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
            await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_skipped',
              'system', null, 'Automated reminder skipped: nothing is outstanding from the client.',
              ${tx.json({ milestone, reason: "nothing_outstanding" })}
            )
          `;
            return "skipped" as const;
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
      if (candidates.length < 200) break;
      const last = candidates[candidates.length - 1];
      cursor = encodeCaseCursor({
        filing_due_date: last.filingDueDate,
        company_name: last.companyName,
        id: last.id,
      });
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
    listWorkViewPage,
    boardTotals,
    operationalMetrics,
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
    recordReminder,
    updateChecklistItem,
    linkRequirementEvidence,
    updatePayment,
    updateFilingProof,
    close,
  };
}
