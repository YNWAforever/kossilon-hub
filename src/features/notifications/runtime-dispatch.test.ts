import { describe, expect, it, vi } from "vitest";
import type { NotificationOutboxRecord, NotificationOutboxRepository } from "./types";
import { createSimulatedNotificationTransport } from "./simulated-transport";
import { dispatchDueNotificationsWithDependencies } from "./runtime-dispatch";

const row: NotificationOutboxRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  workItemId: null,
  channel: "whatsapp",
  notificationType: "follow_up",
  idempotencyKey: "follow-up:annual-return:case:case",
  recipient: "+85291234567",
  payload: { body: "Persisted body" },
  status: "processing",
  attemptCount: 1,
  maxAttempts: 3,
  nextAttemptAt: "2026-07-14T09:00:00.000Z",
  providerMessageId: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  sentAt: null,
  retentionUntil: "2026-10-14T09:00:00.000Z",
};

function repository(rows: NotificationOutboxRecord[]): NotificationOutboxRepository {
  let claimed = false;
  return {
    enqueue: vi.fn(),
    claimDue: vi.fn(async () => {
      if (claimed) return [];
      claimed = true;
      return rows;
    }),
    markSent: vi.fn(async () => true),
    markRetry: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
}

describe("runtime notification dispatch", () => {
  it("selects local mode, persists deterministic delivery once, closes, and never fetches", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const repo = repository([row]);
    const currentProviderMode = vi.fn(() => "local" as const);

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:00:00.000Z", limit: 10 },
        { currentProviderMode, createRepository: () => repo },
      ),
    ).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 });

    expect(repo.markSent).toHaveBeenCalledWith(
      row.id,
      `local:${row.id}`,
      "2026-07-14T09:00:00.000Z",
      1,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repo.close).toHaveBeenCalledTimes(1);

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:01:00.000Z", limit: 10 },
        { currentProviderMode, createRepository: () => repo },
      ),
    ).resolves.toMatchObject({ claimed: 0, sent: 0 });
    expect(repo.markSent).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("selects simulated mode without requesting live configuration", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const repo = repository([row]);
    const getLiveConfig = vi.fn(() => ({
      provider: "woztell" as const,
      apiBaseUrl: "https://example.test",
      accessToken: "test-token",
      channelId: "channel-1",
      webhookSecret: "test-secret-value",
    }));
    const createTransport = vi.fn(() => createSimulatedNotificationTransport());

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:00:00.000Z" },
        {
          currentProviderMode: () => "simulated",
          createRepository: () => repo,
          createTransport,
          getLiveConfig,
        },
      ),
    ).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 });

    expect(repo.markSent).toHaveBeenCalledWith(
      row.id,
      "simulated:whatsapp:" + row.id,
      "2026-07-14T09:00:00.000Z",
      1,
    );
    expect(createTransport).toHaveBeenCalledWith({ providerMode: "simulated", config: undefined });
    expect(getLiveConfig).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("persists retry state through the selected transport and always closes", async () => {
    const repo = repository([row]);
    const createTransport = vi.fn(() => ({
      dispatch: vi.fn(async () => {
        throw new Error("temporary outage");
      }),
    }));

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:00:00.000Z" },
        {
          currentProviderMode: () => "live",
          createRepository: () => repo,
          createTransport,
          getLiveConfig: () => ({
            provider: "woztell",
            apiBaseUrl: "https://example.test",
            accessToken: "test-token",
            channelId: "channel-1",
            webhookSecret: "test-secret-value",
          }),
        },
      ),
    ).resolves.toMatchObject({ retried: 1, sent: 0 });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ providerMode: "live", config: expect.any(Object) }),
    );
    expect(repo.markRetry).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ errorMessage: "temporary outage" }),
    );
    expect(repo.close).toHaveBeenCalledTimes(1);
  });
});
