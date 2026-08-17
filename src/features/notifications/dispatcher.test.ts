import { describe, expect, it, vi } from "vitest";
import { createNotificationDispatcher, createNotificationTransport } from "./dispatcher";
import {
  createLocalNotificationTransport,
  resetLocalNotificationTransportForTest,
} from "./local-transport";
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
    markSent: vi.fn(async () => true),
    markRetry: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
}

describe("notification dispatcher", () => {
  it("selects the local transport only when explicitly requested", async () => {
    const item = notification();
    await expect(
      createNotificationTransport({ providerMode: "local" }).dispatch(item),
    ).resolves.toEqual({
      providerMessageId: `local:${item.id}`,
    });
  });
  it("selects the simulated transport without requiring live configuration", async () => {
    const item = notification({ channel: "email" });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      createNotificationTransport({ providerMode: "simulated" }).dispatch(item),
    ).resolves.toEqual({
      providerMessageId: "simulated:email:" + item.id,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("persists deterministic local provider IDs without network dispatch", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const repo = repository([notification()]);

    await expect(
      createNotificationDispatcher(repo, createLocalNotificationTransport()).dispatchDue(
        "2026-07-12T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({ claimed: 1, sent: 1 });

    expect(repo.markSent).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "local:00000000-0000-0000-0000-000000000001",
      "2026-07-12T00:00:00.000Z",
      1,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    resetLocalNotificationTransportForTest();
    vi.unstubAllGlobals();
  });

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
      1,
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

  // The outbox payload already carries whatsappMessageId — whatsapp/repository.ts
  // reads it back for idempotent replay (resolveWhatsAppReplayMessageId). Without
  // writing the provider id onto that row, provider_message_id stays null forever
  // and every DELIVERED/READ receipt is unmatchable.
  it("writes the provider message id onto the linked whatsapp_messages row", async () => {
    const repo = repository([
      notification({ payload: { body: "Reminder body", whatsappMessageId: "wa-msg-1" } }),
    ]);
    const attachProviderMessageId = vi.fn(async () => true);

    await createNotificationDispatcher(
      repo,
      { dispatch: vi.fn(async () => ({ providerMessageId: "wamid.sent-1" })) },
      { whatsAppRepository: { attachProviderMessageId } },
    ).dispatchDue("2026-07-12T00:00:00.000Z");

    expect(attachProviderMessageId).toHaveBeenCalledWith({
      messageId: "wa-msg-1",
      providerMessageId: "wamid.sent-1",
    });
  });

  it("leaves a notification with no linked WhatsApp row alone", async () => {
    const repo = repository([notification({ channel: "email", payload: { body: "hi" } })]);
    const attachProviderMessageId = vi.fn(async () => true);

    await createNotificationDispatcher(
      repo,
      { dispatch: vi.fn(async () => ({ providerMessageId: "provider-1" })) },
      { whatsAppRepository: { attachProviderMessageId } },
    ).dispatchDue("2026-07-12T00:00:00.000Z");

    expect(attachProviderMessageId).not.toHaveBeenCalled();
  });

  // A send that succeeded must stay succeeded. If linking throws and the error
  // escapes, the row is marked for retry and the client gets the message twice.
  it("still counts the send when linking the provider id fails", async () => {
    const repo = repository([
      notification({ payload: { body: "Reminder body", whatsappMessageId: "wa-msg-1" } }),
    ]);

    await expect(
      createNotificationDispatcher(
        repo,
        { dispatch: vi.fn(async () => ({ providerMessageId: "wamid.sent-1" })) },
        {
          whatsAppRepository: {
            attachProviderMessageId: vi.fn(async () => {
              throw new Error("connection lost");
            }),
          },
        },
      ).dispatchDue("2026-07-12T00:00:00.000Z"),
    ).resolves.toMatchObject({ claimed: 1, sent: 1 });

    expect(repo.markRetry).not.toHaveBeenCalled();
  });
});

describe("createNotificationTransport (live mode composite routing)", () => {
  const whatsappConfig = {
    provider: "woztell" as const,
    apiBaseUrl: "https://api.example.test",
    accessToken: "test-token",
    channelId: "channel-1",
    webhookSecret: "test-secret-value",
  };
  const resendConfig = { apiKey: "re_test_key", from: "Kossilon Hub <auth@example.test>" };

  it("routes a whatsapp notification to the WOZTELL transport, unchanged", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.1" }] } }] },
          }),
          { status: 200 },
        ),
    );

    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
        fetchImpl,
      }).dispatch(
        notification({ channel: "whatsapp", recipient: "+85290000000", payload: { body: "hi" } }),
      ),
    ).resolves.toEqual({ providerMessageId: "wamid.1" });
  });

  it("routes an email notification to the Resend transport when configured", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 }),
    );

    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
        fetchImpl,
      }).dispatch(
        notification({
          channel: "email",
          recipient: "client@example.test",
          payload: { body: "hi" },
        }),
      ),
    ).resolves.toEqual({ providerMessageId: "resend-msg-1" });
  });

  it("fails only the email channel, with a diagnostic code, when Resend is not configured", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.2" }] } }] },
          }),
          { status: 200 },
        ),
    );
    const transport = createNotificationTransport({
      providerMode: "live",
      config: whatsappConfig,
      resendConfig: null,
      fetchImpl,
    });

    await expect(
      transport.dispatch(
        notification({
          channel: "email",
          recipient: "client@example.test",
          payload: { body: "hi" },
        }),
      ),
    ).rejects.toMatchObject({ code: "resend_not_configured" });

    // Same transport instance — WhatsApp must be completely unaffected.
    await expect(
      transport.dispatch(
        notification({ channel: "whatsapp", recipient: "+85290000000", payload: { body: "hi" } }),
      ),
    ).resolves.toEqual({ providerMessageId: "wamid.2" });
  });

  it("still rejects an in_app notification, unchanged from today", async () => {
    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
      }).dispatch(notification({ channel: "in_app" })),
    ).rejects.toThrow("Unsupported notification channel: in_app.");
  });
});
