import type postgres from "postgres";
import type { SqlClient } from "@/server/db/client";
import type { NotificationOutboxRecord } from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

type OutboxRow = {
  id: string;
  attempt_count: number;
  idempotency_key: string;
};

type AttemptRow = {
  id: string;
  outbox_id: string;
  attempt_count: number;
  lease_token: string;
  state:
    | "claimed"
    | "send_started"
    | "accepted"
    | "simulated"
    | "definitely_rejected"
    | "unknown"
    | "abandoned";
  lease_expires_at: string | Date;
  provider_message_id: string | null;
};

export type ClaimedDeliveryAttempt = NotificationOutboxRecord & {
  attemptId: string;
  leaseToken: string;
};

export type ProviderOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "simulated" }
  | { kind: "definitelyRejected"; code: string }
  | { kind: "unknown"; errorCode: string; attemptRef: string };

export type BeginResult = "started" | "stale";
export type OutcomeResult = "recorded" | "replayed" | "stale";

const LEASE_MS = 15 * 60 * 1000;

function validNow(now: string): number {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) throw new Error("Delivery attempt time must be valid.");
  return parsed;
}

function retryAt(attempt: number, now: string): string {
  const seconds = Math.min(3600, 60 * 2 ** Math.min(Math.max(attempt - 1, 0), 10));
  return new Date(validNow(now) + seconds * 1000).toISOString();
}

function withTransaction<T>(client: QueryClient, run: (tx: Tx) => Promise<T>): Promise<T> {
  return "begin" in client ? (client.begin(run) as Promise<T>) : run(client);
}

