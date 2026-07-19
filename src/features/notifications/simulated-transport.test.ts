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
  it("returns deterministic demo provider IDs without calling fetch", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const transport = createSimulatedNotificationTransport();

    await expect(transport.dispatch(notification("whatsapp"))).resolves.toEqual({
      providerMessageId: "simulated:whatsapp:11111111-1111-4111-8111-111111111111",
    });
    await expect(transport.dispatch(notification("email"))).resolves.toEqual({
      providerMessageId: "simulated:email:11111111-1111-4111-8111-111111111111",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
