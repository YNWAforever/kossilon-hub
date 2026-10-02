import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import type {
  EnqueuedNotification,
  DispatchSummary,
  EnqueueNotificationInput,
  NotificationDelivery,
  NotificationOutboxRecord,
} from "./types";

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
): Promise<EnqueuedNotification> {
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
  if (rows[0]) return { ...mapRow(rows[0]), idempotentReplay: false };

  // The key already existed. Returning the old row silently is how a recurring
  // reminder came to be counted as sent without ever being queued, so the fact
  // travels with the value rather than being left for the caller to infer.
  const existing = await client<NotificationRow[]>`
    select * from notification_outbox where idempotency_key = ${idempotencyKey} limit 1
  `;
  if (!existing[0]) throw new Error("Unable to load idempotent notification outbox row.");
  return { ...mapRow(existing[0]), idempotentReplay: true };
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
   * Cancels queued notifications belonging to fixture-origin companies, so a
   * fixture replay cannot message a real recipient. Called before every claim.
   */
  cancelFixtureOriginNotifications(now: string): Promise<{ cancelled: number }>;
  /**
   * Records that a transport call is about to be made, before it is made, so a
   * dispatch with no recorded outcome can never be silently re-sent.
   *
   * Fenced like the terminal writes, and `false` means it did not land, so the
   * caller must not make the transport call.
   */
  markDispatchStarted(id: string, input: { attemptCount: number }): Promise<boolean>;
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
    input: {
      providerMessageId: string | null;
      delivery: NotificationDelivery;
      sentAt: string;
      attemptCount: number;
    },
  ): Promise<boolean>;
  markRetry(
    id: string,
    input: { errorCode: string; errorMessage: string; now: string; attemptCount: number },
  ): Promise<boolean>;
  markFailed(
    id: string,
    input: {
      errorCode: string;
      errorMessage: string;
      now: string;
      attemptCount: number;
      /**
       * Settles the row so nothing can ever claim it again.
       *
       * `status = 'failed'` alone is not terminal: claimDue takes
       * `status in ('pending','failed') and next_attempt_at <= now` for any row
       * with attempt_count < max_attempts, and markFailed writes
       * next_attempt_at = now. A provider-accepted send settled without this is
       * re-claimed on the next tick and the client gets a second copy. It is also
       * what makes the row redactable at all -- redactExpired only settles a
       * 'failed' row once its attempts are spent.
       */
      spendAttempts?: boolean;
    },
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
            -- Origin is a predicate of the CLAIM, not only of the cancel pass that
            -- runs just before it. Those are two statements and the five-minute
            -- cron holds no lease, so a reminder enqueued for a fixture-origin
            -- company after the cancel swept past -- or during an overlapping tick
            -- -- was claimed, and a claimed row is one dispatch away from a real
            -- client's phone. The cancel pass still runs: it is what SETTLES those
            -- rows, so they stop sitting due forever.
            --
            -- Phrased as "not in (the fixtures)" rather than as a positive
            -- data_origin test because companies_data_origin_idx is partial on
            -- data_origin <> 'client': the index can answer "which companies are
            -- fixtures" and nothing else, so the positive form would seq-scan
            -- companies on every cron tick. companies.id is the primary key, so
            -- the subquery yields no nulls and NOT IN cannot collapse to unknown.
            and company_id not in (select id from companies where data_origin <> 'client')
            and not exists(select 1 from annual_return_cases h where h.company_id=notification_outbox.company_id and h.import_origin='historical' and (h.id::text=notification_outbox.payload->>'caseId' or exists(select 1 from work_items hw where hw.id=notification_outbox.work_item_id and hw.annual_return_case_id=h.id)))
            -- A marker means a transport call was BEGUN for this row and no
            -- outcome was ever recorded, so the provider may already have the
            -- message. Re-claiming it is how the same statutory reminder reached a
            -- client twice: the attempt fence only makes the loser's markSent
            -- fail, long after both dispatches went out. WOZTELL takes no
            -- client-side idempotency key, so nothing downstream can collapse the
            -- duplicate. failStranded settles these for a human instead.
            --
            -- Terminal writes clear the marker, so an ordinary retry is unaffected.
            and dispatch_started_attempt is null
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
    /**
     * Cancels anything queued for a company that is fixture data.
     *
     * The plan forbids sending customer reminders during fixture replay, and
     * nothing enforced it: the only thing standing between a seeded company and
     * a live message was that the seed happens not to create a contact row.
     *
     * Enforced here, at the last gate before dispatch, rather than in each
     * producer. The annual-return sweep, the subscription sweep and the
     * staff-initiated follow-up all queue through this table, and a guard in one
     * of them is a guard the next producer will not have.
     *
     * 'cancelled' is a status notification_outbox has always permitted and
     * nothing has ever written. It is the honest terminal state here: the row is
     * not pending, not failed, and must never be retried.
     */
    async cancelFixtureOriginNotifications(now) {
      const rows = await sql<{ id: string }[]>`
        update notification_outbox
        -- updated_at records when, because notification_outbox has no
        -- completed_at column -- this query named one and threw on every call,
        -- so the fixture-origin guard did not run at all. sent_at would be the
        -- wrong column to reach for instead: nothing was sent, and that is the
        -- entire point of cancelling.
        set status = 'cancelled', updated_at = now(),
          last_error_code = 'fixture-origin'
        where status in ('pending', 'failed', 'processing')
          -- Redacted rows are excluded, and this is not tidiness. The retention
          -- constraint requires last_error_code to be null once redacted_at is
          -- set, so writing 'fixture-origin' onto one throws -- and because this
          -- runs at the head of the dispatch path, the whole dispatch pass would
          -- then fail on every tick, forever, since the offending row never goes
          -- away. redactExpired settles 'failed' rows past retention, which is
          -- squarely inside the status filter above. Verified against Postgres.
          --
          -- Nothing is lost by skipping them: a redacted row is already settled,
          -- its content is gone, and its attempts are spent.
          and redacted_at is null
          and next_attempt_at <= ${now}
          and (company_id in (select id from companies where data_origin <> 'client') or not (not exists(select 1 from annual_return_cases h where h.company_id=notification_outbox.company_id and h.import_origin='historical' and (h.id::text=notification_outbox.payload->>'caseId' or exists(select 1 from work_items hw where hw.id=notification_outbox.work_item_id and hw.annual_return_case_id=h.id)))))
        returning id
      `;
      return { cancelled: rows.length };
    },
    /**
     * Records that a transport call is about to be made, before it is made.
     *
     * If the write does not land the dispatch must not proceed — the whole point
     * is that no send happens without a marker to say it might have. A throw
     * honoured that; a 0-row update did not. The update is fenced on the claim's
     * attempt_count, and a row another run has reclaimed re-enters 'processing'
     * with the count moved on, so it matches nothing — and the caller went on to
     * send, unmarked, a message the reclaimer is also sending. So this reports
     * whether it applied, exactly like the terminal writes below.
     */
    async markDispatchStarted(id, input) {
      const rows = await sql<{ id: string }[]>`
        update notification_outbox
        set dispatch_started_attempt = ${input.attemptCount}, updated_at = now()
        where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
          and company_id in (select id from companies where data_origin = 'client')
          and not exists(select 1 from annual_return_cases h where h.company_id=notification_outbox.company_id and h.import_origin='historical' and (h.id::text=notification_outbox.payload->>'caseId' or exists(select 1 from work_items hw where hw.id=notification_outbox.work_item_id and hw.annual_return_case_id=h.id)))
        returning id
      `;
      return rows.length === 1;
    },
    async markSent(id, input) {
      const rows = await sql<{ id: string }[]>`
        update notification_outbox set status = 'sent', provider_message_id = ${input.providerMessageId},
          delivery = ${input.delivery}, sent_at = ${input.sentAt}, updated_at = now(),
          -- Outcome recorded, so the row is no longer unknown and the marker has
          -- done its job. Left set, it would only make the row unclaimable.
          dispatch_started_attempt = null
        where id = ${id} and status = 'processing' and attempt_count = ${input.attemptCount}
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
            last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now(),
            -- The outcome is recorded, so the marker is spent. It must be cleared
            -- or this row -- a perfectly ordinary retry -- would never be claimed
            -- again.
            dispatch_started_attempt = null
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
          last_error_code = ${input.errorCode}, last_error_message = ${input.errorMessage}, updated_at = now(),
          -- Terminal, and the outcome is written down; the marker is spent.
          dispatch_started_attempt = null,
          -- 'failed' is not by itself terminal: claimDue takes a failed row whose
          -- next_attempt_at has passed for as long as attempts remain, and the
          -- line above sets next_attempt_at = now. A caller settling a send the
          -- provider ALREADY accepted has to say so, or the next tick delivers a
          -- second copy -- and redactExpired, which skips a failed row with
          -- attempts left, would keep the recipient past retention forever.
          attempt_count = case
            when ${input.spendAttempts ?? false}::boolean then max_attempts
            else attempt_count
          end
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
            last_error_code = case
              when dispatch_started_attempt is not null then 'dispatch_outcome_unknown'
              else 'dispatch_stranded'
            end,
            last_error_message = case
              when dispatch_started_attempt is not null
                then 'A send was begun and no outcome was recorded. The provider may already have delivered it; decide by hand rather than re-sending.'
              else 'Dispatch did not complete before the visibility timeout and no attempts remain.'
            end,
            -- Spending the budget on the marker arm is not bookkeeping tidiness:
            -- redactExpired only settles a 'failed' row once attempt_count >=
            -- max_attempts, so a row escalated with attempts left would keep its
            -- recipient and message body past retention, forever. The attempts are
            -- genuinely spent -- this row must never be dispatched again.
            attempt_count = case
              when dispatch_started_attempt is not null then max_attempts
              else attempt_count
            end,
            updated_at = now()
        where id in (
          select id from notification_outbox
          where status = 'processing'
            -- Two distinct strandings settle here. The original: attempts are
            -- spent, so nothing will ever claim this row again. The second: a
            -- transport call was begun and no outcome was recorded, so claimDue
            -- refuses the row NO MATTER how many attempts remain -- re-sending on
            -- an unknown outcome is exactly what must not happen. Without this
            -- arm such a row would be neither re-sent nor settled nor visible,
            -- which is the silent loss the reclaim was written to end.
            and (attempt_count >= max_attempts or dispatch_started_attempt is not null)
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
