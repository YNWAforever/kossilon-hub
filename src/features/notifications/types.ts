import type postgres from "postgres";

export type NotificationChannel = "email" | "whatsapp" | "in_app";
export type NotificationStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export type NotificationIdentity = {
  companyId: string;
  workItemId?: string | null;
  channel: NotificationChannel;
  notificationType: string;
  recipient?: string | null;
};

/**
 * `recipient` is required here even though it is optional on NotificationIdentity,
 * which also describes rows already written. notification_outbox_redaction_check
 * rejects a null recipient on a non-redacted row, so an enqueue without one always
 * fails at the database — this makes that a compile error instead. Redacted rows
 * legitimately have no recipient, which is why the base type stays optional.
 */
export type EnqueueNotificationInput = Omit<NotificationIdentity, "recipient"> & {
  recipient: string;
  idempotencyKey?: string;
  payload?: postgres.JSONValue;
  maxAttempts?: number;
  retentionUntil?: string;
};

export type NotificationOutboxRecord = NotificationIdentity & {
  id: string;
  idempotencyKey: string;
  payload: postgres.JSONValue | null;
  status: NotificationStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  sentAt: string | null;
  retentionUntil: string;
};

export type NotificationDispatchResult = {
  providerMessageId: string;
};

export type NotificationTransport = {
  dispatch(notification: NotificationOutboxRecord): Promise<NotificationDispatchResult>;
};

export type DispatchSummary = {
  claimed: number;
  sent: number;
  retried: number;
  permanentlyFailed: number;
};

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

export type NotificationDispatcher = {
  dispatchDue(now: string, limit?: number): Promise<DispatchSummary>;
};
