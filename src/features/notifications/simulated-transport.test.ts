import { describe, expect, it, vi } from "vitest";
import type { NotificationOutboxRecord } from "./types";
import { createSimulatedNotificationTransport } from "./simulated-transport";

function notification(channel: NotificationOutboxRecord["channel"]): NotificationOutboxRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    workItemId: null,
    channel,
    notificationType: "demo",
    idempotencyKey: "demo:" + channel + ":1",
    recipient: channel === "email" ? "demo@example.test" : "+85290000000",
    payload: { body: "Synthetic demo message" },
    status: "processing",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-16T09:00:00.000Z",
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    retentionUntil: "2026-10-16T09:00:00.000Z",
  };
}

describe("simulated notification transport", () => {
  /**
   * REGRESSION GUARD. This used to return
   * `providerMessageId: "simulated:<channel>:<outbox-id>"`, and the dispatcher
   * persisted that fabricated string as if a provider had acknowledged the send.
   * No provider did, so there is nothing to return — the value must not exist.
   */
  it("acknowledges the dispatch with no provider id and without calling fetch", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const transport = createSimulatedNotificationTransport();

    await expect(transport.dispatch(notification("whatsapp"))).resolves.toEqual({
      delivery: "simulated",
    });
    await expect(transport.dispatch(notification("email"))).resolves.toEqual({
      delivery: "simulated",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
