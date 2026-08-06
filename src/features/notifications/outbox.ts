import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type { DispatchSummary, EnqueueNotificationInput, NotificationOutboxRecord } from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type NotificationSqlOptions = CreateSqlClientOptions & { sql?: QueryClient };
type NotificationRow = {
  id: string;
  company_id: string;
  work_item_id: string | null;
  channel: NotificationOutboxRecord["channel"];
  notification_type: string;
  idempotency_key: string;
  recipient: string | null;
  payload: postgres.JSONValue | null;
  status: NotificationOutboxRecord["status"];
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | Date;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  sent_at: string | Date | null;
  retention_until: string | Date;
};

const RETRY_BASE_SECONDS = 60;
const RETRY_MAX_SECONDS = 60 * 60;

/**
 * How long a row may sit in 'processing' before another run may claim it.
 *
 * claimDue used to select only 'pending' and 'failed', and nothing else ever
 * moved a row out of 'processing'. A Worker killed between the claim and
 * markSent/markRetry — a CPU limit, an eviction, a deploy — stranded that
 * notification permanently, with no error anywhere: the SLA escalation simply
 * never arrived.
 *
 * Generous relative to a dispatch (seconds) so a slow run is not double-sent
 * while it is still working; short enough that a stranded row recovers on the
 * next few cron ticks rather than never. attempt_count was already incremented
 * at claim time, so a row that strands repeatedly still exhausts max_attempts
 * instead of looping forever.
 */
const PROCESSING_VISIBILITY_TIMEOUT_SECONDS = 15 * 60;

export function processingReclaimCutoff(now: string): string {
  return new Date(Date.parse(now) - PROCESSING_VISIBILITY_TIMEOUT_SECONDS * 1000).toISOString();
}

export function nextRetryAt(attempt: number, now: string): string {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const delaySeconds = Math.min(
    RETRY_MAX_SECONDS,
    RETRY_BASE_SECONDS * 2 ** Math.min(normalizedAttempt - 1, 10),
  );
  return new Date(Date.parse(now) + delaySeconds * 1000).toISOString();
}

export function notificationIdempotencyKey(input: {
  companyId: string;
  workItemId?: string | null;
  channel: string;
  notificationType: string;
  recipient?: string | null;
}): string {
  return [
    "notification",
    input.companyId,
    input.workItemId ?? "none",
    input.channel,
    input.notificationType,
    input.recipient ?? "none",
  ].join(":");
}

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function mapRow(row: NotificationRow): NotificationOutboxRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    workItemId: row.work_item_id,
    channel: row.channel,
    notificationType: row.notification_type,
    idempotencyKey: row.idempotency_key,
    recipient: row.recipient,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at).toISOString(),
    providerMessageId: row.provider_message_id,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    sentAt: iso(row.sent_at),
    retentionUntil: new Date(row.retention_until).toISOString(),
  };
}

