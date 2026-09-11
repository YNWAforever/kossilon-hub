import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { MaintenanceRunOutcome, MaintenanceRunRecord } from "./health";
import type { SchemaLedger } from "./schema-health";

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
  retrying: string | number;
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
  /**
   * Failed an attempt and waiting to run again.
   *
   * Counted apart from `failed`, because the two need opposite reactions and the
   * screen previously merged them. `claimDue` matches
   * `status in ('pending','failed')` while `attempt_count < max_attempts`, so a
   * backing-off job is live work -- and folding it into a failure count made a
   * queue that was entirely mid-retry render as idle with some dead rows.
   */
  retrying: number;
  /** Attempts exhausted. The only genuinely terminal state, and it needs a person. */
  failed: number;
  /** Pending or retrying and already due. What the next tick should pick up. */
  dueNow: number;
  /**
   * When the oldest unfinished job arrived -- pending or retrying. Null when
   * there is none.
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
  /** Most recent first, every trigger source. What the run table on screen shows. */
  listRecentRuns(limit?: number): Promise<MaintenanceRunRecord[]>;
  /**
   * Most recent scheduled runs only.
   *
   * The health rule judges the schedule, and a window filled with manual runs
   * would leave it nothing to judge -- twelve invocations by hand would push
   * every cron row out of view and make a healthy schedule read as
   * `never-observed`.
   */
  listRecentScheduledRuns(limit?: number): Promise<MaintenanceRunRecord[]>;
  /**
   * The last clean scheduled run in ALL of history, not within a window.
   *
   * "When did this last work" is a question about the whole record. Deriving it
   * from the same twelve rows the staleness rule uses meant that twelve
   * consecutive partial ticks -- an hour of one pass failing -- made the screen
   * say the schedule had never once succeeded, while the row proving otherwise
   * sat just outside the window.
   */
  lastScheduledSuccessAt(): Promise<string | null>;
  queueDepths(now: string): Promise<QueueDepths>;
  /**
   * What `schema_migrations` records, or that it is not there.
   *
   * The one read in this repository that must survive the database being in the
   * wrong state, because that is the state it exists to report. It asks whether
   * the table is visible before selecting from it, so a database that has never
   * been migrated answers the question instead of throwing on the way to
   * answering it.
   */
  schemaLedger(): Promise<SchemaLedger>;
  close(): Promise<void>;
};

const DEFAULT_RUN_LIMIT = 20;

/**
 * Separator for the failed-pass list, written as an escape so nothing between
 * here and Postgres can mangle a raw control byte. A unit separator appears in
 * no pass name, so joining cannot depend on a convention holding.
 */
