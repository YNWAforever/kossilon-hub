import { describe, expect, it } from "vitest";
import {
  classifyWoztellWebhookEvent,
  normalizeWoztellInboundMessage,
  sendWoztellMessage,
} from "./woztell";
import {
  WOZTELL_API_OUTBOUND,
  WOZTELL_BATCH_MEMBER_UPDATE,
  WOZTELL_DOCUMENTED_PAYLOADS,
  WOZTELL_INBOUND_MISC_VIDEO,
  WOZTELL_INBOUND_TEXT,
  WOZTELL_MEMBER_UPDATE,
  WOZTELL_NODE_TRIGGER,
  WOZTELL_STATUS_DELIVERED,
  WOZTELL_STATUS_READ,
} from "./woztell-fixtures";

describe("WOZTELL timestamp handling", () => {
  // WOZTELL sends epoch seconds as a *string*. `new Date("1599536864")` is
  // Invalid Date, which silently fell back to "now" and stamped every inbound
  // message with its processing time instead of when the client sent it.
  it("reads epoch seconds sent as a string", () => {
    expect(normalizeWoztellInboundMessage(WOZTELL_INBOUND_TEXT).receivedAt).toBe(
      "2020-09-08T03:47:44.000Z",
    );
  });

  it("reads epoch milliseconds sent as a number", () => {
    const payload = { ...WOZTELL_INBOUND_TEXT, timestamp: WOZTELL_STATUS_READ.timestamp };
    expect(normalizeWoztellInboundMessage(payload).receivedAt).toBe("2023-12-07T02:08:25.000Z");
  });
});

describe("classifyWoztellWebhookEvent", () => {
  // The whole point: not one documented payload may throw. A throw is classified
  // "unreadable", acked 200, and lost forever.
  it("reads every payload WOZTELL documents without throwing", () => {
    for (const payload of WOZTELL_DOCUMENTED_PAYLOADS) {
      expect(() => classifyWoztellWebhookEvent(payload)).not.toThrow();
    }
  });

  it("treats an absent eventType as an inbound message", () => {
    const event = classifyWoztellWebhookEvent(WOZTELL_INBOUND_TEXT);

    expect(event.kind).toBe("message");
    expect(event.kind === "message" && event.message.body).toBe("Hello");
    expect(event.kind === "message" && event.message.fromWhatsAppId).toBe("85260903521");
    expect(event.kind === "message" && event.message.channelId).toBe("channeId");
    expect(event.kind === "message" && event.message.messageType).toBe("text");
  });

  it("classifies READ and DELIVERED as status events keyed on data.messageId", () => {
    const read = classifyWoztellWebhookEvent(WOZTELL_STATUS_READ);
    expect(read.kind).toBe("status");
    expect(read.kind === "status" && read.status.status).toBe("read");
    expect(read.kind === "status" && read.status.providerMessageId).toBe(
      WOZTELL_STATUS_READ.data.messageId,
    );
    expect(read.kind === "status" && read.status.occurredAt).toBe("2023-12-07T02:08:25.000Z");

    const delivered = classifyWoztellWebhookEvent(WOZTELL_STATUS_DELIVERED);
    expect(delivered.kind === "status" && delivered.status.status).toBe("delivered");
  });

  // A media message is a real client message. The old code threw for anything
  // without text, so an inbound video was acked 200 and discarded.
  it("keeps a media message and derives a body from its attachments", () => {
    const event = classifyWoztellWebhookEvent(WOZTELL_INBOUND_MISC_VIDEO);

    expect(event.kind).toBe("message");
    expect(event.kind === "message" && event.message.body).toBe("[video]");
    expect(event.kind === "message" && event.message.messageType).toBe("misc");
  });

  // Inbound TEXT carries no id at all, so one is derived. It has to be stable
  // across a redelivery of the identical body, or dedupe cannot work.
  it("derives a stable message id when WOZTELL sends none", () => {
    const first = classifyWoztellWebhookEvent(WOZTELL_INBOUND_TEXT);
    const second = classifyWoztellWebhookEvent({ ...WOZTELL_INBOUND_TEXT });

    expect(first.kind === "message" && first.message.providerMessageId).toMatch(
      /^woztell-derived:[0-9a-f]{16}$/,
    );
    expect(first.kind === "message" && first.message.providerMessageId).toBe(
      second.kind === "message" ? second.message.providerMessageId : null,
    );
  });

  it("gives two different messages two different derived ids", () => {
    const a = classifyWoztellWebhookEvent(WOZTELL_INBOUND_TEXT);
    const b = classifyWoztellWebhookEvent({
      ...WOZTELL_INBOUND_TEXT,
      data: { text: "A completely different message" },
    });

    expect(a.kind === "message" && a.message.providerMessageId).not.toBe(
      b.kind === "message" ? b.message.providerMessageId : null,
    );
  });

  it("records but does not ingest the non-message event types", () => {
    for (const payload of [
      WOZTELL_API_OUTBOUND,
      WOZTELL_MEMBER_UPDATE,
      WOZTELL_BATCH_MEMBER_UPDATE,
      WOZTELL_NODE_TRIGGER,
    ]) {
      expect(classifyWoztellWebhookEvent(payload).kind).toBe("ignored");
    }
  });

  // No unknown-event-safe default existed: everything was treated as an inbound
  // customer message. A new eventType must be recorded and acked, never thrown on.
  it("ignores an eventType it has never seen rather than throwing", () => {
    const event = classifyWoztellWebhookEvent({ eventType: "SOMETHING_NEW", foo: "bar" });

    expect(event.kind).toBe("ignored");
    expect(event.kind === "ignored" && event.eventType).toBe("SOMETHING_NEW");
  });

  it("still refuses a payload that is not a JSON object", () => {
    expect(() => classifyWoztellWebhookEvent("nope")).toThrow(
      "WOZTELL payload must be a JSON object.",
    );
  });

  it("refuses an inbound message with no sender", () => {
    expect(() => classifyWoztellWebhookEvent({ type: "TEXT", data: { text: "hi" } })).toThrow(
      "WOZTELL payload is missing sender identity.",
    );
  });

  it("refuses a status event with no message id to key on", () => {
    expect(() =>
      classifyWoztellWebhookEvent({ eventType: "INBOUND", type: "READ", from: "852", data: {} }),
    ).toThrow("WOZTELL status event is missing a message id.");
  });
});