export async function enqueueNotification(
  client: QueryClient,
  input: EnqueueNotificationInput,
): Promise<NotificationOutboxRecord> {
  const idempotencyKey =
    input.idempotencyKey ??
    notificationIdempotencyKey({
      companyId: input.companyId,
      workItemId: input.workItemId,
      channel: input.channel,
      notificationType: input.notificationType,
      recipient: input.recipient,
    });
  const rows = await client<NotificationRow[]>`
    insert into notification_outbox (
      work_item_id, company_id, channel, notification_type, idempotency_key,
      recipient, payload, max_attempts, retention_until
    ) values (
      ${input.workItemId ?? null}, ${input.companyId}, ${input.channel},
      ${input.notificationType}, ${idempotencyKey}, ${input.recipient ?? null},
      ${client.json(input.payload ?? {})}, ${input.maxAttempts ?? 5},
      coalesce(${input.retentionUntil ?? null}, now() + interval '90 days')
    )
    on conflict (idempotency_key) do nothing
    returning *
  `;
  if (rows[0]) return mapRow(rows[0]);
  const existing = await client<NotificationRow[]>`
    select * from notification_outbox where idempotency_key = ${idempotencyKey} limit 1
  `;
  if (!existing[0]) throw new Error("Unable to load idempotent notification outbox row.");
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

export type NotificationOutboxRepository = {
  enqueue(input: EnqueueNotificationInput): Promise<NotificationOutboxRecord>;
  claimDue(now: string, limit: number): Promise<NotificationOutboxRecord[]>;
  /**
   * The terminal writes all take the attempt_count the claim returned and fence on
   * it, and all report whether they actually landed.
   *
   * Without the fence they matched on `status = 'processing'` alone. The reclaim
   * re-enters that same state, so when a slow-but-alive dispatch and its reclaimer
   * both sent, whichever wrote first won and the other's write silently matched
   * nothing — while the dispatcher counted both as sent. `false` means this claim
   * was superseded: the row belongs to a later attempt and must not be counted.
   */
  markSent(
    id: string,
    providerMessageId: string,
    sentAt: string,
    attemptCount: number,
  ): Promise<boolean>;
  markRetry(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string; attemptCount: number },
  ): Promise<boolean>;
  markFailed(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string; attemptCount: number },
  ): Promise<boolean>;
  failStranded(now: string, limit?: number): Promise<{ failed: number }>;
  redactExpired(now: string, limit?: number): Promise<{ redacted: number }>;
  close(): Promise<void>;
};

