import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalNotificationTransport,
  getLocalNotificationPayloadsForTest,
  resetLocalNotificationTransportForTest,
} from "./local-transport";
import type { NotificationOutboxRecord } from "./types";

function notification(): NotificationOutboxRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000002",
    workItemId: null,
    channel: "whatsapp",
    notificationType: "test",
    idempotencyKey: "test-key",
    recipient: "+85290000000",
    payload: { body: "Test message" },
    status: "processing",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-12T00:00:00.000Z",
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    retentionUntil: "2026-10-12T00:00:00.000Z",
  };
}

describe("local notification transport", () => {
  afterEach(() => {
    resetLocalNotificationTransportForTest();
    vi.unstubAllGlobals();
  });

  it("records payloads and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const item = notification();

    await expect(createLocalNotificationTransport().dispatch(item)).resolves.toEqual({
      providerMessageId: `local:${item.id}`,
    });
    expect(getLocalNotificationPayloadsForTest()).toEqual([item]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