const config = {
  provider: "woztell" as const,
  apiBaseUrl: "https://bot.api.woztell.com",
  accessToken: "token-123",
  channelId: "channel-1",
  webhookSecret: "secret-1234567890",
};

function sendResultResponse(id: string, status = 200) {
  return new Response(
    JSON.stringify({
      ok: 1,
      member: "member-1",
      sendResult: { ok: 1, member: "member-1", result: [{ result: { messages: [{ id }] } }] },
    }),
    { status },
  );
}

describe("sendWoztellMessage", () => {
  it("posts the documented sendResponses envelope", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenBody = JSON.parse(String(init?.body));
      return sendResultResponse("gBGGhSZphigfAglySd38a9T4jAE");
    };

    await expect(
      sendWoztellMessage(config, { toPhone: "+852 9000 0000", body: "Reminder body" }, fetchImpl),
    ).resolves.toEqual({ providerMessageId: "gBGGhSZphigfAglySd38a9T4jAE" });

    expect(seenUrl).toBe("https://bot.api.woztell.com/sendResponses");
    expect(seenBody).toEqual({
      channelId: "channel-1",
      recipientId: "85290000000",
      response: [{ type: "TEXT", text: "Reminder body" }],
    });
  });

  it("sends a template as the TEMPLATE response variant", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body));
      return sendResultResponse("wamid.template-1");
    };

    await sendWoztellMessage(
      config,
      {
        toPhone: "+85290000000",
        body: "ignored on the wire for a template",
        templateName: "annual_return_manual_reminder",
        languageCode: "zh_HK",
      },
      fetchImpl,
    );

    expect(seenBody.response).toEqual([
      {
        type: "TEMPLATE",
        elementName: "annual_return_manual_reminder",
        languageCode: "zh_HK",
        components: [],
      },
    ]);
  });

  // The single most likely production error: a number that is not on WhatsApp.
  // It used to surface as "response is missing a provider message ID".
  it("raises err_code 100 as an unreachable recipient rather than a missing id", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ ok: 0, err_code: 100, err: "Phone Number provided is invalid." }),
        { status: 200 },
      );

    await expect(
      sendWoztellMessage(config, { toPhone: "+85290000000", body: "hi" }, fetchImpl),
    ).rejects.toMatchObject({
      code: "woztell_err_100",
      errCode: 100,
      unreachableRecipient: true,
    });
  });

  it("treats ok:0 on a 2xx as a failure", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: 0, err: "User is not authorized." }), { status: 200 });

    await expect(
      sendWoztellMessage(config, { toPhone: "+85290000000", body: "hi" }, fetchImpl),
    ).rejects.toThrow("User is not authorized.");
  });

  it("reads the id from messageEvent when the result carries one", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          ok: 1,
          sendResult: {
            ok: 1,
            result: [{ messageEvent: { messageId: "wamid.from-event" } }],
          },
        }),
        { status: 200 },
      );

    await expect(
      sendWoztellMessage(config, { toPhone: "+85290000000", body: "hi" }, fetchImpl),
    ).resolves.toEqual({ providerMessageId: "wamid.from-event" });
  });
});
