import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import {
  dispositionFor,
  type NarRowDisposition,
  type NarColumnKey,
  type NarSheetReadResult,
  type NarSourceRow,
  type RowIssue,
} from "./mapping";
import { emptyImportCounts, previewRowFor, semanticKeyFor, type ImportPreview } from "./preview";
import { refreshImportRows } from "./revalidation";

/**
 * Staging for a parsed workbook.
 *
 * Every write here lands in the three staging tables and nowhere else. The
 * importer creates no company, no case and no payment: `companies` needs six
 * NOT NULL fields the workbook does not carry plus two globally unique registry
 * numbers, and `payments` needs an amount the workbook never states. Inventing
 * either is how an import quietly corrupts a firm's book of record.
 */

export const NAR_SOURCE_SYSTEM = "nar-monthly-workbook";

/**
 * What a jsonb column round-trips as.
 *
 * Spelled out rather than left as `unknown` because these values cross a server
 * function boundary, and TanStack Start checks at compile time that everything
 * it sends is serialisable -- `unknown` is not.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type QueryClient = SqlClient | postgres.TransactionSql;
type NarSqlOptions = CreateSqlClientOptions & { sql?: QueryClient };

export type NarImportBatchStatus =
  | "pending_review"
  | "applying"
  | "applied"
  | "cancelled"
  | "failed";

export type NarImportBatch = {
  id: string;
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  sheetName: string;
  parserVersion: string;
  returnYear: number | null;
  revision: number;
  mappingRevision: number;
  semanticKey: string | null;
  columnMapping: Record<NarColumnKey, string> | null;
  periodYear: number | null;
  periodMonth: number | null;
  status: NarImportBatchStatus;
  rowCount: number;
  createdAt: string;
  appliedAt: string | null;
};

export type NarImportRow = {
  id: string;
  batchId: string;
  rowNumber: number;
  externalClientId: string;
  companyName: string;
  raw: JsonValue;
  parsed: JsonValue;
  issues: RowIssue[];
  disposition: NarRowDisposition;
  matchedCompanyId: string | null;
  matchedCaseId: string | null;
  appliedAt: string | null;
  appliedCaseId: string | null;
  applyError: string | null;
  revision: number;
};

/** DB spelling of the disposition, which is snake_case in the check constraint. */
const DISPOSITION_TO_COLUMN: Record<NarRowDisposition, string> = {
  new: "new",
  updated: "updated",
  unchanged: "unchanged",
  conflict: "conflict",
  invalid: "invalid",
  needsCompanyMapping: "needs_company_mapping",
};
const COLUMN_TO_DISPOSITION: Record<string, NarRowDisposition> = Object.fromEntries(
  Object.entries(DISPOSITION_TO_COLUMN).map(([key, value]) => [value, key]),
) as Record<string, NarRowDisposition>;

type BatchRow = {
  id: string;
  source_file_name: string;
  source_sha256: string;
  source_size_bytes: string | number;
  sheet_name: string;
  parser_version: string;
  return_year: number | null;
  revision: number;
  mapping_revision: number;
  semantic_key: string | null;
  column_mapping: Record<NarColumnKey, string> | null;
  period_year: number | null;
  period_month: number | null;
  status: NarImportBatchStatus;
  row_count: number;
  created_at: string | Date;
  applied_at: string | Date | null;
};

type ImportRowRow = {
  id: string;
  batch_id: string;
  row_number: number;
  external_client_id: string;
  company_name: string;
  raw: JsonValue;
  parsed: JsonValue;
  issues: JsonValue;
  disposition: string;
  matched_company_id: string | null;
  matched_case_id: string | null;
  applied_at: string | Date | null;
  applied_case_id: string | null;
  apply_error: string | null;
  source_issues: JsonValue | null;
  revision: number;
};

function mapBatch(row: BatchRow): NarImportBatch {
  return {
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceSha256: row.source_sha256,
    sourceSizeBytes: Number(row.source_size_bytes),
    sheetName: row.sheet_name,
    parserVersion: row.parser_version,
    returnYear: row.return_year,
    revision: row.revision,
    mappingRevision: row.mapping_revision,
    semanticKey: row.semantic_key,
    columnMapping: row.column_mapping,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    status: row.status,
    rowCount: row.row_count,
    createdAt: new Date(row.created_at).toISOString(),
    appliedAt: row.applied_at === null ? null : new Date(row.applied_at).toISOString(),
  };
}

