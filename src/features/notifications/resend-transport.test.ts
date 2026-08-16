import { describe, expect, it, vi } from "vitest";
import { createResendNotificationTransport } from "./resend-transport";
import type { NotificationOutboxRecord } from "./types";

const config = { apiKey: "re_test_key", from: "Kossilon Hub <auth@example.test>" };

function notification(overrides: Partial<NotificationOutboxRecord> = {}): NotificationOutboxRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000002",
    workItemId: null,
    channel: "email",
    notificationType: "test",
    idempotencyKey: "test-key",
    recipient: "client@example.test",
    payload: { body: "Reminder body" },
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

function successResponse(id: string) {
  return new Response(JSON.stringify({ id }), { status: 200 });
}

describe("createResendNotificationTransport", () => {
  it("posts the documented Resend request shape", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenInit = init;
      return successResponse("resend-msg-1");
    });

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).resolves.toEqual({ providerMessageId: "resend-msg-1" });

    expect(seenUrl).toBe("https://api.resend.com/emails");
    expect(seenInit?.method).toBe("POST");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["idempotency-key"]).toBe("notification-outbox/test-key");
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      from: "Kossilon Hub <auth@example.test>",
      to: ["client@example.test"],
      subject: "Kossilon Hub notification",
      text: "Reminder body",
    });
  });

  it("uses a supplied subject instead of the default", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      successResponse("resend-msg-2"),
    );

    await createResendNotificationTransport(config, fetchImpl).dispatch(
      notification({ payload: { body: "Reminder body", subject: "Annual return reminder" } }),
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.subject).toBe("Annual return reminder");
  });

  it("rejects a non-email channel", async () => {
    await expect(
      createResendNotificationTransport(config, vi.fn()).dispatch(
        notification({ channel: "whatsapp" }),
      ),
    ).rejects.toThrow("Unsupported notification channel: whatsapp.");
  });

  it("rejects a notification with no recipient", async () => {
    await expect(
      createResendNotificationTransport(config, vi.fn()).dispatch(
        notification({ recipient: null }),
      ),
    ).rejects.toThrow("Email notification is missing a recipient.");
  });

  it("rejects a notification with no message body", async () => {
    await expect(
      createResendNotificationTransport(config, vi.fn()).dispatch(notification({ payload: {} })),
    ).rejects.toThrow("Email notification is missing a message body.");
  });

  it("throws a resend_<status>-coded error on a non-2xx response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Invalid `from` address." }), { status: 422 }),
    );

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).rejects.toMatchObject({
      message: "Invalid `from` address.",
      code: "resend_422",
    });
  });

  it("falls back to a generic message when the error response has no message field", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).rejects.toMatchObject({
      message: "Resend rejected the send with HTTP 500.",
      code: "resend_500",
    });
  });

  it("throws when a successful response is missing a provider message id", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).rejects.toThrow("Resend response is missing a provider message ID.");
  });
});