const PASS_SEPARATOR = "\u0001";

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
    return { pending: 0, processing: 0, retrying: 0, failed: 0, dueNow: 0, oldestPendingAt: null };
  }
  return {
    pending: count(row.pending),
    processing: count(row.processing),
    retrying: count(row.retrying),
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
                -- Failed an attempt and scheduled to run again. claimDue matches
                -- status in ('pending','failed') while attempts remain, so these
                -- are live work, not wreckage.
                count(*) filter (where status = 'failed' and attempt_count < max_attempts) retrying,
                -- Attempts exhausted. This is the only genuinely terminal one.
                count(*) filter (where status = 'failed' and attempt_count >= max_attempts) failed,
                count(*) filter (
                  where (status = 'pending' or (status = 'failed' and attempt_count < max_attempts))
                    and next_attempt_at <= ${now}
                ) due_now,
                min(created_at) filter (
                  where status = 'pending' or (status = 'failed' and attempt_count < max_attempts)
                ) oldest_pending_at
            from document_scan_jobs
          `
        : table === "document_analysis_jobs"
          ? await sql<DepthRow[]>`
              select
                count(*) filter (where status = 'pending') pending,
                count(*) filter (where status = 'processing') processing,
                -- Failed an attempt and scheduled to run again. claimDue matches
                -- status in ('pending','failed') while attempts remain, so these
                -- are live work, not wreckage.
                count(*) filter (where status = 'failed' and attempt_count < max_attempts) retrying,
                -- Attempts exhausted. This is the only genuinely terminal one.
                count(*) filter (where status = 'failed' and attempt_count >= max_attempts) failed,
                count(*) filter (
                  where (status = 'pending' or (status = 'failed' and attempt_count < max_attempts))
                    and next_attempt_at <= ${now}
                ) due_now,
                min(created_at) filter (
                  where status = 'pending' or (status = 'failed' and attempt_count < max_attempts)
                ) oldest_pending_at
              from document_analysis_jobs
            `
          : await sql<DepthRow[]>`
              select
                count(*) filter (where status = 'pending') pending,
                count(*) filter (where status = 'processing') processing,
                -- Failed an attempt and scheduled to run again. claimDue matches
                -- status in ('pending','failed') while attempts remain, so these
                -- are live work, not wreckage.
                count(*) filter (where status = 'failed' and attempt_count < max_attempts) retrying,
                -- Attempts exhausted. This is the only genuinely terminal one.
                count(*) filter (where status = 'failed' and attempt_count >= max_attempts) failed,
                count(*) filter (
                  where (status = 'pending' or (status = 'failed' and attempt_count < max_attempts))
                    and next_attempt_at <= ${now}
                ) due_now,
                min(created_at) filter (
                  where status = 'pending' or (status = 'failed' and attempt_count < max_attempts)
                ) oldest_pending_at
              from notification_outbox
            `;

    return mapDepth(rows[0]);
  }

  return {
    async recordRun(draft) {
      /**
       * Built in SQL from a delimited string, not passed as an array parameter.
       *
       * `sql.array` resolves its element type through a map the driver fills in
       * lazily from the server, and until it does the value goes out as plain
       * `text` -- so the insert is refused against a `text[]` column whether the
       * array is empty or not. Casting cannot rescue it, because by then the
       * value has already been serialised as `dispatchDue,redactNotifications`
       * rather than as an array literal. `string_to_array` has no inference in
       * it at all.
       *
       * The separator is a unit separator rather than a comma so this does not
       * quietly depend on pass names never containing one.
       *
       * CI found this, twice. It was not findable by reading, and not findable
       * by the local suite, which skips every database test.
       */
      const failedPasses =
        draft.failedPasses.length > 0
          ? sql`string_to_array(${[...draft.failedPasses].join(PASS_SEPARATOR)}, ${PASS_SEPARATOR})`
          : sql`'{}'::text[]`;

      const rows = await sql<{ id: string }[]>`
        insert into maintenance_runs (
          scheduled_for, started_at, finished_at, duration_ms,
          outcome, passes, failed_passes, failure_summary, trigger_source
        ) values (
          ${draft.scheduledFor}, ${draft.startedAt}, ${draft.finishedAt}, ${draft.durationMs},
          ${draft.outcome}, ${sql.json(draft.passes as never)},
          ${failedPasses}, ${draft.failureSummary},
          ${draft.triggerSource}
        )
        returning id
      `;
      return { id: rows[0].id };
    },

    async listRecentScheduledRuns(limit = DEFAULT_RUN_LIMIT) {
      const rows = await sql<RunRow[]>`
        select id, scheduled_for, started_at, finished_at, duration_ms,
               outcome, failed_passes, trigger_source
        from maintenance_runs
        where trigger_source = 'scheduled'
        order by scheduled_for desc
        limit ${limit}
      `;
      return rows.map(mapRun);
    },

    async lastScheduledSuccessAt() {
      const rows = await sql<{ finished_at: string | Date | null }[]>`
        select max(finished_at) finished_at
        from maintenance_runs
        where trigger_source = 'scheduled' and outcome = 'succeeded'
      `;
      return isoOrNull(rows[0]?.finished_at ?? null);
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

    async schemaLedger() {
      // Unqualified, so it resolves through the same search_path db-migrate.ts
      // created the table under. Hardcoding `public.` would report "no ledger"
      // for a perfectly managed database served under any other schema.
      const [presence] = await sql<{ present: boolean }[]>`
        select to_regclass('schema_migrations') is not null present
      `;

      if (!presence?.present) return { present: false, applied: [] };

      const rows = await sql<{ id: string }[]>`select id from schema_migrations`;
      return { present: true, applied: rows.map((row) => row.id) };
    },

    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
