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
  markSent(id: string, providerMessageId: string, sentAt: string): Promise<void>;
  markRetry(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string },
  ): Promise<void>;
  markFailed(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string },
  ): Promise<void>;
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
    async markSent(id, providerMessageId, sentAt) {
      await sql`
        update notification_outbox set status = 'sent', provider_message_id = ${providerMessageId},
          sent_at = ${sentAt}, updated_at = now()
        where id = ${id} and status = 'processing'
      `;
    },
    async markRetry(id, input) {
      await withTransaction(sql, async (tx) => {
        const rows = await tx<{ attempt_count: number }[]>`
          select attempt_count from notification_outbox where id = ${id} for update
        `;
        if (!rows[0]) throw new Error("Notification outbox row not found.");
        await tx`
          update notification_outbox set status = 'failed', next_attempt_at = ${nextRetryAt(rows[0].attempt_count, input.now)},
            last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now()
          where id = ${id} and status = 'processing'
        `;
      });
    },
    async markFailed(id, input) {
      await sql`
        update notification_outbox set status = 'failed', next_attempt_at = ${input.now},
          last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now()
        where id = ${id} and status = 'processing'
      `;
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}

export type { DispatchSummary };
