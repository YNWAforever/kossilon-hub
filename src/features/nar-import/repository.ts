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
  type NarSheetReadResult,
  type NarSourceRow,
  type RowIssue,
} from "./mapping";

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
};

function mapBatch(row: BatchRow): NarImportBatch {
  return {
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceSha256: row.source_sha256,
    sourceSizeBytes: Number(row.source_size_bytes),
    sheetName: row.sheet_name,
    parserVersion: row.parser_version,
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
  countByDisposition(batchId: string): Promise<Record<NarRowDisposition, number>>;
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
        const existing = await tx<BatchRow[]>`
          select * from nar_import_batches
          where source_sha256 = ${input.sourceSha256} and sheet_name = ${input.read.sheetName}
          limit 1`;
        if (existing[0]) return { batch: mapBatch(existing[0]), reused: true };

        const batches = await tx<BatchRow[]>`
          insert into nar_import_batches (
            source_system, source_file_name, source_sha256, source_size_bytes, sheet_name,
            parser_version, period_year, period_month, row_count, created_by
          ) values (
            ${NAR_SOURCE_SYSTEM}, ${input.sourceFileName}, ${input.sourceSha256},
            ${input.sourceSizeBytes}, ${input.read.sheetName}, ${input.parserVersion},
            ${input.periodYear ?? null}, ${input.periodMonth ?? null},
            ${input.read.rows.length}, ${input.createdBy ?? null}
          ) returning *`;
        const batch = batches[0];

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

        for (const row of input.read.rows) {
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

          await tx`
            insert into nar_import_rows (
              batch_id, row_number, external_client_id, company_name, raw, parsed, issues,
              disposition, matched_company_id, matched_case_id
            ) values (
              ${batch.id}, ${row.rowNumber}, ${row.externalClientId}, ${row.companyName},
              ${tx.json(row.raw as never)}, ${tx.json(parsedPayload(row) as never)},
              ${tx.json([...row.issues, ...decision.issues] as never)},
              ${DISPOSITION_TO_COLUMN[decision.disposition]}, ${matchedCompanyId},
              ${existingCase?.id ?? null}
            )
            on conflict (batch_id, row_number) do nothing`;
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

    async mapExternalReference(input) {
      // Upserted rather than inserted: a staff member correcting an earlier
      // mistake is the normal case, and the unique constraint on
      // (source_system, external_client_id) is what makes it a correction rather
      // than a second, contradictory binding.
      await sql`
        insert into company_external_references (
          source_system, external_client_id, company_id, mapped_by
        ) values (
          ${input.sourceSystem ?? NAR_SOURCE_SYSTEM}, ${input.externalClientId},
          ${input.companyId}, ${input.mappedBy ?? null}
        )
        on conflict (source_system, external_client_id)
        do update set company_id = excluded.company_id, mapped_by = excluded.mapped_by,
          updated_at = now()`;
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
