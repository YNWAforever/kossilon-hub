import { describe, expect, it, vi } from "vitest";
import { createNotificationDispatcher } from "./dispatcher";
import type { NotificationOutboxRecord, NotificationOutboxRepository } from "./types";

function notification(overrides: Partial<NotificationOutboxRecord> = {}): NotificationOutboxRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000002",
    workItemId: null,
    channel: "whatsapp",
    notificationType: "test",
    idempotencyKey: "test-key",
    recipient: "+85290000000",
    payload: {},
    status: "processing",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-12T00:00:00.000Z",
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    retentionUntil: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

function repository(rows: NotificationOutboxRecord[]): NotificationOutboxRepository {
  return {
    enqueue: vi.fn(),
    claimDue: vi.fn(async () => rows),
    markSent: vi.fn(async () => undefined),
    markRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("notification dispatcher", () => {
  it("persists provider IDs after a successful dispatch", async () => {
    const repo = repository([notification()]);
    const dispatcher = createNotificationDispatcher(repo, {
      dispatch: vi.fn(async () => ({ providerMessageId: "provider-1" })),
    });
    await expect(dispatcher.dispatchDue("2026-07-12T00:00:00.000Z", 10)).resolves.toMatchObject({
      claimed: 1,
      sent: 1,
    });
    expect(repo.markSent).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "provider-1",
      "2026-07-12T00:00:00.000Z",
    );
  });

  it("retries transient failures and permanently fails the final attempt", async () => {
    const retryRepo = repository([notification({ attemptCount: 1 })]);
    const retryDispatcher = createNotificationDispatcher(retryRepo, {
      dispatch: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    await expect(retryDispatcher.dispatchDue("2026-07-12T00:00:00.000Z")).resolves.toMatchObject({
      retried: 1,
    });
    expect(retryRepo.markRetry).toHaveBeenCalled();

    const failedRepo = repository([notification({ attemptCount: 3 })]);
    const failedDispatcher = createNotificationDispatcher(failedRepo, {
      dispatch: vi.fn(async () => {
        throw new Error("rejected");
      }),
    });
    await expect(failedDispatcher.dispatchDue("2026-07-12T00:00:00.000Z")).resolves.toMatchObject({
      permanentlyFailed: 1,
    });
    expect(failedRepo.markFailed).toHaveBeenCalled();
  });
});
