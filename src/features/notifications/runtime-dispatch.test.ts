import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import type { NotificationOutboxRecord, NotificationOutboxRepository } from "./types";
import { createSimulatedNotificationTransport } from "./simulated-transport";
import {
  dispatchDueNotificationsForActor,
  dispatchDueNotificationsWithDependencies,
} from "./runtime-dispatch";

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

const liveWhatsAppConfig = {
  provider: "woztell" as const,
  apiBaseUrl: "https://example.test",
  accessToken: "test-token",
  channelId: "channel-1",
  webhookSecret: "test-secret-value",
};

/**
 * Only the two methods dispatchDue reaches through `createWhatsAppRepository` are
 * real; the rest of WhatsAppRepository is database surface this path never touches,
 * and stubbing all of it would obscure which two actually matter.
 */
function whatsAppRepositoryStub(overrides: {
  lastInboundAtForPhoneDigits: WhatsAppRepository["lastInboundAtForPhoneDigits"];
}): WhatsAppRepository {
  return {
    ...overrides,
    close: vi.fn(async () => undefined),
  } as unknown as WhatsAppRepository;
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
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMode: "simulated",
        config: undefined,
        resendConfig: undefined,
      }),
    );
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

  it("passes the resend config through only in live mode", async () => {
    const repo = repository([row]);
    const createTransport = vi.fn(() => ({
      dispatch: vi.fn(async () => ({ providerMessageId: "test-id" })),
    }));
    const getResendConfig = vi.fn(() => ({ apiKey: "re_test_key", from: "auth@example.test" }));

    await dispatchDueNotificationsWithDependencies(
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
        getResendConfig,
      },
    );

    expect(getResendConfig).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        resendConfig: { apiKey: "re_test_key", from: "auth@example.test" },
      }),
    );
  });

  it("does not request the resend config outside live mode", async () => {
    const repo = repository([row]);
    const getResendConfig = vi.fn(() => ({ apiKey: "re_test_key", from: "auth@example.test" }));

    await dispatchDueNotificationsWithDependencies(
      { now: "2026-07-14T09:00:00.000Z" },
      { currentProviderMode: () => "local", createRepository: () => repo, getResendConfig },
    );

    expect(getResendConfig).not.toHaveBeenCalled();
  });

  it("dispatches a live email notification through the real transport chain end-to-end", async () => {
    // No createTransport override here — this exercises the real composite router
    // from dispatcher.ts and the real createResendNotificationTransport, wired
    // through the default global `fetch`, not a directly-injected fetchImpl. Every
    // other live-mode test above mocks createTransport, so this is the only test
    // that actually walks the seam runtime-dispatch.ts -> dispatcher.ts -> resend-transport.ts.
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: "resend-msg-live-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const emailRow: NotificationOutboxRecord = {
      ...row,
      channel: "email",
      recipient: "client@example.test",
    };
    const repo = repository([emailRow]);

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:00:00.000Z" },
        {
          currentProviderMode: () => "live",
          createRepository: () => repo,
          getLiveConfig: () => ({
            provider: "woztell",
            apiBaseUrl: "https://example.test",
            accessToken: "test-token",
            channelId: "channel-1",
            webhookSecret: "test-secret-value",
          }),
          getResendConfig: () => ({ apiKey: "re_test_key", from: "auth@example.test" }),
        },
      ),
    ).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
    expect(repo.close).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  // The WhatsApp twin of the email test above, and for the same reason: every other
  // live-mode test here mocks createTransport, so nothing else walks
  // runtime-dispatch.ts -> dispatcher.ts -> woztell.ts with the real transport.
  //
  // This is the test that would have caught the break these two were added for.
  // Wiring `whatsAppRepository` without also wiring `lastInboundResolver` left
  // dispatchDue passing `context: undefined` for every whatsapp row, so the WOZTELL
  // transport threw whatsapp_send_mode_missing before it ever called fetch: live
  // WhatsApp dispatch sent zero messages while every unit test stayed green. The
  // `fetch` assertions below are the teeth — a mis-wired dispatcher never gets there.
  it("sends TEXT on the wire for a live whatsapp row inside the session window", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.live-text" }] } }] },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const repo = repository([row]);
    // 2 hours before `now` — comfortably inside the 24-hour window.
    const lastInboundAtForPhoneDigits = vi.fn(async () => "2026-07-14T07:00:00.000Z");

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:00:00.000Z" },
        {
          currentProviderMode: () => "live",
          createRepository: () => repo,
          createWhatsAppRepository: () => whatsAppRepositoryStub({ lastInboundAtForPhoneDigits }),
          getLiveConfig: () => liveWhatsAppConfig,
        },
      ),
    ).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 });

    expect(lastInboundAtForPhoneDigits).toHaveBeenCalledWith("85291234567");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/sendResponses");
    expect(JSON.parse(String(init.body))).toEqual({
      channelId: "channel-1",
      recipientId: "85291234567",
      response: [{ type: "TEXT", text: "Persisted body" }],
    });
    expect(repo.markSent).toHaveBeenCalledWith(
      row.id,
      "wamid.live-text",
      "2026-07-14T09:00:00.000Z",
      1,
    );
    vi.unstubAllGlobals();
  });

  it("sends the fallback TEMPLATE on the wire for a live whatsapp row outside the window", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.live-tpl" }] } }] },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);
    // Exactly what runAnnualReturnReminderSweep enqueues: a body, no template hints.
    const sweepRow: NotificationOutboxRecord = {
      ...row,
      notificationType: "annual_return_reminder_t14",
    };
    const repo = repository([sweepRow]);
    // Never heard from, so the composed body is undeliverable and a template is required.
    const lastInboundAtForPhoneDigits = vi.fn(async () => null);

    await expect(
      dispatchDueNotificationsWithDependencies(
        { now: "2026-07-14T09:00:00.000Z" },
        {
          currentProviderMode: () => "live",
          createRepository: () => repo,
          createWhatsAppRepository: () => whatsAppRepositoryStub({ lastInboundAtForPhoneDigits }),
          getLiveConfig: () => liveWhatsAppConfig,
        },
      ),
    ).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/sendResponses");
    expect(JSON.parse(String(init.body))).toEqual({
      channelId: "channel-1",
      recipientId: "85291234567",
      response: [
        {
          type: "TEMPLATE",
          elementName: "annual_return_reengagement",
          languageCode: "zh_HK",
          components: [],
        },
      ],
    });
    vi.unstubAllGlobals();
  });
});

const adminActor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Admin",
  teamId: null,
  active: true,
};
const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

describe("dispatchDueNotificationsForActor", () => {
  it("rejects a non-admin actor", async () => {
    const dispatch = vi.fn();

    await expect(dispatchDueNotificationsForActor(staffActor, {}, { dispatch })).rejects.toThrow(
      "Forbidden: Admin access is required.",
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects an inactive admin actor", async () => {
    const dispatch = vi.fn();

    await expect(
      dispatchDueNotificationsForActor({ ...adminActor, active: false }, {}, { dispatch }),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches and logs for an admin actor", async () => {
    const summary = { claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 };
    const dispatch = vi.fn(async () => summary);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await dispatchDueNotificationsForActor(adminActor, { limit: 10 }, { dispatch });

    expect(result).toEqual(summary);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, now: expect.any(String) }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Manual outbox dispatch",
      expect.objectContaining({ actorId: adminActor.userId, summary }),
    );

    logSpy.mockRestore();
  });
});
