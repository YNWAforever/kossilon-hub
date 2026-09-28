import type postgres from "postgres";
import { createSqlClient, getSqlClient, type SqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { assertDistinctImportTargets, planImportedRow } from "./apply";
import { MAX_IMPORT_ROWS, type ImportPreviewRow, type ParsedImportRow } from "./preview";

export type ImportApproval = {
  id: string;
  previewId: string;
  batchId: string;
  previewHash: string;
  approvedAt: string;
};
export class ImportApplyError extends Error {
  constructor(
    public readonly state: "conflict" | "forbidden",
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}
type QueryClient = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;
type PreviewRecord = {
  id: string;
  batch_id: string;
  batch_revision: number;
  semantic_key: string;
  preview_hash: string;
  created_by: string;
  expires_at: string | Date;
  rows: ImportPreviewRow[];
};
type BatchRecord = {
  id: string;
  revision: number;
  return_year: number | null;
  semantic_key: string | null;
  status: string;
};
type ApprovalRecord = {
  id: string;
  preview_id: string;
  batch_id: string;
  batch_revision: number;
  preview_hash: string;
  approved_by: string;
  approved_at: string | Date;
};
type CaseRecord = {
  id: string;
  company_id: string;
  filing_due_date: string;
  current_status: string;
  updated_at: string | Date;
};
type ImportRowRecord = {
  id: string;
  batch_id: string;
  revision: number;
  matched_company_id: string | null;
  matched_case_id: string | null;
  raw: unknown;
  parsed: ParsedImportRow;
  applied_at: string | Date | null;
  applied_case_id: string | null;
};
function transaction<T>(sql: QueryClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in sql ? (sql.begin(fn) as Promise<T>) : fn(sql);
}
function mapApproval(row: ApprovalRecord): ImportApproval {
  return {
    id: row.id,
    previewId: row.preview_id,
    batchId: row.batch_id,
    previewHash: row.preview_hash,
    approvedAt: new Date(row.approved_at).toISOString(),
  };
}
async function requireCurrentAdmin(sql: QueryClient, actor: AuthenticatedActor): Promise<void> {
  if (!actor.active || actor.role !== "Admin")
    throw new ImportApplyError("forbidden", "ADMIN_REQUIRED");
  const [actual] = await sql<
    { user_id: string; role: string; team_id: string | null }[]
  >`select sp.user_id,sp.role,sp.team_id from staff_profiles sp
    join users u on u.id = sp.user_id and u.active
    where sp.auth_user_id = ${actor.authUserId} and sp.active
    limit 1 for share of sp,u`;
  if (
    !actual ||
    actual.user_id !== actor.userId ||
    actual.role !== "Admin" ||
    actual.team_id !== actor.teamId
  )
    throw new ImportApplyError("forbidden", "ACTOR_SCOPE_CHANGED");
}
function assertSnapshotMatches(row: ImportPreviewRow, current: CaseRecord | undefined): void {
  const snapshot = row.caseSnapshot;
  if (!snapshot && current) throw new ImportApplyError("conflict", "CASE_CREATED_AFTER_PREVIEW");
  if (snapshot && !current) throw new ImportApplyError("conflict", "CASE_DISAPPEARED");
  if (
    snapshot &&
    current &&
    (row.matchedCaseId !== current.id ||
      snapshot.status !== current.current_status ||
      snapshot.filingDueDate !== current.filing_due_date ||
      snapshot.updatedAt !== new Date(current.updated_at).toISOString())
  )
    throw new ImportApplyError("conflict", "CASE_CHANGED_AFTER_PREVIEW");
}
function madeUpDate(year: number, basisDate: string): string {
  const candidate = `${year}${basisDate.slice(4)}`;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate)
    throw new ImportApplyError("conflict", "INVALID_ANNIVERSARY_DATE");
  return candidate;
}

export function createNarImportApplyRepository(
  options: { sql?: QueryClient; databaseUrl?: string } = {},
) {
  const sql =
    options.sql ?? (options.databaseUrl ? createSqlClient(options.databaseUrl) : getSqlClient());
  const ownsClient = Boolean(options.databaseUrl) && !options.sql;
  return {
    async approve(
      actor: AuthenticatedActor,
      input: { previewId: string; previewHash: string },
    ): Promise<ImportApproval> {
      return transaction(sql, async (tx) => {
        await requireCurrentAdmin(tx, actor);
        const [preview] = await tx<PreviewRecord[]>`
          select * from nar_import_previews where id = ${input.previewId} for update`;
        if (
          !preview ||
          preview.created_by !== actor.userId ||
          preview.preview_hash !== input.previewHash
        )
          throw new ImportApplyError("forbidden", "PREVIEW_OWNER_OR_HASH_MISMATCH");
        const [existing] = await tx<ApprovalRecord[]>`
          select * from nar_import_approvals where preview_id = ${preview.id}`;
        if (existing) return mapApproval(existing);
        if (Date.parse(new Date(preview.expires_at).toISOString()) <= Date.now())
          throw new ImportApplyError("conflict", "PREVIEW_EXPIRED");
        const [batch] = await tx<BatchRecord[]>`
          select * from nar_import_batches where id = ${preview.batch_id} for update`;
        if (
          !batch ||
          batch.status !== "pending_review" ||
          batch.return_year === null ||
          batch.revision !== preview.batch_revision ||
          batch.semantic_key !== preview.semantic_key
        )
          throw new ImportApplyError("conflict", "BATCH_CHANGED_AFTER_PREVIEW");
        if (
          !Array.isArray(preview.rows) ||
          preview.rows.length < 1 ||
          preview.rows.length > MAX_IMPORT_ROWS
        )
          throw new ImportApplyError("conflict", "PREVIEW_SIZE_OUT_OF_RANGE");
        assertDistinctImportTargets(preview.rows, batch.return_year);
        const rowIds = preview.rows.map((row) => row.rowId);
        if (new Set(rowIds).size !== rowIds.length)
          throw new ImportApplyError("conflict", "DUPLICATE_PREVIEW_ROW");
        const currentRows = await tx<ImportRowRecord[]>`
          select * from nar_import_rows where id = any(${rowIds}::uuid[]) and batch_id = ${batch.id}
          order by id for share`;
        if (currentRows.length !== rowIds.length)
          throw new ImportApplyError("conflict", "IMPORT_ROW_MISSING");
        const previewById = new Map(preview.rows.map((row) => [row.rowId, row]));
        for (const stored of currentRows) {
          const row = previewById.get(stored.id);
          if (!row) throw new ImportApplyError("conflict", "ROW_NOT_IN_APPROVAL");
          if (
            stored.revision !== row.rowRevision ||
            stored.matched_company_id !== row.matchedCompanyId ||
            stored.matched_case_id !== row.matchedCaseId ||
            (stored.applied_at !== null && !row.matchedCaseId)
          )
            throw new ImportApplyError("conflict", "IMPORT_ROW_CHANGED_AFTER_PREVIEW");
        }
        const companyIds = [
          ...new Set(
            preview.rows
              .map((row) => row.matchedCompanyId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const cases = companyIds.length
          ? await tx<CaseRecord[]>`
              select id,company_id,filing_due_date::text filing_due_date,current_status,updated_at
              from annual_return_cases where company_id = any(${companyIds}::uuid[])
                and return_year = ${batch.return_year} order by company_id for share`
          : [];
        const byCompany = new Map(cases.map((item) => [item.company_id, item]));
        for (const row of preview.rows) {
          if (
            row.matchedCompanyId &&
            !["invalid", "needsCompanyMapping", "conflict"].includes(row.disposition)
          )
            assertSnapshotMatches(row, byCompany.get(row.matchedCompanyId));
        }
        const [approved] = await tx<ApprovalRecord[]>`
          insert into nar_import_approvals
            (preview_id,batch_id,batch_revision,preview_hash,approved_by)
          values (${preview.id},${batch.id},${batch.revision},${preview.preview_hash},${actor.userId})
          returning *`;
        return mapApproval(approved);
      });
    },
    async applyRow(
      tx: Tx,
      actor: AuthenticatedActor,
      input: { approvalId: string; rowId: string; expectedRevision: number },
    ): Promise<{
      state: "succeeded" | "skipped";
      revisionAfter: number;
      auditRef: string;
      reasonCode: string | null;
    }> {
      await requireCurrentAdmin(tx, actor);
      const [approval] = await tx<ApprovalRecord[]>`
        select * from nar_import_approvals where id = ${input.approvalId}`;
      if (!approval || approval.approved_by !== actor.userId)
        throw new ImportApplyError("forbidden", "APPROVAL_OWNER_CHANGED");
      const [preview] = await tx<
        (Omit<PreviewRecord, "rows"> & { candidate: ImportPreviewRow | null })[]
      >`
        select id,batch_id,batch_revision,semantic_key,preview_hash,created_by,expires_at,
          rows_by_id -> ${input.rowId} as candidate
        from nar_import_previews where id = ${approval.preview_id}`;
      const [batch] = await tx<BatchRecord[]>`
        select * from nar_import_batches where id = ${approval.batch_id}`;
      if (
        !preview ||
        !batch ||
        preview.preview_hash !== approval.preview_hash ||
        batch.revision !== approval.batch_revision ||
        batch.semantic_key !== preview.semantic_key ||
        !["pending_review", "applying", "failed"].includes(batch.status) ||
        batch.return_year === null
      )
        throw new ImportApplyError("conflict", "APPROVED_BATCH_CHANGED");
      const candidate = preview.candidate;
      if (!candidate) throw new ImportApplyError("conflict", "ROW_NOT_IN_APPROVAL");
      if (candidate.rowRevision !== input.expectedRevision)
        throw new ImportApplyError("conflict", "PREVIEW_REVISION_MISMATCH");
      const [stored] = await tx<ImportRowRecord[]>`
        select * from nar_import_rows where id = ${input.rowId} for update`;
      if (!stored || stored.batch_id !== batch.id)
        throw new ImportApplyError("conflict", "IMPORT_ROW_MISSING");
      const [prior] = await tx<{ id: string; result: string }[]>`
        select id,result from nar_import_apply_events where row_id = ${stored.id}`;
      if (prior)
        return {
          state: "skipped",
          revisionAfter: stored.revision,
          auditRef: prior.id,
          reasonCode: "ALREADY_APPLIED",
        };
      if (
        stored.revision !== input.expectedRevision ||
        stored.matched_company_id !== candidate.matchedCompanyId ||
        stored.matched_case_id !== candidate.matchedCaseId
      )
        throw new ImportApplyError("conflict", "IMPORT_ROW_CHANGED_AFTER_APPROVAL");
      if (
        !candidate.matchedCompanyId ||
        ["invalid", "needsCompanyMapping", "conflict"].includes(candidate.disposition)
      )
        throw new ImportApplyError("conflict", "ROW_NOT_APPROVABLE");
      const [company] = await tx<
        {
          id: string;
          status: string;
          annual_return_basis_date: string;
          assigned_owner_id: string;
          assigned_team_id: string;
          owner_active: boolean;
        }[]
      >`
        select c.id,c.status,c.annual_return_basis_date::text annual_return_basis_date,
          c.assigned_owner_id,c.assigned_team_id,u.active owner_active
        from companies c join users u on u.id = c.assigned_owner_id
        where c.id = ${candidate.matchedCompanyId} for update of c`;
      if (!company || company.status !== "active" || !company.owner_active)
        throw new ImportApplyError("conflict", "COMPANY_OR_OWNER_INACTIVE");
      const [current] = await tx<CaseRecord[]>`
        select id,company_id,filing_due_date::text filing_due_date,current_status,updated_at
        from annual_return_cases where company_id = ${company.id}
          and return_year = ${batch.return_year} for update`;
      const plan = planImportedRow(
        candidate,
        current
          ? {
              id: current.id,
              status: current.current_status,
              filingDueDate: current.filing_due_date,
              updatedAt: new Date(current.updated_at).toISOString(),
            }
          : null,
      );
      if (plan.kind === "conflict")
        throw new ImportApplyError("conflict", plan.reasonCode ?? "ROW_CONFLICT");
      let caseId = current?.id ?? null;
      const before = current
        ? {
            caseExists: true,
            status: current.current_status,
            filingDueDate: current.filing_due_date,
          }
        : { caseExists: false };
      if (plan.kind === "create") {
        const [created] = await tx<{ id: string }[]>`
          insert into annual_return_cases
            (company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
          values (${company.id},${batch.return_year},
            ${madeUpDate(batch.return_year, company.annual_return_basis_date)},
            ${plan.filingDueDate},'Upcoming',${company.assigned_owner_id}) returning id`;
        caseId = created.id;
        await ensureWorkItemForEvent(tx, {
          companyId: company.id,
          caseType: "annual_return",
          annualReturnCaseId: caseId,
          sourceEventKey: `annual-return:${caseId}:created`,
          sourceEventType: "annual_return_case_created",
          workType: "annual_return_case",
          requiredSkillKey: "annual-return",
          title: "Set up new annual return case",
          ownerId: company.assigned_owner_id,
          reviewerId: null,
          teamId: company.assigned_team_id,
        });
      } else if (plan.kind === "update") {
        await tx`update annual_return_cases set filing_due_date = ${plan.filingDueDate},
          updated_at = now() where id = ${current!.id}`;
      }
      if (!caseId) throw new Error("Import case write did not return a case.");
      const after = {
        status: current?.current_status ?? "Upcoming",
        filingDueDate: plan.filingDueDate,
      };
      const [event] = await tx<{ id: string }[]>`
        insert into nar_import_apply_events
          (approval_id,row_id,case_id,company_id,actor_id,row_revision,result,before_values,after_values,raw_source)
        values (${approval.id},${stored.id},${caseId},${company.id},${actor.userId},
          ${stored.revision},${plan.kind === "create" ? "created" : plan.kind === "update" ? "updated" : "skipped"},
          ${tx.json(before)},${tx.json(after)},${tx.json(stored.raw as never)}) returning id`;
      if (plan.paymentObservedDate) {
        const rawDate =
          "raw" in stored.parsed.paymentReceived
            ? stored.parsed.paymentReceived.raw
            : plan.paymentObservedDate;
        await tx`insert into nar_import_payment_observations
          (source_row_id,case_id,company_id,observed_date,raw_value,created_by)
          values (${stored.id},${caseId},${company.id},${plan.paymentObservedDate},${rawDate},${actor.userId})`;
      }
      await tx`insert into annual_return_audit_events
        (case_id,company_id,actor_id,actor_role,action,summary,metadata)
        values (${caseId},${company.id},${actor.userId},'Admin','import_apply',
          ${`Monthly workbook row ${candidate.rowNumber} ${plan.kind}.`},
          ${tx.json({ eventId: event.id, rowId: stored.id, previewId: preview.id, before, after })})`;
      await tx`insert into timeline_events
        (company_id,case_id,event_type,actor_type,actor_id,description,metadata)
        values (${company.id},${caseId},'nar_import_applied','user',${actor.userId},
          ${`Monthly workbook row ${candidate.rowNumber} ${plan.kind}.`},
          ${tx.json({ eventId: event.id, rowId: stored.id, previewId: preview.id })})`;
      const [updated] = await tx<{ revision: number }[]>`
        update nar_import_rows set applied_at = now(),applied_case_id = ${caseId},
          matched_case_id = ${caseId},apply_error = null,
          revision = revision + 1,updated_at = now()
        where id = ${stored.id} returning revision`;
      return {
        state: plan.kind === "skip" ? "skipped" : "succeeded",
        revisionAfter: updated.revision,
        auditRef: event.id,
        reasonCode: plan.reasonCode,
      };
    },
    async close(): Promise<void> {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
