import { describe, expect, it, vi } from "vitest";
import { createNotificationDispatcher, createNotificationTransport } from "./dispatcher";
import {
  createLocalNotificationTransport,
  resetLocalNotificationTransportForTest,
} from "./local-transport";
import type {
  NotificationOutboxRecord,
  NotificationOutboxRepository,
  NotificationTransport,
} from "./types";

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

/**
 * resolveWhatsAppSendMode is module-private and only reachable through dispatchDue
 * when a lastInboundResolver is supplied, so this block is the only coverage the
 * TEXT-vs-TEMPLATE decision has. Every case asserts the exact WoztellSendMode handed
 * to the transport rather than the summary, because a wrong mode still reports
 * `sent: 1` — the failure is invisible in every other assertion this file makes.
 */
describe("WhatsApp session window resolution", () => {
  const now = "2026-08-26T12:00:00.000Z";
  const insideWindow = "2026-08-26T11:00:00.000Z";
  const outsideWindow = "2026-08-24T11:00:00.000Z";

  function dispatcherWith(options: {
    lastInboundAt: string | null;
    channel?: NotificationOutboxRecord["channel"];
    notificationType?: string;
    payload?: NotificationOutboxRecord["payload"];
  }) {
    const dispatch = vi.fn<NotificationTransport["dispatch"]>(async () => ({
      providerMessageId: "wamid.1",
    }));
    const lastInboundResolver = vi.fn(async (_phoneDigits: string) => options.lastInboundAt);
    const repo = repository([
      notification({
        channel: options.channel ?? "whatsapp",
        recipient: "+852 6090 3521",
        notificationType: options.notificationType ?? "annual_return_reminder_1_month",
        payload: options.payload ?? { body: "composed body" },
      }),
    ]);
    const dispatcher = createNotificationDispatcher(repo, { dispatch }, { lastInboundResolver });
    return { dispatch, dispatcher, lastInboundResolver, repo };
  }

  it("sends TEXT inside the window", async () => {
    const { dispatch, dispatcher, lastInboundResolver } = dispatcherWith({
      lastInboundAt: insideWindow,
    });

    await dispatcher.dispatchDue(now);

    expect(dispatch.mock.calls[0][1]).toEqual({
      whatsAppSendMode: { kind: "text", body: "composed body" },
    });
    // The recipient is stored as "+852 6090 3521" but contacts are keyed on digits.
    expect(lastInboundResolver).toHaveBeenCalledWith("85260903521");
  });

  it("sends TEXT inside the window even when a template name was supplied", async () => {
    const { dispatch, dispatcher } = dispatcherWith({
      lastInboundAt: insideWindow,
      payload: { body: "composed body", templateName: "annual_return_manual_reminder" },
    });

    await dispatcher.dispatchDue(now);

    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "text",
      body: "composed body",
    });
  });

  it("uses the supplied template outside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({
      lastInboundAt: outsideWindow,
      payload: {
        body: "composed body",
        templateName: "annual_return_manual_reminder",
        languageCode: "zh_HK",
      },
    });

    await dispatcher.dispatchDue(now);

    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "template",
      elementName: "annual_return_manual_reminder",
      languageCode: "zh_HK",
      components: [],
    });
  });

  // The case above cannot tell "the payload's language" from "the fallback's
  // language" — annual_return_reminder_ maps to zh_HK too. This one has no fallback
  // to borrow from and asks for a language the fallback table never returns.
  it("forwards the payload's own language and components on the supplied template", async () => {
    const { dispatch, dispatcher } = dispatcherWith({
      lastInboundAt: outsideWindow,
      notificationType: "unmapped_type",
      payload: {
        body: "composed body",
        templateName: "annual_return_manual_reminder",
        languageCode: "en_US",
        templateComponents: [{ type: "body", parameters: [{ type: "text", text: "6090" }] }],
      },
    });

    await dispatcher.dispatchDue(now);

    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "template",
      elementName: "annual_return_manual_reminder",
      languageCode: "en_US",
      components: [{ type: "body", parameters: [{ type: "text", text: "6090" }] }],
    });
  });

  it("falls back to the mapped re-engagement template outside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({ lastInboundAt: outsideWindow });

    await dispatcher.dispatchDue(now);

    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "template",
      elementName: "annual_return_reengagement",
      languageCode: "zh_HK",
      components: [],
    });
  });

  it("treats a contact who has never messaged us as outside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({ lastInboundAt: null });

    await dispatcher.dispatchDue(now);

    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "template",
      elementName: "annual_return_reengagement",
      languageCode: "zh_HK",
      components: [],
    });
  });

  // attemptCount 1 of maxAttempts 3, so this lands on markRetry, not markFailed. The
  // error code is asserted because "something threw" is the one thing a silently
  // reverted guard would also produce.
  it("fails the dispatch when outside the window with no template mapped", async () => {
    const { dispatch, dispatcher, repo } = dispatcherWith({
      lastInboundAt: outsideWindow,
      notificationType: "unmapped_type",
    });

    const summary = await dispatcher.dispatchDue(now);

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, sent: 0, retried: 1, permanentlyFailed: 0 });
    expect(repo.markRetry).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      expect.objectContaining({ errorCode: "whatsapp_no_fallback_template" }),
    );
  });

  it("does not resolve at all when no resolver is supplied", async () => {
    const dispatch = vi.fn<NotificationTransport["dispatch"]>(async () => ({
      providerMessageId: "wamid.1",
    }));
    const record = notification({
      channel: "whatsapp",
      recipient: "+852 6090 3521",
      payload: { body: "hi" },
    });

    const dispatcher = createNotificationDispatcher(repository([record]), { dispatch }, {});

    await expect(dispatcher.dispatchDue(now)).resolves.toMatchObject({ claimed: 1, sent: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toBe(record);
    // Strictly undefined, not merely falsy: local and simulated transports take one
    // argument, and an empty-object context would still be a behaviour change.
    expect(dispatch.mock.calls[0][1]).toBeUndefined();
  });

  it("leaves a non-WhatsApp notification unresolved even when a resolver is supplied", async () => {
    const { dispatch, dispatcher, lastInboundResolver } = dispatcherWith({
      lastInboundAt: insideWindow,
      channel: "email",
    });

    await dispatcher.dispatchDue(now);

    expect(lastInboundResolver).not.toHaveBeenCalled();
    expect(dispatch.mock.calls[0][1]).toBeUndefined();
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

  it("routes a whatsapp notification to the WOZTELL transport with its resolved send mode", async () => {
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
        { whatsAppSendMode: { kind: "text", body: "hi" } },
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
        { whatsAppSendMode: { kind: "text", body: "hi" } },
      ),
    ).resolves.toEqual({ providerMessageId: "wamid.2" });
  });

  // These two are the only coverage createWoztellNotificationTransport has. They run
  // the REAL transport (not a vi.fn stub) through the composite router, so they also
  // guard the context forwarding in createNotificationTransport. Both are written to
  // fail if the transport ever goes back to inferring TEXT-vs-TEMPLATE from
  // payload.templateName: the payloads deliberately contradict the resolved mode.
  it("puts the resolved send mode on the wire, ignoring the payload's template hints", async () => {
    const sent: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { response: Record<string, unknown>[] };
      sent.push(body.response[0]);
      return new Response(
        JSON.stringify({
          ok: 1,
          sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.3" }] } }] },
        }),
        { status: 200 },
      );
    };
    const transport = createNotificationTransport({
      providerMode: "live",
      config: whatsappConfig,
      resendConfig,
      fetchImpl,
    });

    // Outside the window: the fallback TEMPLATE is sent even though the payload
    // carries only a composed body and names no template.
    await expect(
      transport.dispatch(notification({ payload: { body: "跟進提醒" } }), {
        whatsAppSendMode: {
          kind: "template",
          elementName: "annual_return_reengagement",
          languageCode: "zh_HK",
          components: [],
        },
      }),
    ).resolves.toEqual({ providerMessageId: "wamid.3" });

    // Inside the window: the composed body is sent even though the payload names a
    // template — the bug that used to discard an engaged client's reminder text.
    await expect(
      transport.dispatch(
        notification({
          payload: { body: "跟進提醒", templateName: "annual_return_reengagement" },
        }),
        { whatsAppSendMode: { kind: "text", body: "跟進提醒" } },
      ),
    ).resolves.toEqual({ providerMessageId: "wamid.3" });

    expect(sent[0]).toEqual({
      type: "TEMPLATE",
      elementName: "annual_return_reengagement",
      languageCode: "zh_HK",
      components: [],
    });
    expect(sent[1]).toEqual({ type: "TEXT", text: "跟進提醒" });
  });

  it("refuses to send a whatsapp notification that arrives without a resolved send mode", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
        fetchImpl,
      }).dispatch(
        // templateName is present on purpose: the deleted inference would have
        // happily sent this, so a revert of the missing-mode guard fails here.
        notification({ payload: { body: "hi", templateName: "annual_return_reengagement" } }),
      ),
    ).rejects.toMatchObject({ code: "whatsapp_send_mode_missing" });

    expect(fetchImpl).not.toHaveBeenCalled();
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
