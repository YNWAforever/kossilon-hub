import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type postgres from "postgres";
import {
  daysBetween,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  riskForCase,
} from "./workflow";

// Re-exported so existing importers (server-fns.ts) keep working unchanged.
export { hongKongBusinessDate };
import {
  assertAnnualReturnActionAllowed,
  type AnnualReturnAction,
  type AnnualReturnActionActor,
  type AnnualReturnActorRole,
} from "./permissions";
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

export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  dashboardMetrics(today: string, currentUserId: string): Promise<AnnualReturnDashboardMetrics>;
  updateStatus(
    caseId: string,
    nextStatus: AnnualReturnStatus,
    actorId: string,
  ): Promise<AnnualReturnCase>;
  recordReminder(input: RecordAnnualReturnReminderInput): Promise<AnnualReturnCase>;
  updateChecklistItem(input: UpdateAnnualReturnChecklistItemInput): Promise<AnnualReturnCase>;
  updatePayment(input: UpdateAnnualReturnPaymentInput): Promise<AnnualReturnCase>;
  updateFilingProof(input: UpdateAnnualReturnFilingProofInput): Promise<AnnualReturnCase>;
  close(): Promise<void>;
};

const FILED_OR_COMPLETED_STATUSES = new Set<AnnualReturnStatus>(["Filed", "Completed"]);
const COMPLETED_CASE_LOCKED_MESSAGE = "Completed annual return cases are locked.";
const CHECKLIST_EVIDENCE_FILE_TYPE = "annual-return-evidence";
const PAYMENT_PROOF_FILE_TYPE = "payment-proof";
const FILING_CONFIRMATION_FILE_TYPE = "filing-confirmation";

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

function caseMatchesHydratedFilters(
  case_: AnnualReturnCase,
  filters: CaseFilters,
  today: string,
): boolean {
  if (filters.risk && case_.riskLevel !== filters.risk) {
    return false;
  }

  if (typeof filters.missingDocuments === "boolean") {
    const hasOutstandingEvidence = case_.checklist.some(hasOutstandingRequiredEvidence);

    if (hasOutstandingEvidence !== filters.missingDocuments) {
      return false;
    }
  }

  if (filters.overdueOnly && daysBetween(today, case_.filingDueDate) >= 0) {
    return false;
  }

  return true;
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

  async function writeAuditEvent(
    tx: TransactionSqlClient,
    input: {
      case_: AnnualReturnCase;
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

  async function lockWritableCase(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<LockedCaseRow> {
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

    assertSingleMutatedRow(rows, COMPLETED_CASE_LOCKED_MESSAGE);
    return rows[0];
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

  async function dashboardMetrics(
    today: string,
    currentUserId: string,
  ): Promise<AnnualReturnDashboardMetrics> {
    // TODO: Move dashboard tiles to SQL aggregates and paginated reads as case volume grows.
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
        and d.file_type = ${CHECKLIST_EVIDENCE_FILE_TYPE}
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
        and d.file_type = ${PAYMENT_PROOF_FILE_TYPE}
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
          and file_type = ${FILING_CONFIRMATION_FILE_TYPE}
        limit 1
      `;

      if (filingConfirmationRows.length !== 1) {
        blockers.push("Verified filing confirmation document is required.");
      }
    }

    return blockers;
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

      const updatedRows = await tx<{ id: string }[]>`
        update annual_return_cases
        set current_status = ${nextStatus},
            locked_at = case when ${completing} then coalesce(locked_at, now()) else locked_at end,
            completed_at = case when ${completing} then coalesce(completed_at, now()) else completed_at end,
            updated_at = now()
        where id = ${caseId}
          and locked_at is null
          and completed_at is null
          and current_status <> 'Completed'
        returning id
      `;

      assertSingleMutatedRow(updatedRows, COMPLETED_CASE_LOCKED_MESSAGE);

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
            and file_type = ${CHECKLIST_EVIDENCE_FILE_TYPE}
          limit 1
        `;

        if (documentRows.length !== 1) {
          throw new Error(
            "Verified checklist items require a same-case verified annual return evidence document.",
          );
        }
      }

      const updatedRows = await tx<{ id: string; item_label: string }[]>`
        update annual_return_checklist_items
        set status = ${input.status},
            document_id = ${documentId},
            received_at = case when ${hasReceivedEvidence} then coalesce(received_at, now()) else null end,
            verified_at = case when ${hasVerifiedEvidence} then coalesce(verified_at, now()) else null end,
            updated_at = now()
        where id = ${input.itemId}
          and case_id = ${input.caseId}
        returning id, item_label
      `;

      if (updatedRows.length !== 1) {
        throw new Error("Checklist item not found for annual return case.");
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
            and file_type = ${PAYMENT_PROOF_FILE_TYPE}
          limit 1
        `;

        if (documentRows.length !== 1) {
          throw new Error("Payment received requires a same-case verified payment proof document.");
        }
      }

      const updatedRows = await tx<{ id: string; invoice_number: string }[]>`
        update payments
        set status = ${input.status},
            payment_proof_document_id = ${paymentProofDocumentId},
            paid_at = case when ${isPaymentReceived} then coalesce(paid_at, now()) else null end,
            updated_at = now()
        where case_id = ${input.caseId}
        returning id, invoice_number
      `;

      if (updatedRows.length !== 1) {
        throw new Error("Annual return payment not found.");
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

      const documentRows = await tx<{ id: string }[]>`
        select id
        from documents
        where id = ${input.confirmationDocumentId}
          and case_id = ${input.caseId}
          and company_id = ${lockedCase.company_id}
          and verification_status = 'verified'
          and file_type = ${FILING_CONFIRMATION_FILE_TYPE}
        limit 1
      `;

      if (documentRows.length !== 1) {
        throw new Error("Filing proof requires a same-case verified filing confirmation document.");
      }

      const updatedRows = await tx<{ id: string }[]>`
        update annual_return_cases
        set filing_reference = ${input.filingReference},
            confirmation_document_id = ${input.confirmationDocumentId},
            updated_at = now()
        where id = ${input.caseId}
          and locked_at is null
          and completed_at is null
          and current_status <> 'Completed'
        returning id
      `;

      assertSingleMutatedRow(updatedRows, COMPLETED_CASE_LOCKED_MESSAGE);

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

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) {
      await sql.end();
    }
  }

  return {
    listCases,
    getCase,
    dashboardMetrics,
    updateStatus,
    recordReminder,
    updateChecklistItem,
    updatePayment,
    updateFilingProof,
    close,
  };
}
