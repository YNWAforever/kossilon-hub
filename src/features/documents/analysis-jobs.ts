import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";

/**
 * Durable document-analysis work.
 *
 * These mechanics are `document_scan_jobs`', which are `notification_outbox`'s:
 * claim with `for update skip locked`, attempt_count incremented at claim and
 * used as a fencing token in every terminal write, exponential backoff, and a
 * visibility timeout that reclaims rows stranded by a Worker killed mid-run.
 * Two queues in this codebase already work this way and their failure modes are
 * documented; a third variant would be the mistake, so the only things that
 * differ here are the payload and the reasons.
 *
 * Keyed on a document VERSION rather than an upload intent, because a version is
 * what a finding cites and what an approval names. A replacement upload becomes
 * its own version and gets its own job, instead of colliding with the analysis
 * of the bytes it replaced.
 */

type QueryClient = SqlClient | postgres.TransactionSql;
type AnalysisJobSqlOptions = CreateSqlClientOptions & { sql?: QueryClient };

export type AnalysisJobStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type AnalysisJobReason = "initial" | "reanalysis" | "retry";

export type DocumentAnalysisJob = {
  id: string;
  documentVersionId: string;
  reason: AnalysisJobReason;
  idempotencyKey: string;
  status: AnalysisJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
};

type AnalysisJobRow = {
  id: string;
  document_version_id: string;
  reason: AnalysisJobReason;
  idempotency_key: string;
  status: AnalysisJobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | Date;
  last_error_code: string | null;
  last_error_message: string | null;
  completed_at: string | Date | null;
  created_at: string | Date;
};

const RETRY_BASE_SECONDS = 60;
const RETRY_MAX_SECONDS = 60 * 60;

/**
 * How long a job may sit in 'processing' before another run may claim it.
 *
 * Shorter than the scan queue's thirty minutes because the tiers that actually
 * run are local: a byte sample and a few record comparisons, measured in
 * milliseconds. Nothing here waits on a third party.
 *
 * Revisit this when the provider tier is enabled. Submitting a document to a
 * model can legitimately take minutes, and a fifteen-minute window would then be
 * reclaiming work that is still alive -- which is safe, because the fence makes
 * the loser's write a no-op, but wasteful.
 */
const PROCESSING_VISIBILITY_TIMEOUT_SECONDS = 15 * 60;

export function analysisProcessingReclaimCutoff(now: string): string {
  return new Date(Date.parse(now) - PROCESSING_VISIBILITY_TIMEOUT_SECONDS * 1000).toISOString();
}

export function nextAnalysisAttemptAt(attempt: number, now: string): string {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const delaySeconds = Math.min(
    RETRY_MAX_SECONDS,
    RETRY_BASE_SECONDS * 2 ** Math.min(normalizedAttempt - 1, 10),
  );
  return new Date(Date.parse(now) + delaySeconds * 1000).toISOString();
}

/**
 * One job per version, plus one more for each deliberate re-analysis.
 *
 * The version id alone is enough to be content-specific -- unlike the scan
 * queue, which needs the checksum in its key because an intent can be re-used
 * across content. A version is immutable, so its id already names the bytes.
 */
export function analysisJobIdempotencyKey(input: {
  documentVersionId: string;
  reason?: AnalysisJobReason;
  /**
   * Distinguishes repeated deliberate re-runs from each other. Without it a
   * second re-analysis would silently return the first one's finished job.
   */
  runKey?: string;
}): string {
  const base = `analysis:${input.documentVersionId}`;
  if (input.reason !== "reanalysis") return base;
  return input.runKey ? `${base}:reanalysis:${input.runKey}` : `${base}:reanalysis`;
}

function mapRow(row: AnalysisJobRow): DocumentAnalysisJob {
  return {
    id: row.id,
    documentVersionId: row.document_version_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at).toISOString(),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Enqueue on the caller's client, so this can run in the same transaction as the
 * finalize that creates the version. A version must never exist without
 * outstanding analysis work: enqueuing after the commit would leave a Worker
 * killed in between with a document nothing will ever look at, and no error
 * anywhere to say so.
 */
export async function enqueueDocumentAnalysisJob(
  client: QueryClient,
  input: {
    documentVersionId: string;
    reason?: AnalysisJobReason;
    runKey?: string;
    maxAttempts?: number;
  },
): Promise<DocumentAnalysisJob> {
  const reason = input.reason ?? "initial";
  const idempotencyKey = analysisJobIdempotencyKey(input);
  const rows = await client<AnalysisJobRow[]>`
    insert into document_analysis_jobs (document_version_id, reason, idempotency_key, max_attempts)
    values (${input.documentVersionId}, ${reason}, ${idempotencyKey}, ${input.maxAttempts ?? 5})
    on conflict (idempotency_key) do nothing
    returning *
  `;
  if (rows[0]) return mapRow(rows[0]);

  const existing = await client<AnalysisJobRow[]>`
    select * from document_analysis_jobs where idempotency_key = ${idempotencyKey} limit 1
  `;
  if (!existing[0]) throw new Error("Unable to load idempotent document analysis job.");
  return mapRow(existing[0]);
}

function withTransaction<T>(
  client: QueryClient,
  callback: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return "begin" in client
    ? (client.begin(callback) as Promise<T>)
    : callback(client as postgres.TransactionSql);
}

export type DocumentAnalysisJobRepository = {
  enqueue(input: {
    documentVersionId: string;
    reason?: AnalysisJobReason;
    runKey?: string;
    maxAttempts?: number;
  }): Promise<DocumentAnalysisJob>;
  claimDue(now: string, limit: number): Promise<DocumentAnalysisJob[]>;
  /**
   * Terminal writes take the attempt_count the claim returned and fence on it.
   *
   * Without the fence they would match on `status = 'processing'` alone, and
   * because the reclaim re-enters that same state, a slow-but-alive run and its
   * reclaimer could both write -- whichever landed first winning while the other
   * silently matched nothing and was still counted. `false` means this claim was
   * superseded and must not be counted or applied.
   */
  markSucceeded(id: string, input: { now: string; attemptCount: number }): Promise<boolean>;
  markRetry(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string; attemptCount: number },
  ): Promise<boolean>;
  markFailed(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string; attemptCount: number },
  ): Promise<boolean>;
  /** Superseded because a newer version of the document exists. Kept as history. */
  cancelForSupersededVersion(documentVersionId: string): Promise<{ cancelled: number }>;
  listForVersion(documentVersionId: string): Promise<DocumentAnalysisJob[]>;
  close(): Promise<void>;
};