function mapRow(row: ImportRowRow): NarImportRow {
  return {
    id: row.id,
    batchId: row.batch_id,
    rowNumber: row.row_number,
    externalClientId: row.external_client_id,
    companyName: row.company_name,
    raw: row.raw,
    parsed: row.parsed,
    issues: Array.isArray(row.issues) ? (row.issues as RowIssue[]) : [],
    disposition: COLUMN_TO_DISPOSITION[row.disposition] ?? "invalid",
    matchedCompanyId: row.matched_company_id,
    matchedCaseId: row.matched_case_id,
    appliedAt: row.applied_at === null ? null : new Date(row.applied_at).toISOString(),
    appliedCaseId: row.applied_case_id,
    applyError: row.apply_error,
    revision: row.revision,
  };
}

function withTransaction<T>(
  client: QueryClient,
  callback: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return "begin" in client
    ? (client.begin(callback) as Promise<T>)
    : callback(client as postgres.TransactionSql);
}

/** The serialisable shape of a parsed row, for the `parsed` column. */
function parsedPayload(row: NarSourceRow) {
  return {
    incorporation: row.incorporation,
    invoice: row.invoice,
    paymentReceived: row.paymentReceived,
    arDue: row.arDue,
    brDue: row.brDue,
  };
}

export type StageBatchInput = {
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  parserVersion: string;
  returnYear: number;
  periodYear?: number | null;
  periodMonth?: number | null;
  createdBy?: string | null;
  read: NarSheetReadResult;
};

export type NarImportRepository = {
  /**
   * Parse results in, staged batch out. Idempotent on the source bytes: the same
   * file and sheet resolves to the same batch rather than a second copy.
   */
  stageBatch(input: StageBatchInput): Promise<{ batch: NarImportBatch; reused: boolean }>;
  getBatch(id: string): Promise<NarImportBatch | null>;
  listBatches(limit?: number): Promise<NarImportBatch[]>;
  listRows(batchId: string): Promise<NarImportRow[]>;
  listRowsPage(
    batchId: string,
    afterRowNumber: number | null,
    limit: number,
  ): Promise<{
    items: NarImportRow[];
    nextCursor: number | null;
  }>;
  countByDisposition(batchId: string): Promise<Record<NarRowDisposition, number>>;
  revalidate(
    batchId: string,
    actorId: string,
    expectedRevision: number,
    returnYear?: number,
  ): Promise<ImportPreview>;
  listPreviewPage(input: {
    previewId: string;
    actorId: string;
    offset: number;
    limit: number;
  }): Promise<{
    rows: ImportPreview["rows"];
    totalRows: number;
    nextOffset: number | null;
  }>;
  searchCompanies(input: { q: string; cursor: string | null; limit: number }): Promise<{
    items: { id: string; companyName: string; crNumber: string; brNumber: string }[];
    nextCursor: string | null;
  }>;
  /** Bind an external client id to a company a person has chosen. */
  mapExternalReference(input: {
    sourceSystem?: string;
    externalClientId: string;
    companyId: string;
    mappedBy?: string | null;
  }): Promise<void>;
  close(): Promise<void>;
};

