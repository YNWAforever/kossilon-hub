import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";

/**
 * Durable malware-scan work.
 *
 * Before this, `scanQuarantinedDocument` was a staff-triggered HTTP call with
 * zero production callers -- no UI, no cron, no queue -- so a received document
 * stayed quarantined until a human invoked the API by hand, while the expiry
 * sweep deleted its bytes 15 minutes after the intent was created.
 *
 * The mechanics below are `notification_outbox`'s, on purpose. That queue's
 * failure modes are already understood and documented in
 * `src/features/notifications/outbox.ts`, and the plan asks for the existing job
 * conventions to be extended rather than a second general queue invented. What
 * differs is only the payload and the terminal states.
 */

type QueryClient = SqlClient | postgres.TransactionSql;
type ScanJobSqlOptions = CreateSqlClientOptions & { sql?: QueryClient };

export type ScanJobStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type ScanJobReason = "initial" | "rescan" | "retry";

export type DocumentScanJob = {
  id: string;
  intentId: string;
  checksum: string;
  reason: ScanJobReason;
  idempotencyKey: string;
  status: ScanJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ScanJobRow = {
  id: string;
  intent_id: string;
  checksum_sha256: string;
  reason: ScanJobReason;
  idempotency_key: string;
  status: ScanJobStatus;
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
 * Same reasoning as the outbox's: a Worker killed between the claim and the
 * terminal write -- a CPU limit, an eviction, a deploy -- would otherwise strand
 * the job permanently and the file would never be scanned, with no error
 * anywhere. Longer than the outbox's window because a scan submits bytes to a
 * provider and can legitimately take minutes, where a dispatch takes seconds.
 * attempt_count is incremented at claim time, so a job that strands repeatedly
 * still exhausts max_attempts instead of looping forever.
 */
const PROCESSING_VISIBILITY_TIMEOUT_SECONDS = 30 * 60;

export function scanProcessingReclaimCutoff(now: string): string {
  return new Date(Date.parse(now) - PROCESSING_VISIBILITY_TIMEOUT_SECONDS * 1000).toISOString();
}

export function nextScanAttemptAt(attempt: number, now: string): string {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const delaySeconds = Math.min(
    RETRY_MAX_SECONDS,
    RETRY_BASE_SECONDS * 2 ** Math.min(normalizedAttempt - 1, 10),
  );
  return new Date(Date.parse(now) + delaySeconds * 1000).toISOString();
}

/**
 * One job per intent per content version.
 *
 * The checksum is in the key, not just the intent id, so a replacement upload
 * gets its own job rather than colliding with the old one; and `rescan` is
 * suffixed so ordering a genuine re-scan of an already-verdicted file does not
 * collide with that file's original job.
 */
export function scanJobIdempotencyKey(input: {
  intentId: string;
  checksum: string;
  reason?: ScanJobReason;
}): string {
  const base = `scan:${input.intentId}:${input.checksum}`;
  return input.reason === "rescan" ? `${base}:rescan` : base;
}

function mapRow(row: ScanJobRow): DocumentScanJob {
  return {
    id: row.id,
    intentId: row.intent_id,
    checksum: row.checksum_sha256,
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
 * Enqueue on the caller's client so this can run inside the same transaction as
 * the finalize that creates the document. A received object must never exist
 * without outstanding work: that is the whole point of doing it transactionally
 * rather than firing a job after the commit.
 */
export async function enqueueDocumentScanJob(
  client: QueryClient,
  input: {
    intentId: string;
    checksum: string;
    reason?: ScanJobReason;
    maxAttempts?: number;
  },
): Promise<DocumentScanJob> {
  const reason = input.reason ?? "initial";
  const idempotencyKey = scanJobIdempotencyKey(input);
  const rows = await client<ScanJobRow[]>`
    insert into document_scan_jobs (intent_id, checksum_sha256, reason, idempotency_key, max_attempts)
    values (${input.intentId}, ${input.checksum}, ${reason}, ${idempotencyKey}, ${input.maxAttempts ?? 5})
    on conflict (idempotency_key) do nothing
    returning *
  `;
  if (rows[0]) return mapRow(rows[0]);

  const existing = await client<ScanJobRow[]>`
    select * from document_scan_jobs where idempotency_key = ${idempotencyKey} limit 1
  `;
  if (!existing[0]) throw new Error("Unable to load idempotent document scan job.");
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

export type DocumentScanJobRepository = {
  enqueue(input: {
    intentId: string;
    checksum: string;
    reason?: ScanJobReason;
    maxAttempts?: number;
  }): Promise<DocumentScanJob>;
  claimDue(now: string, limit: number): Promise<DocumentScanJob[]>;
  /**
   * Terminal writes take the attempt_count the claim returned and fence on it.
   *
   * Without the fence they would match on `status = 'processing'` alone, and
   * because the reclaim re-enters that same state, a slow-but-alive scan and its
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
  /** Superseded by newer content; kept as history, never retried. */
  cancelSupersededForIntent(
    intentId: string,
    currentChecksum: string,
  ): Promise<{ cancelled: number }>;
  listForIntent(intentId: string): Promise<DocumentScanJob[]>;
  pendingSummary(now: string): Promise<{
    pending: number;
    processing: number;
    failed: number;
    oldestPendingCreatedAt: string | null;
  }>;
  close(): Promise<void>;
};

export function createDocumentScanJobRepository(
  options?: ScanJobSqlOptions,
): DocumentScanJobRepository;
export function createDocumentScanJobRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): DocumentScanJobRepository;
export function createDocumentScanJobRepository(
  databaseUrlOrOptions: string | ScanJobSqlOptions = {},
  maybeOptions: CreateSqlClientOptions = {},
): DocumentScanJobRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    enqueue: (input) => enqueueDocumentScanJob(sql, input),

    async claimDue(now, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("Document scan job limit must be between 1 and 500.");
      }
      return withTransaction(sql, async (tx) => {
        const rows = await tx<ScanJobRow[]>`
          select * from document_scan_jobs
          where attempt_count < max_attempts
            and (
              (status in ('pending', 'failed') and next_attempt_at <= ${now})
              -- Stranded by a Worker that died mid-scan. Without this the job is
              -- never claimable again and the file is silently never scanned.
              or (status = 'processing' and updated_at <= ${scanProcessingReclaimCutoff(now)})
            )
          order by next_attempt_at asc, created_at asc
          limit ${limit}
          for update skip locked
        `;
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.id);
        const claimed = await tx<ScanJobRow[]>`
          update document_scan_jobs
          set status = 'processing', attempt_count = attempt_count + 1, updated_at = now()
          where id = any(${ids}::uuid[])
          returning *
        `;
        return claimed.map(mapRow);
      });
    },

    async markSucceeded(id, input) {
      const rows = await sql<{ id: string }[]>`
        update document_scan_jobs
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
        const rows = await tx<{ attempt_count: number }[]>`
          select attempt_count from document_scan_jobs where id = ${id} for update
        `;
        if (!rows[0]) throw new Error("Document scan job not found.");
        const updated = await tx<{ id: string }[]>`
          update document_scan_jobs
          set status = 'failed', next_attempt_at = ${nextScanAttemptAt(rows[0].attempt_count, input.now)},
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
      const rows = await sql<{ id: string }[]>`
        update document_scan_jobs
        set status = 'failed', attempt_count = max_attempts, completed_at = ${input.now},
          last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage},
          updated_at = now()
        where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
        returning id
      `;
      return rows.length === 1;
    },

    async cancelSupersededForIntent(intentId, currentChecksum) {
      const rows = await sql<{ id: string }[]>`
        update document_scan_jobs
        set status = 'cancelled', completed_at = now(), updated_at = now(),
          last_error_code = 'superseded-content'
        where intent_id = ${intentId}
          and checksum_sha256 <> ${currentChecksum}
          and status in ('pending', 'failed', 'processing')
        returning id
      `;
      return { cancelled: rows.length };
    },

    async listForIntent(intentId) {
      const rows = await sql<ScanJobRow[]>`
        select * from document_scan_jobs where intent_id = ${intentId} order by created_at desc
      `;
      return rows.map(mapRow);
    },

    async pendingSummary(now) {
      const rows = await sql<
        {
          pending: string;
          processing: string;
          failed: string;
          oldest_pending_created_at: string | Date | null;
        }[]
      >`
        select
          count(*) filter (where status = 'pending') pending,
          count(*) filter (where status = 'processing') processing,
          count(*) filter (where status = 'failed' and attempt_count >= max_attempts) failed,
          min(created_at) filter (where status in ('pending', 'failed')) oldest_pending_created_at
        from document_scan_jobs
        where status in ('pending', 'processing', 'failed')
          and (next_attempt_at <= ${now} or status = 'processing')
      `;
      const row = rows[0];
      return {
        pending: Number(row?.pending ?? 0),
        processing: Number(row?.processing ?? 0),
        failed: Number(row?.failed ?? 0),
        oldestPendingCreatedAt: row?.oldest_pending_created_at
          ? new Date(row.oldest_pending_created_at).toISOString()
          : null,
      };
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