export function createDocumentAnalysisJobRepository(
  options?: AnalysisJobSqlOptions,
): DocumentAnalysisJobRepository;
export function createDocumentAnalysisJobRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): DocumentAnalysisJobRepository;
export function createDocumentAnalysisJobRepository(
  databaseUrlOrOptions: string | AnalysisJobSqlOptions = {},
  maybeOptions: CreateSqlClientOptions = {},
): DocumentAnalysisJobRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    enqueue: (input) => enqueueDocumentAnalysisJob(sql, input),

    async claimDue(now, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("Document analysis job limit must be between 1 and 500.");
      }
      return withTransaction(sql, async (tx) => {
        const rows = await tx<AnalysisJobRow[]>`
          select * from document_analysis_jobs
          where attempt_count < max_attempts
            and (
              (status in ('pending', 'failed') and next_attempt_at <= ${now})
              -- Stranded by a Worker that died mid-run. Without this the job is
              -- never claimable again and the document is silently never
              -- analysed.
              or (status = 'processing' and updated_at <= ${analysisProcessingReclaimCutoff(now)})
            )
          order by next_attempt_at asc, created_at asc
          limit ${limit}
          for update skip locked
        `;
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.id);
        const claimed = await tx<AnalysisJobRow[]>`
          update document_analysis_jobs
          set status = 'processing', attempt_count = attempt_count + 1, updated_at = now()
          where id = any(${ids}::uuid[])
          returning *
        `;
        return claimed.map(mapRow);
      });
    },

    async markSucceeded(id, input) {
      const rows = await sql<{ id: string }[]>`
        update document_analysis_jobs
        set status = 'succeeded', completed_at = ${input.now}, updated_at = now(),
          last_error_code = null, last_error_message = null
        where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
        returning id
      `;
      return rows.length === 1;
    },

    async markRetry(id, input) {
      let applied = false;
      await withTransaction(sql, async (tx) => {
        // Re-read under the lock and compute the backoff from the stored
        // attempt_count rather than the caller's. They agree on the happy path;
        // when they do not, the row is authoritative and the caller is stale.
        const rows = await tx<{ attempt_count: number }[]>`
          select attempt_count from document_analysis_jobs where id = ${id} for update
        `;
        if (!rows[0]) throw new Error("Document analysis job not found.");
        const updated = await tx<{ id: string }[]>`
          update document_analysis_jobs
          set status = 'failed', next_attempt_at = ${nextAnalysisAttemptAt(rows[0].attempt_count, input.now)},
            last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage},
            updated_at = now()
          where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
          returning id
        `;
        applied = updated.length === 1;
      });
      return applied;
    },

    async markFailed(id, input) {
      // Terminal by burning the attempt budget, which is what makes claimDue's
      // `attempt_count < max_attempts` predicate refuse the row from now on.
      const rows = await sql<{ id: string }[]>`
        update document_analysis_jobs
        set status = 'failed', attempt_count = max_attempts, completed_at = ${input.now},
          last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage},
          updated_at = now()
        where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
        returning id
      `;
      return rows.length === 1;
    },

    async cancelForSupersededVersion(documentVersionId) {
      const rows = await sql<{ id: string }[]>`
        update document_analysis_jobs
        set status = 'cancelled', completed_at = now(), updated_at = now(),
          last_error_code = 'superseded-version'
        where document_version_id = ${documentVersionId}
          and status in ('pending', 'failed', 'processing')
        returning id
      `;
      return { cancelled: rows.length };
    },

    async listForVersion(documentVersionId) {
      const rows = await sql<AnalysisJobRow[]>`
        select * from document_analysis_jobs
        where document_version_id = ${documentVersionId}
        order by created_at desc
      `;
      return rows.map(mapRow);
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