export function createNarImportRepository(options?: NarSqlOptions): NarImportRepository;
export function createNarImportRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): NarImportRepository;
export function createNarImportRepository(
  databaseUrlOrOptions: string | NarSqlOptions = {},
  maybeOptions: CreateSqlClientOptions = {},
): NarImportRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    async stageBatch(input) {
      return withTransaction(sql, async (tx) => {
        // The same bytes and sheet are the same batch. A staff member who
        // re-uploads the file they already uploaded gets the review they left,
        // not a duplicate of it.
        if (
          !Number.isInteger(input.returnYear) ||
          input.returnYear < 1900 ||
          input.returnYear > 2100
        )
          throw new Error("Choose an explicit return year between 1900 and 2100.");
        const existing = await tx<BatchRow[]>`
          select * from nar_import_batches
          where source_sha256 = ${input.sourceSha256} and sheet_name = ${input.read.sheetName}
            and return_year = ${input.returnYear} and parser_version = ${input.parserVersion}
          limit 1`;
        if (existing[0]) return { batch: mapBatch(existing[0]), reused: true };

        const semanticKey = [
          input.sourceSha256,
          input.read.sheetName,
          input.returnYear,
          input.parserVersion,
          0,
        ].join(":");
        const batches = await tx<BatchRow[]>`
          insert into nar_import_batches (
            source_system, source_file_name, source_sha256, source_size_bytes, sheet_name,
            parser_version, return_year, semantic_key, column_mapping,
            period_year, period_month, row_count, created_by
          ) values (
            ${NAR_SOURCE_SYSTEM}, ${input.sourceFileName}, ${input.sourceSha256},
            ${input.sourceSizeBytes}, ${input.read.sheetName}, ${input.parserVersion},
            ${input.returnYear}, ${semanticKey}, ${tx.json(input.read.columns as never)},
            ${input.periodYear ?? null}, ${input.periodMonth ?? null},
            ${input.read.rows.length}, ${input.createdBy ?? null}
          ) on conflict do nothing returning *`;
        const batch = batches[0];
        if (!batch) {
          const [raced] = await tx<BatchRow[]>`
            select * from nar_import_batches where source_sha256 = ${input.sourceSha256}
              and sheet_name = ${input.read.sheetName} and return_year = ${input.returnYear}
              and parser_version = ${input.parserVersion}`;
          if (!raced) throw new Error("Unable to resolve concurrent import staging.");
          return { batch: mapBatch(raced), reused: true };
        }

        // Resolve every external id in one read rather than per row: a monthly
        // sheet is tens to hundreds of rows and a query each would be that many
        // round trips for a lookup the database can answer once.
        const externalIds = input.read.rows.map((row) => row.externalClientId);
        const references = externalIds.length
          ? await tx<{ external_client_id: string; company_id: string }[]>`
              select external_client_id, company_id from company_external_references
              where source_system = ${NAR_SOURCE_SYSTEM}
                and external_client_id = any(${externalIds}::text[])`
          : [];
        const companyByExternalId = new Map(
          references.map((row) => [row.external_client_id, row.company_id]),
        );

        const companyIds = [...new Set(companyByExternalId.values())];
        const cases = companyIds.length
          ? await tx<
              {
                id: string;
                company_id: string;
                return_year: number;
                filing_due_date: string;
                has_progress: boolean;
              }[]
            >`
              select
                arc.id,
                arc.company_id,
                arc.return_year,
                arc.filing_due_date::text as filing_due_date,
                -- "Someone has worked this" -- any of the signals that a person
                -- has touched the case. The source must not overwrite those
                -- without a human seeing the disagreement first.
                (
                  arc.current_status <> 'Upcoming'
                  or arc.reminders_sent > 0
                  or arc.locked_at is not null
                  or arc.completed_at is not null
                  or arc.filing_reference is not null
                  or exists (
                    select 1 from annual_return_checklist_items i
                    where i.case_id = arc.id and i.status <> 'Missing'
                  )
                ) as has_progress
              from annual_return_cases arc
              where arc.company_id = any(${companyIds}::uuid[])
                and arc.return_year = ${input.returnYear}`
          : [];
        const caseByCompanyId = new Map(cases.map((row) => [row.company_id, row]));

        const stagedRows = input.read.rows.map((row) => {
          const matchedCompanyId = companyByExternalId.get(row.externalClientId) ?? null;
          const existingCase = matchedCompanyId ? caseByCompanyId.get(matchedCompanyId) : undefined;
          const decision = dispositionFor(row, {
            matchedCompanyId,
            existingCase: existingCase
              ? {
                  caseId: existingCase.id,
                  returnYear: existingCase.return_year,
                  filingDueDate: existingCase.filing_due_date,
                  hasStaffProgress: existingCase.has_progress,
                }
              : null,
            returnYear: input.returnYear,
          });
          return {
            row_number: row.rowNumber,
            external_client_id: row.externalClientId,
            company_name: row.companyName,
            raw: row.raw,
            parsed: parsedPayload(row),
            issues: [...row.issues, ...decision.issues],
            source_issues: row.issues,
            disposition: DISPOSITION_TO_COLUMN[decision.disposition],
            matched_company_id: matchedCompanyId,
            matched_case_id: existingCase?.id ?? null,
          };
        });
        if (stagedRows.length > 0) {
          await tx`
            insert into nar_import_rows (
              batch_id,row_number,external_client_id,company_name,raw,parsed,issues,
              source_issues,disposition,matched_company_id,matched_case_id
            )
            select ${batch.id}, r.row_number, r.external_client_id, r.company_name,
              r.raw, r.parsed, r.issues, r.source_issues, r.disposition,
              r.matched_company_id, r.matched_case_id
            from jsonb_to_recordset(${tx.json(stagedRows as never)}::jsonb) as r(
              row_number integer, external_client_id text, company_name text,
              raw jsonb, parsed jsonb, issues jsonb, source_issues jsonb,
              disposition text, matched_company_id uuid, matched_case_id uuid
            )
            on conflict (batch_id,row_number) do nothing
          `;
        }

        return { batch: mapBatch(batch), reused: false };
      });
    },

    async getBatch(id) {
      const rows = await sql<BatchRow[]>`select * from nar_import_batches where id = ${id}`;
      return rows[0] ? mapBatch(rows[0]) : null;
    },

    async listBatches(limit = 50) {
      const rows = await sql<BatchRow[]>`
        select * from nar_import_batches order by created_at desc limit ${limit}`;
      return rows.map(mapBatch);
    },

    async listRows(batchId) {
      const rows = await sql<ImportRowRow[]>`
        select * from nar_import_rows where batch_id = ${batchId} order by row_number asc`;
      return rows.map(mapRow);
    },

    async listRowsPage(batchId, afterRowNumber, limit) {
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (afterRowNumber !== null && (!Number.isInteger(afterRowNumber) || afterRowNumber < 1))
      )
        throw new Error("Invalid import page cursor or limit.");
      const rows = await sql<ImportRowRow[]>`
        select * from nar_import_rows where batch_id = ${batchId}
          and (${afterRowNumber}::integer is null or row_number > ${afterRowNumber})
        order by row_number limit ${limit + 1}`;
      const items = rows.slice(0, limit).map(mapRow);
      return { items, nextCursor: rows.length > limit ? items[items.length - 1].rowNumber : null };
    },

    async countByDisposition(batchId) {
      const rows = await sql<{ disposition: string; count: string }[]>`
        select disposition, count(*) count from nar_import_rows
        where batch_id = ${batchId} group by disposition`;
      const counts: Record<NarRowDisposition, number> = {
        new: 0,
        updated: 0,
        unchanged: 0,
        conflict: 0,
        invalid: 0,
        needsCompanyMapping: 0,
      };
      for (const row of rows) {
        const key = COLUMN_TO_DISPOSITION[row.disposition];
        if (key) counts[key] = Number(row.count);
      }
      return counts;
    },

    async revalidate(batchId, actorId, expectedRevision, returnYear) {
      return withTransaction(sql, async (tx) => {
        let [locked] = await tx<BatchRow[]>`
          select * from nar_import_batches where id = ${batchId} for update`;
        if (!locked) throw new Error("Import batch not found.");
        if (locked.status !== "pending_review" && locked.status !== "failed")
          throw new Error("Only a pending or failed import can be revalidated.");
        const wasFailed = locked.status === "failed";
        if (wasFailed) {
          const [active] = await tx<{ id: string }[]>`
            select o.id from bulk_operations o
            join bulk_previews p on p.id = o.preview_id
            join nar_import_approvals a on a.id = (p.parameters->>'approvalId')::uuid
            where a.batch_id = ${batchId} and o.action = 'importApply'
              and o.state in ('queued','running') limit 1`;
          if (active) throw new Error("An approved import is still running.");
          await tx`update nar_import_batches set status = 'pending_review',updated_at = now()
            where id = ${batchId}`;
        }
        if (locked.revision !== expectedRevision)
          throw new Error("Import preview is stale; refresh the batch before revalidation.");
        let assignedLegacyYear = false;
        if (locked.return_year === null) {
          if (returnYear === undefined)
            throw new Error("Legacy import batch needs an explicit return year.");
          if (!Number.isInteger(returnYear) || returnYear < 1900 || returnYear > 2100)
            throw new Error("Choose an explicit return year between 1900 and 2100.");
          const semanticKey = [
            locked.source_sha256,
            locked.sheet_name,
            returnYear,
            locked.parser_version,
            locked.mapping_revision,
          ].join(":");
          try {
            [locked] = await tx<
              BatchRow[]
            >`update nar_import_batches set return_year = ${returnYear},
              semantic_key = ${semanticKey},revision = revision + 1,updated_at = now()
              where id = ${batchId} returning *`;
          } catch (error) {
            if (error instanceof Error && /duplicate key/.test(error.message))
              throw new Error("This file and return year already have a separate import batch.");
            throw error;
          }
          assignedLegacyYear = true;
        } else if (returnYear !== undefined && returnYear !== locked.return_year) {
          throw new Error("Return year differs from this batch; create a new semantic preview.");
        }
        const changed = await refreshImportRows(tx, locked);
        if ((changed || wasFailed) && !assignedLegacyYear)
          await tx`update nar_import_batches set revision = revision + 1,
          updated_at = now() where id = ${batchId}`;
        const [fresh] = await tx<
          BatchRow[]
        >`select * from nar_import_batches where id = ${batchId}`;
        const mapped = mapBatch(fresh);
        const semanticKey = semanticKeyFor(mapped);
        const savedRows = await tx<ImportRowRow[]>`
          select * from nar_import_rows where batch_id = ${batchId} order by row_number`;
        const caseIds = savedRows
          .map((row) => row.matched_case_id)
          .filter((id): id is string => Boolean(id));
        const cases = caseIds.length
          ? await tx<
              {
                id: string;
                filing_due_date: string;
                has_progress: boolean;
                current_status: string;
                updated_at: string | Date;
              }[]
            >`
          select arc.id,arc.filing_due_date::text filing_due_date,
            arc.current_status,arc.updated_at,
            (arc.current_status <> 'Upcoming' or arc.reminders_sent > 0 or arc.locked_at is not null
              or arc.completed_at is not null or arc.filing_reference is not null
              or exists (select 1 from annual_return_checklist_items i
                where i.case_id = arc.id and i.status <> 'Missing')) has_progress
          from annual_return_cases arc where arc.id = any(${caseIds}::uuid[])`
          : [];
        const caseById = new Map(cases.map((item) => [item.id, item]));
        const rows = savedRows.map((raw) => {
          const row = mapRow(raw);
          const existing = row.matchedCaseId ? caseById.get(row.matchedCaseId) : undefined;
          return previewRowFor(
            row,
            existing
              ? {
                  filingDueDate: existing.filing_due_date,
                  hasStaffProgress: existing.has_progress,
                  status: existing.current_status,
                  updatedAt: new Date(existing.updated_at).toISOString(),
                }
              : null,
            mapped.columnMapping,
          );
        });
        const counts = emptyImportCounts();
        for (const row of rows) counts[row.disposition] += 1;
        const hashBytes = new TextEncoder().encode(
          JSON.stringify({ semanticKey, revision: mapped.revision, actorId, rows, counts }),
        );
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", hashBytes));
        const previewHash = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
        const rowsById = Object.fromEntries(rows.map((row) => [row.rowId, row]));
        const [preview] = await tx<{ id: string; expires_at: string | Date }[]>`
          insert into nar_import_previews (
            batch_id,batch_revision,semantic_key,preview_hash,counts,rows,rows_by_id,created_by,expires_at
          ) values (${batchId},${mapped.revision},${semanticKey},${previewHash},
            ${tx.json(counts as never)},${tx.json(rows as never)},
            ${tx.json(rowsById as never)},${actorId},
            ${new Date(Date.now() + 15 * 60_000).toISOString()})
          on conflict (batch_id,batch_revision,preview_hash,created_by)
          do update set expires_at = excluded.expires_at returning id,expires_at`;
        return {
          id: preview.id,
          batchId,
          revision: mapped.revision,
          semanticKey,
          previewHash,
          counts,
          rows: rows.slice(0, 50),
          totalRows: rows.length,
          expiresAt: new Date(preview.expires_at).toISOString(),
        };
      });
    },

    async listPreviewPage(input) {
      if (
        !Number.isInteger(input.offset) ||
        input.offset < 0 ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 50
      )
        throw new Error("Invalid import preview page.");
      const [page] = await sql<{ rows: ImportPreview["rows"]; total: number }[]>`
        select jsonb_array_length(p.rows) as total,
          coalesce((
            select jsonb_agg(p.rows -> index_ order by index_)
            from generate_series(${input.offset}::integer, ${input.offset + input.limit - 1}::integer) index_
            where index_ < jsonb_array_length(p.rows)
          ), '[]'::jsonb) as rows
        from nar_import_previews p
        where p.id = ${input.previewId} and p.created_by = ${input.actorId}
      `;
      if (!page) throw new Error("Import preview not found.");
      return {
        rows: page.rows,
        totalRows: page.total,
        nextOffset:
          input.offset + page.rows.length < page.total ? input.offset + page.rows.length : null,
      };
    },

    async searchCompanies(input) {
      const q = input.q.trim();
      if (q.length > 120 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)
        throw new Error("Invalid company search limit or query.");
      const rows = await sql<
        { id: string; company_name: string; cr_number: string; br_number: string }[]
      >`
        select id,company_name,cr_number,br_number from companies
        where status = 'active'
          and (${q} = '' or position(lower(${q}) in lower(company_name)) > 0
            or position(lower(${q}) in lower(cr_number)) > 0)
          and (${input.cursor}::uuid is null or (company_name,id) > (
            select company_name,id from companies where id = ${input.cursor}::uuid
          ))
        order by company_name,id limit ${input.limit + 1}`;
      const items = rows.slice(0, input.limit).map((row) => ({
        id: row.id,
        companyName: row.company_name,
        crNumber: row.cr_number,
        brNumber: row.br_number,
      }));
      return { items, nextCursor: rows.length > input.limit ? items[items.length - 1].id : null };
    },

    async mapExternalReference(input) {
      await withTransaction(sql, async (tx) => {
        const sourceSystem = input.sourceSystem ?? NAR_SOURCE_SYSTEM;
        if (sourceSystem !== NAR_SOURCE_SYSTEM)
          throw new Error("Unsupported import reference namespace.");
        const [company] = await tx<{ id: string }[]>`
          select id from companies where id = ${input.companyId} and status = 'active'`;
        if (!company) throw new Error("Selected company is not active or accessible.");
        const [old] = await tx<{ company_id: string }[]>`
          select company_id from company_external_references
          where source_system = ${sourceSystem} and external_client_id = ${input.externalClientId}
          for update`;
        if (old && old.company_id !== input.companyId)
          throw new Error(
            "Mapping conflict: this client ID belongs to another company; review the existing mapping before changing it.",
          );
        const mappingChanged = !old;
        const [applied] = await tx<{ id: string }[]>`
          select r.id from nar_import_rows r join nar_import_batches b on b.id = r.batch_id
          where b.source_system = ${sourceSystem} and r.external_client_id = ${input.externalClientId}
            and r.applied_at is not null and r.matched_company_id is distinct from ${input.companyId}
          limit 1`;
        if (applied) throw new Error("Applied import rows prevent remapping this client ID.");
        if (mappingChanged)
          await tx`
          insert into company_external_references (
            source_system, external_client_id, company_id, mapped_by
          ) values (${sourceSystem},${input.externalClientId},${input.companyId},${input.mappedBy ?? null})
          on conflict (source_system, external_client_id)
          do update set company_id = excluded.company_id, mapped_by = excluded.mapped_by,
            updated_at = now()`;
        const batchIds = await tx<{ id: string }[]>`
          select distinct b.id from nar_import_batches b
          join nar_import_rows r on r.batch_id = b.id
          where b.source_system = ${sourceSystem} and r.external_client_id = ${input.externalClientId}
            and r.applied_at is null and b.status = 'pending_review'
          order by b.id`;
        for (const { id } of batchIds) {
          const [batch] = await tx<BatchRow[]>`
            select * from nar_import_batches where id = ${id} for update`;
          const changed = await refreshImportRows(tx, batch, input.externalClientId);
          if (!changed) continue;
          const mappingRevision = batch.mapping_revision + 1;
          const semanticKey = semanticKeyFor({ ...mapBatch(batch), mappingRevision });
          await tx`update nar_import_batches set mapping_revision = ${mappingRevision},
            revision = revision + 1, semantic_key = ${semanticKey}, updated_at = now()
            where id = ${id}`;
        }
      });
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