export function createNotificationOutboxRepository(
  options?: NotificationSqlOptions,
): NotificationOutboxRepository;
export function createNotificationOutboxRepository(
  databaseUrl: string,
  options?: CreateSqlClientOptions,
): NotificationOutboxRepository;
export function createNotificationOutboxRepository(
  databaseUrlOrOptions: string | NotificationSqlOptions = {},
  maybeOptions: CreateSqlClientOptions = {},
): NotificationOutboxRepository {
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const suppliedSql =
    typeof databaseUrlOrOptions === "string" ? undefined : databaseUrlOrOptions.sql;
  const options: CreateSqlClientOptions =
    typeof databaseUrlOrOptions === "string" ? maybeOptions : databaseUrlOrOptions;
  const sql = suppliedSql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = Boolean(databaseUrl) && !suppliedSql;

  return {
    enqueue: (input) => enqueueNotification(sql, input),
    async claimDue(now, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Outbox limit must be between 1 and 500.");
      return withTransaction(sql, async (tx) => {
        const rows = await tx<NotificationRow[]>`
          select * from notification_outbox
          where attempt_count < max_attempts
            and (
              (status in ('pending', 'failed') and next_attempt_at <= ${now})
              -- Stranded by a Worker that died mid-dispatch. Without this the row
              -- is never claimable again and the notification is silently lost.
              or (status = 'processing' and updated_at <= ${processingReclaimCutoff(now)})
            )
          order by next_attempt_at asc, created_at asc
          limit ${limit}
          for update skip locked
        `;
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.id);
        const claimed = await tx<NotificationRow[]>`
          update notification_outbox
          set status = 'processing', attempt_count = attempt_count + 1, updated_at = now()
          where id = any(${ids}::uuid[])
          returning *
        `;
        return claimed.map(mapRow);
      });
    },
    async markSent(id, providerMessageId, sentAt, attemptCount) {
      const rows = await sql<{ id: string }[]>`
        update notification_outbox set status = 'sent', provider_message_id = ${providerMessageId},
          sent_at = ${sentAt}, updated_at = now()
        where id = ${id} and status = 'processing' and attempt_count = ${attemptCount}
        returning id
      `;
      return rows.length === 1;
    },
    async markRetry(id, input) {
      let applied = false;
      await withTransaction(sql, async (tx) => {
        const rows = await tx<{ attempt_count: number }[]>`
          select attempt_count from notification_outbox where id = ${id} for update
        `;
        if (!rows[0]) throw new Error("Notification outbox row not found.");
        const updated = await tx<{ id: string }[]>`
          update notification_outbox set status = 'failed', next_attempt_at = ${nextRetryAt(rows[0].attempt_count, input.now)},
            last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now()
          where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
          returning id
        `;
        applied = updated.length === 1;
      });
      return applied;
    },
    async markFailed(id, input) {
      const rows = await sql<{ id: string }[]>`
        update notification_outbox set status = 'failed', next_attempt_at = ${input.now},
          last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now()
        where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
        returning id
      `;
      return rows.length === 1;
    },
    /**
     * retention_until was written on every insert and read back on every row, and
     * nothing ever acted on it — the column, its check constraint and its index
     * existed while the table grew without bound, carrying recipient addresses and
     * message bodies indefinitely.
     *
     * This REDACTS rather than deletes, which is what the schema was built for:
     * `redacted_at` plus a check constraint spelling out the redacted shape
     * (recipient, payload, provider_message_id and both error columns all null),
     * and `notification_outbox_retention_idx on (retention_until) where
     * redacted_at is null` — an index whose only purpose is finding rows due for
     * redaction. The row survives with its id, company, work item, channel, type,
     * status and timestamps, so the audit trail of "we sent this client their
     * statutory reminder" outlives the phone number it was sent to. For a
     * regulated firm that distinction matters; an earlier draft of this deleted
     * the row outright and would have destroyed that record.
     *
     * Only settled rows are touched: anything pending, mid-dispatch, or failed
     * within its attempt budget keeps its recipient, because redacting it would
     * null the address it still needs to be delivered to.
     *
     * Bounded per run because it shares a five-minute cron with the dispatch pass.
     * `redacted_at is null` in the subquery matches the partial index predicate,
     * so this uses the index rather than scanning.
     */
    /**
     * Finalises rows stranded in 'processing' on their LAST attempt.
     *
     * The reclaim branch in claimDue is gated on `attempt_count < max_attempts`,
     * and claimDue increments the count when it claims. So a row claimed on its
     * final attempt whose Worker then died sits at status='processing' with
     * attempt_count = max_attempts: claimDue will not take it again, and
     * redactExpired skips it because 'processing' is not settled. It is stuck
     * forever and invisible — the same failure the reclaim was written to fix,
     * one attempt later.
     *
     * Marking it 'failed' makes it terminal, gives it an error code an operator
     * can search for, and lets retention redact it in due course. It is NOT
     * re-sent: the attempt budget is spent.
     */
    async failStranded(now, limit = 500) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
        throw new Error("Outbox stranded limit must be between 1 and 5000.");
      }

      const rows = await sql<{ id: string }[]>`
        update notification_outbox
        set status = 'failed',
            last_error_code = 'dispatch_stranded',
            last_error_message = 'Dispatch did not complete before the visibility timeout and no attempts remain.',
            updated_at = now()
        where id in (
          select id from notification_outbox
          where status = 'processing'
            and attempt_count >= max_attempts
            and updated_at <= ${processingReclaimCutoff(now)}
          order by updated_at asc
          limit ${limit}
          for update skip locked
        )
        returning id
      `;

      return { failed: rows.length };
    },
    async redactExpired(now, limit = 500) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
        throw new Error("Outbox redaction limit must be between 1 and 5000.");
      }

      const rows = await sql<{ id: string }[]>`
        update notification_outbox
        set redacted_at = now(),
            recipient = null,
            payload = null,
            provider_message_id = null,
            last_error_code = null,
            last_error_message = null,
            updated_at = now()
        where id in (
          select id from notification_outbox
          where redacted_at is null
            and retention_until <= ${now}
            and (
              status in ('sent', 'cancelled')
              or (status = 'failed' and attempt_count >= max_attempts)
            )
          order by retention_until asc
          limit ${limit}
          for update skip locked
        )
        returning id
      `;

      return { redacted: rows.length };
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}

export type { DispatchSummary };
