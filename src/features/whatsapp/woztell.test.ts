import { describe, expect, it } from "vitest";
import { normalizeWoztellInboundMessage, sendWoztellMessage } from "./woztell";

describe("WOZTELL inbound payload normalization", () => {
  it("extracts a text inbound message from common WOZTELL-style fields", () => {
    const payload = {
      event: "message",
      channel: {
        id: "kossilon-whatsapp-channel",
      },
      contact: {
        wa_id: "85261234567",
        phone: "+852 6123 4567",
        profile: {
          name: "Ada Client",
        },
      },
      message: {
        id: "wamid.test-001",
        type: "text",
        text: {
          body: "Can you help with annual return filing?",
        },
        timestamp: "2026-07-05T12:00:00.000Z",
      },
    };

    expect(normalizeWoztellInboundMessage(payload)).toEqual({
      provider: "woztell",
      providerMessageId: "wamid.test-001",
      channelId: "kossilon-whatsapp-channel",
      fromWhatsAppId: "85261234567",
      fromPhone: "+85261234567",
      contactName: "Ada Client",
      messageType: "text",
      body: "Can you help with annual return filing?",
      receivedAt: "2026-07-05T12:00:00.000Z",
      rawPayload: payload,
    });
  });

  it("keeps the original raw payload for audit storage", () => {
    const payload = {
      id: "evt-001",
      from: "85261234567",
      text: "I uploaded the NAR1 proof.",
      timestamp: 1783252800,
    };

    const normalized = normalizeWoztellInboundMessage(payload);

    expect(normalized.rawPayload).toBe(payload);
    expect(normalized.receivedAt).toBe("2026-07-05T12:00:00.000Z");
  });

  it("rejects payloads without enough message identity", () => {
    expect(() =>
      normalizeWoztellInboundMessage({
        from: "85261234567",
        text: "Hello",
      }),
    ).toThrow("WOZTELL payload is missing provider message id.");
  });

  it("rejects payloads without sender identity", () => {
    expect(() =>
      normalizeWoztellInboundMessage({
        id: "wamid.test-002",
        text: "Hello",
      }),
    ).toThrow("WOZTELL payload is missing sender identity.");
  });

  it("rejects payloads without message body", () => {
    expect(() =>
      normalizeWoztellInboundMessage({
        id: "wamid.test-003",
        from: "85261234567",
        image: { id: "media-001" },
      }),
    ).toThrow("WOZTELL payload is missing message body.");
  });
  it("sends normalized outbound messages and returns the provider ID", async () => {
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://woztell.test/messages");
      expect(init?.headers).toMatchObject({ authorization: "Bearer token-123" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        channelId: "channel-1",
        to: "+85290000000",
        text: "Reminder body",
      });
      return new Response(JSON.stringify({ data: { messageId: "provider-123" } }), { status: 200 });
    };
    await expect(
      sendWoztellMessage(
        {
          provider: "woztell",
          apiBaseUrl: "https://woztell.test/",
          accessToken: "token-123",
          channelId: "channel-1",
          webhookSecret: "secret-1234567890",
        },
        { toPhone: "+85290000000", body: "Reminder body" },
        fetchImpl,
      ),
    ).resolves.toEqual({ providerMessageId: "provider-123" });
  });
});