export function createDeliveryAttemptMethods<Row extends OutboxRow>(
  sql: QueryClient,
  mapNotification: (row: Row) => NotificationOutboxRecord,
) {
  return {
    async claimDeliveryAttempt(now: string, limit: number): Promise<ClaimedDeliveryAttempt[]> {
      const instant = validNow(now);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("Outbox limit must be between 1 and 500.");
      }
      const leaseExpiresAt = new Date(instant + LEASE_MS).toISOString();
      return withTransaction(sql, async (tx) => {
        const rows = await tx<Row[]>`
          select o.* from notification_outbox o
          join companies c on c.id = o.company_id
          where c.data_origin = 'client' and c.status = 'active'
            and o.recipient is not null and o.redacted_at is null
            and o.attempt_count < o.max_attempts
            and not exists (
              select 1 from notification_delivery_attempts unsafe
              where unsafe.outbox_id = o.id and unsafe.state in ('send_started', 'unknown', 'accepted', 'simulated')
            )
            and (
              (o.status in ('pending', 'failed') and o.next_attempt_at <= ${now})
              or (o.status = 'processing' and exists (
                select 1 from notification_delivery_attempts prior
                where prior.outbox_id = o.id and prior.attempt_count = o.attempt_count
                  and prior.state = 'claimed' and prior.lease_expires_at <= ${now}
              ))
            )
          order by o.next_attempt_at asc, o.created_at asc
          limit ${limit}
          for update of o skip locked
        `;
        const claimed: ClaimedDeliveryAttempt[] = [];
        for (const row of rows) {
          await tx`
            update notification_delivery_attempts set state = 'abandoned', finished_at = ${now}
            where outbox_id = ${row.id} and state = 'claimed' and lease_expires_at <= ${now}
          `;
          const [updated] = await tx<Row[]>`
            update notification_outbox set status = 'processing', attempt_count = attempt_count + 1,
              updated_at = ${now}
            where id = ${row.id} returning *
          `;
          const [attempt] = await tx<{ id: string; lease_token: string }[]>`
            insert into notification_delivery_attempts (
              outbox_id, attempt_count, delivery_key, state, claimed_at, lease_expires_at
            ) values (
              ${row.id}, ${updated.attempt_count}, ${updated.idempotency_key},
              'claimed', ${now}, ${leaseExpiresAt}
            ) returning id, lease_token
          `;
          claimed.push({
            ...mapNotification(updated),
            attemptId: attempt.id,
            leaseToken: attempt.lease_token,
          });
        }
        return claimed;
      });
    },

    async settleStranded(
      now: string,
      limit = 500,
    ): Promise<{ failed: number; needsReconciliation: number }> {
      const instant = validNow(now);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
        throw new Error("Outbox stranded limit must be between 1 and 5000.");
      }
      const cutoff = new Date(instant - LEASE_MS).toISOString();
      return withTransaction(sql, async (tx) => {
        const rows = await tx<
          {
            id: string;
            outbox_id: string;
            state: "claimed" | "send_started";
            attempt_count: number;
            max_attempts: number;
          }[]
        >`
          select a.id, a.outbox_id, a.state, o.attempt_count, o.max_attempts
          from notification_delivery_attempts a
          join notification_outbox o on o.id = a.outbox_id
          where o.status = 'processing' and a.lease_expires_at <= ${now}
            and o.updated_at <= ${cutoff}
            and a.attempt_count = o.attempt_count
            and (a.state = 'send_started' or (a.state = 'claimed' and o.attempt_count >= o.max_attempts))
          order by a.lease_expires_at, a.id limit ${limit}
          for update of a, o skip locked
        `;
        let failed = 0;
        let needsReconciliation = 0;
        for (const row of rows) {
          if (row.state === "send_started") {
            await tx`
              update notification_delivery_attempts set state = 'unknown',
                error_code = 'send_outcome_unrecorded', attempt_ref = ${row.id}, finished_at = ${now}
              where id = ${row.id}
            `;
            await tx`
              update notification_outbox set status = 'needs_reconciliation',
                last_error_code = 'send_outcome_unrecorded',
                last_error_message = 'Send began with no durable provider outcome; reconcile manually.',
                updated_at = now()
              where id = ${row.outbox_id}
            `;
            needsReconciliation += 1;
          } else {
            await tx`
              update notification_delivery_attempts set state = 'abandoned', finished_at = ${now}
              where id = ${row.id}
            `;
            await tx`
              update notification_outbox set status = 'failed',
                last_error_code = 'claim_stranded_before_send',
                last_error_message = 'Claim expired before a provider call; attempt budget exhausted.',
                updated_at = now()
              where id = ${row.outbox_id}
            `;
            failed += 1;
          }
        }
        const legacy = await tx<{ id: string }[]>`
          select o.id from notification_outbox o
          where o.status = 'processing' and o.updated_at <= ${cutoff}
            and not exists (
              select 1 from notification_delivery_attempts a
              where a.outbox_id = o.id and a.attempt_count = o.attempt_count
            )
          order by o.updated_at, o.id limit ${Math.max(0, limit - rows.length)}
          for update of o skip locked
        `;
        for (const row of legacy) {
          await tx`
            update notification_outbox set status = 'needs_reconciliation',
              last_error_code = 'processing_without_attempt',
              last_error_message = 'No durable attempt for processing row; reconcile manually.',
              updated_at = now()
            where id = ${row.id}
          `;
          needsReconciliation += 1;
        }
        return { failed, needsReconciliation };
      });
    },

    async beginProviderCall(attemptId: string, leaseToken: string): Promise<BeginResult> {
      return withTransaction(sql, async (tx) => {
        const [row] = await tx<
          {
            state: AttemptRow["state"];
            lease_token: string;
            lease_expires_at: string | Date;
            attempt_count: number;
            outbox_attempt_count: number;
            outbox_status: string;
            data_origin: string;
            company_status: string;
            recipient: string | null;
            redacted_at: string | Date | null;
          }[]
        >`
          select a.state, a.lease_token, a.lease_expires_at, a.attempt_count,
            o.attempt_count as outbox_attempt_count, o.status as outbox_status,
            c.data_origin, c.status as company_status, o.recipient, o.redacted_at
          from notification_delivery_attempts a
          join notification_outbox o on o.id = a.outbox_id
          join companies c on c.id = o.company_id
          where a.id = ${attemptId}
          for update of a, o, c
        `;
        if (
          !row ||
          row.lease_token !== leaseToken ||
          row.state !== "claimed" ||
          row.attempt_count !== row.outbox_attempt_count ||
          row.outbox_status !== "processing" ||
          row.data_origin !== "client" ||
          row.company_status !== "active" ||
          !row.recipient ||
          row.redacted_at ||
          Date.parse(String(row.lease_expires_at)) <= Date.now()
        ) {
          return "stale";
        }
        await tx`
          update notification_delivery_attempts
          set state = 'send_started', send_started_at = now()
          where id = ${attemptId}
        `;
        return "started";
      });
    },

    async abortClaimedAttempt(
      attemptId: string,
      leaseToken: string,
      errorCode: string,
      now: string,
    ): Promise<OutcomeResult> {
      validNow(now);
      if (!errorCode.trim()) throw new Error("Preflight error code is required.");
      return withTransaction(sql, async (tx) => {
        const [attempt] = await tx<AttemptRow[]>`
          select * from notification_delivery_attempts where id = ${attemptId} for update
        `;
        if (!attempt || attempt.lease_token !== leaseToken) return "stale";
        const [outbox] = await tx<{ id: string; status: string; attempt_count: number }[]>`
          select id, status, attempt_count from notification_outbox
          where id = ${attempt.outbox_id} for update
        `;
        if (!outbox || outbox.attempt_count !== attempt.attempt_count) return "stale";
        if (attempt.state === "abandoned") return "replayed";
        if (attempt.state !== "claimed" || outbox.status !== "processing") return "stale";
        await tx`
          update notification_delivery_attempts set state = 'abandoned',
            error_code = ${errorCode}, finished_at = ${now}
          where id = ${attemptId}
        `;
        await tx`
          update notification_outbox set status = 'failed',
            next_attempt_at = ${retryAt(attempt.attempt_count, now)},
            last_error_code = ${errorCode},
            last_error_message = 'Dispatch preflight failed before provider call.',
            updated_at = now()
          where id = ${outbox.id}
        `;
        return "recorded";
      });
    },

    async recordProviderOutcome(
      attemptId: string,
      leaseToken: string,
      outcome: ProviderOutcome,
      now: string,
    ): Promise<OutcomeResult> {
      validNow(now);
      return withTransaction(sql, async (tx) => {
        const [attempt] = await tx<AttemptRow[]>`
          select * from notification_delivery_attempts where id = ${attemptId} for update
        `;
        if (!attempt || attempt.lease_token !== leaseToken) return "stale";
        const [outbox] = await tx<
          { id: string; status: string; attempt_count: number; max_attempts: number }[]
        >`
          select id, status, attempt_count, max_attempts from notification_outbox
          where id = ${attempt.outbox_id} for update
        `;
        if (!outbox || outbox.attempt_count !== attempt.attempt_count) return "stale";
        const state = outcome.kind === "definitelyRejected" ? "definitely_rejected" : outcome.kind;
        if (attempt.state !== "send_started") {
          if (
            attempt.state === state &&
            (outcome.kind !== "accepted" ||
              attempt.provider_message_id === outcome.providerMessageId)
          )
            return "replayed";
          return "stale";
        }
        if (outbox.status !== "processing") return "stale";
        if (outcome.kind === "accepted") {
          if (!outcome.providerMessageId.trim())
            throw new Error("Provider message ID is required for accepted delivery.");
          await tx`
            update notification_delivery_attempts set state = 'accepted',
              provider_message_id = ${outcome.providerMessageId}, finished_at = ${now}
            where id = ${attemptId}
          `;
          await tx`
            update notification_outbox set status = 'sent', delivery = 'provider',
              provider_message_id = ${outcome.providerMessageId}, sent_at = ${now}, updated_at = now()
            where id = ${outbox.id}
          `;
        } else if (outcome.kind === "simulated") {
          await tx`
            update notification_delivery_attempts set state = 'simulated', finished_at = ${now}
            where id = ${attemptId}
          `;
          await tx`
            update notification_outbox set status = 'sent', delivery = 'simulated',
              provider_message_id = null, sent_at = ${now}, updated_at = now()
            where id = ${outbox.id}
          `;
        } else if (outcome.kind === "definitelyRejected") {
          if (!outcome.code.trim()) throw new Error("Definite rejection code is required.");
          await tx`
            update notification_delivery_attempts set state = 'definitely_rejected',
              error_code = ${outcome.code}, finished_at = ${now}
            where id = ${attemptId}
          `;
          await tx`
            update notification_outbox set status = 'failed',
              next_attempt_at = ${retryAt(attempt.attempt_count, now)},
              last_error_code = ${outcome.code},
              last_error_message = 'Provider definitely rejected this attempt.', updated_at = now()
            where id = ${outbox.id}
          `;
        } else {
          await tx`
            update notification_delivery_attempts set state = 'unknown',
              error_code = ${outcome.errorCode}, attempt_ref = ${outcome.attemptRef},
              finished_at = ${now}
            where id = ${attemptId}
          `;
          await tx`
            update notification_outbox set status = 'needs_reconciliation',
              last_error_code = ${outcome.errorCode},
              last_error_message = 'Provider outcome unknown; manual reconciliation required.',
              updated_at = now()
            where id = ${outbox.id}
          `;
        }
        return "recorded";
      });
    },
  };
}
