import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { MaintenanceRunOutcome, MaintenanceRunRecord } from "./health";

/**
 * Reads and writes the record of the scheduled tick.
 *
 * The write side is called by the maintenance entrypoint, which is actor-free --
 * a scheduler has no request to derive an actor from -- and the read side by a
 * staff-gated server function. Same table, one file, because a record nobody
 * reads is as useless as a screen with nothing behind it.
 */

type RunRow = {
  id: string;
  scheduled_for: string | Date;
  started_at: string | Date;
  finished_at: string | Date;
  duration_ms: number;
  outcome: MaintenanceRunOutcome;
  failed_passes: string[];
  trigger_source: "scheduled" | "manual";
};

type DepthRow = {
  pending: string | number;
  processing: string | number;
  failed: string | number;
  due_now: string | number;
  oldest_pending_at: string | Date | null;
};

export type MaintenanceRunDraft = {
  scheduledFor: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: MaintenanceRunOutcome;
  /** The whole ScheduledMaintenanceResult, stored as jsonb. */
  passes: unknown;
  failedPasses: readonly string[];
  /**
   * Composed from `MaintenancePassFailure.message` only, never from a thrown
   * value: a maintenance failure can carry a provider payload or a connection
   * string, and this row is read by a screen.
   */
  failureSummary: string | null;
  triggerSource: "scheduled" | "manual";
};

export type JobQueueDepth = {
  pending: number;
  processing: number;
  failed: number;
  /** Pending and already due. What the next tick should pick up. */
  dueNow: number;
  /**
   * When the oldest pending job arrived. Null when nothing is pending.
   *
   * A depth on its own cannot tell a busy queue from a stuck one -- fifty jobs
   * arriving every tick and fifty jobs that have sat there since March look
   * identical. This is the difference.
   */
  oldestPendingAt: string | null;
};

export type QueueDepths = {
  documentScans: JobQueueDepth;
  documentAnalysis: JobQueueDepth;
  notifications: JobQueueDepth;
  /**
   * Approved packages nothing has been able to transmit. Under
   * BLOCKED_INTEGRATION: external-handoff-destination this is every prepared
   * package, and it is a missing integration rather than a fault -- which is why
   * it is its own number and not folded into a failure count.
   */
  handoffsAwaitingTransmission: number;
};

export type MaintenanceRunRepository = {
  recordRun(draft: MaintenanceRunDraft): Promise<{ id: string }>;
  /** Most recent first. */
  listRecentRuns(limit?: number): Promise<MaintenanceRunRecord[]>;
  queueDepths(now: string): Promise<QueueDepths>;
  close(): Promise<void>;
};

const DEFAULT_RUN_LIMIT = 20;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function count(value: string | number): number {
  return Number(value);
}

function mapRun(row: RunRow): MaintenanceRunRecord {
  return {
    id: row.id,
    scheduledFor: iso(row.scheduled_for),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    durationMs: Number(row.duration_ms),
    outcome: row.outcome,
    failedPasses: row.failed_passes ?? [],
    triggerSource: row.trigger_source,
  };
}

function mapDepth(row: DepthRow | undefined): JobQueueDepth {
  if (!row) {
    return { pending: 0, processing: 0, failed: 0, dueNow: 0, oldestPendingAt: null };
  }
  return {
    pending: count(row.pending),
    processing: count(row.processing),
    failed: count(row.failed),
    dueNow: count(row.due_now),
    oldestPendingAt: isoOrNull(row.oldest_pending_at),
  };
}

export function createMaintenanceRunRepository(
  databaseUrl?: string,
  options: CreateSqlClientOptions = {},
): MaintenanceRunRepository {
  const sql: SqlClient = databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient();
  // Only a client this factory opened is a client this factory may close. The
  // shared singleton is used by every other repository in the request.
  const ownsClient = Boolean(databaseUrl);

  async function depthOf(
    table: "document_scan_jobs" | "document_analysis_jobs" | "notification_outbox",
    now: string,
  ): Promise<JobQueueDepth> {
    // A table name cannot be a bound parameter, so each query is written out
    // against a literal table rather than interpolated from a variable.
    const rows =
      table === "document_scan_jobs"
        ? await sql<DepthRow[]>`
            select
              count(*) filter (where status = 'pending') pending,
              count(*) filter (where status = 'processing') processing,
              count(*) filter (where status = 'failed') failed,
              count(*) filter (where status = 'pending' and next_attempt_at <= ${now}) due_now,
              min(created_at) filter (where status = 'pending') oldest_pending_at
            from document_scan_jobs
          `
        : table === "document_analysis_jobs"
          ? await sql<DepthRow[]>`
              select
                count(*) filter (where status = 'pending') pending,
                count(*) filter (where status = 'processing') processing,
                count(*) filter (where status = 'failed') failed,
                count(*) filter (where status = 'pending' and next_attempt_at <= ${now}) due_now,
                min(created_at) filter (where status = 'pending') oldest_pending_at
              from document_analysis_jobs
            `
          : await sql<DepthRow[]>`
              select
                count(*) filter (where status = 'pending') pending,
                count(*) filter (where status = 'processing') processing,
                count(*) filter (where status = 'failed') failed,
                count(*) filter (where status = 'pending' and next_attempt_at <= ${now}) due_now,
                min(created_at) filter (where status = 'pending') oldest_pending_at
              from notification_outbox
            `;

    return mapDepth(rows[0]);
  }

  return {
    async recordRun(draft) {
      const rows = await sql<{ id: string }[]>`
        insert into maintenance_runs (
          scheduled_for, started_at, finished_at, duration_ms,
          outcome, passes, failed_passes, failure_summary, trigger_source
        ) values (
          ${draft.scheduledFor}, ${draft.startedAt}, ${draft.finishedAt}, ${draft.durationMs},
          ${draft.outcome}, ${sql.json(draft.passes as never)},
          ${sql.array([...draft.failedPasses])}, ${draft.failureSummary},
          ${draft.triggerSource}
        )
        returning id
      `;
      return { id: rows[0].id };
    },

    async listRecentRuns(limit = DEFAULT_RUN_LIMIT) {
      const rows = await sql<RunRow[]>`
        select id, scheduled_for, started_at, finished_at, duration_ms,
               outcome, failed_passes, trigger_source
        from maintenance_runs
        order by scheduled_for desc
        limit ${limit}
      `;
      return rows.map(mapRun);
    },

    async queueDepths(now) {
      const [documentScans, documentAnalysis, notifications, handoffs] = await Promise.all([
        depthOf("document_scan_jobs", now),
        depthOf("document_analysis_jobs", now),
        depthOf("notification_outbox", now),
        sql<{ prepared: string | number }[]>`
          select count(*) prepared from package_handoffs where status = 'prepared'
        `,
      ]);

      return {
        documentScans,
        documentAnalysis,
        notifications,
        handoffsAwaitingTransmission: count(handoffs[0]?.prepared ?? 0),
      };
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
