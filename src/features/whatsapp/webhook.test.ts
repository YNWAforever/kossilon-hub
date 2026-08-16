import { describe, expect, it, vi } from "vitest";

import {
  createWhatsAppWebhookHandler,
  providerEventIdFrom,
  readWoztellSignatureHeader,
  WHATSAPP_WEBHOOK_PATH,
} from "./webhook";
import { verifyWoztellSignature } from "./woztell";
import {
  WOZTELL_DOCUMENTED_PAYLOADS,
  WOZTELL_INBOUND_TEXT,
  WOZTELL_MEMBER_UPDATE,
  WOZTELL_STATUS_DELIVERED,
  WOZTELL_STATUS_READ,
} from "./woztell-fixtures";

const SECRET = "woztell-webhook-secret-value";

async function digestBytes(body: string, secret = SECRET): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

/** The encoding WOZTELL actually sends. */
async function sign(body: string, secret = SECRET): Promise<string> {
  return btoa(String.fromCharCode(...(await digestBytes(body, secret))));
}

/** The encoding this codebase used to expect, kept only to prove it is now refused. */
async function signHex(body: string, secret = SECRET): Promise<string> {
  return Array.from(await digestBytes(body, secret), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function inboundPayload() {
  return {
    from: "85290000001",
    to: "85268227287",
    timestamp: "1785000000",
    type: "TEXT",
    data: { text: "Received, thanks." },
    member: "member-1",
    channel: "channel-1",
    app: "app-1",
  };
}

function repositoryDouble() {
  const recordInboundMessage = vi.fn(async (_input: unknown) => ({
    id: "msg-1",
    provider: "woztell" as const,
    providerMessageId: "wamid.1",
    direction: "inbound" as const,
    status: "received" as const,
    companyId: "company-1",
    caseId: "case-1",
    timelineEventCreated: true,
  }));
  const recordWebhookEvent = vi.fn(async () => ({
    id: "evt-row-1",
    processingStatus: "processed" as const,
    errorMessage: null,
  }));
  const recordMessageStatusEvent = vi.fn(async (_input: unknown) => ({
    matched: true,
    messageId: "msg-1",
    status: "read" as const,
  }));
  const close = vi.fn(async () => {});
  return { recordInboundMessage, recordWebhookEvent, recordMessageStatusEvent, close };
}

function request(body: string, headers: Record<string, string>, method = "POST"): Request {
  return new Request(`https://firm.example.com${WHATSAPP_WEBHOOK_PATH}`, {
    method,
    body: method === "POST" ? body : undefined,
    headers,
  });
}

describe("verifyWoztellSignature", () => {
  it("accepts a signature computed over the raw body", async () => {
    const body = JSON.stringify(inboundPayload());
    await expect(
      verifyWoztellSignature({ secret: SECRET, rawBody: body, signatureHeader: await sign(body) }),
    ).resolves.toBe(true);
  });

  it("accepts the sha256= prefixed form", async () => {
    const body = JSON.stringify(inboundPayload());
    await expect(
      verifyWoztellSignature({
        secret: SECRET,
        rawBody: body,
        signatureHeader: `sha256=${await sign(body)}`,
      }),
    ).resolves.toBe(true);
  });

  it("rejects a body that was altered after signing", async () => {
    const signature = await sign(JSON.stringify(inboundPayload()));
    await expect(
      verifyWoztellSignature({
        secret: SECRET,
        rawBody: JSON.stringify({ ...inboundPayload(), message: { id: "wamid.forged" } }),
        signatureHeader: signature,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const body = JSON.stringify(inboundPayload());
    await expect(
      verifyWoztellSignature({
        secret: SECRET,
        rawBody: body,
        signatureHeader: await sign(body, "not-the-secret"),
      }),
    ).resolves.toBe(false);
  });

  // An unset binding must fail closed. Treating "no secret" as "no check" is how
  // the unauthenticated version of this endpoint behaved.
  it("rejects when the secret is empty", async () => {
    const body = JSON.stringify(inboundPayload());
    await expect(
      verifyWoztellSignature({
        secret: "",
        rawBody: body,
        signatureHeader: await sign(body, "any-secret-at-all"),
      }),
    ).resolves.toBe(false);
  });

  it("rejects when no signature header was sent", async () => {
    await expect(
      verifyWoztellSignature({ secret: SECRET, rawBody: "{}", signatureHeader: null }),
    ).resolves.toBe(false);
  });

  // WOZTELL sends a 44-character Base64 digest. The previous implementation emitted
  // 64 characters of hex, so the constant-time compare failed on the length guard
  // and every genuine delivery was rejected 401.
  it("accepts the Base64 digest WOZTELL actually sends", async () => {
    const body = JSON.stringify(inboundPayload());
    const base64 = await sign(body);

    // 44 chars, not 64. This is the wire format the whole bug turned on.
    expect(base64).toHaveLength(44);
    await expect(
      verifyWoztellSignature({ secret: SECRET, rawBody: body, signatureHeader: base64 }),
    ).resolves.toBe(true);
  });

  it("rejects the hex digest the old implementation produced", async () => {
    const body = JSON.stringify(inboundPayload());
    const hex = await signHex(body);

    expect(hex).toHaveLength(64);
    await expect(
      verifyWoztellSignature({ secret: SECRET, rawBody: body, signatureHeader: hex }),
    ).resolves.toBe(false);
  });
});

describe("createWhatsAppWebhookHandler", () => {
  it("records an inbound message when the signature verifies", async () => {
    const repository = repositoryDouble();
    const body = JSON.stringify(inboundPayload());
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(response.status).toBe(200);
    expect(repository.recordInboundMessage).toHaveBeenCalledTimes(1);
    expect(repository.close).toHaveBeenCalledTimes(1);
  });

  // The regression this endpoint exists for: the old server fn took
  // `signatureValid` from the caller, so a forged body claiming to be valid was
  // persisted. Nothing the caller sends can assert its own validity now.
  it("refuses a forged body and never touches the database", async () => {
    const repository = repositoryDouble();
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(
      request(JSON.stringify({ ...inboundPayload(), signatureValid: true }), {
        "x-woztell-signature": "sha256=deadbeef",
      }),
    );

    expect(response.status).toBe(401);
    expect(repository.recordInboundMessage).not.toHaveBeenCalled();
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("refuses a delivery with no signature at all", async () => {
    const repository = repositoryDouble();
    const body = JSON.stringify(inboundPayload());
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, {}));

    expect(response.status).toBe(401);
    expect(repository.recordInboundMessage).not.toHaveBeenCalled();
  });

  it("rejects a non-POST delivery", async () => {
    const repository = repositoryDouble();
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request("", { "x-woztell-signature": await sign("") }, "GET"));

    expect(response.status).toBe(405);
  });

  it("rejects a signed body that is not JSON", async () => {
    const repository = repositoryDouble();
    const body = "not json";
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(response.status).toBe(400);
    expect(repository.recordInboundMessage).not.toHaveBeenCalled();
  });

  /**
   * An acknowledged delivery is never redelivered. processWhatsAppInboundWebhookWithRepository
   * reports ok:false for a malformed payload and for a database failure alike, so
   * acknowledging both would silently drop real messages on a transient error.
   */
  it("refuses to acknowledge a delivery the database could not store", async () => {
    const repository = repositoryDouble();
    repository.recordInboundMessage.mockRejectedValueOnce(new Error("deadlock detected"));
    const body = JSON.stringify(inboundPayload());

    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(response.status).toBe(503);
    expect(repository.close).toHaveBeenCalledTimes(1);
  });

  // The opposite case: resending this would fail identically, so it is acked.
  it("acknowledges a delivery whose payload it can never read", async () => {
    const repository = repositoryDouble();
    const body = JSON.stringify({ eventId: "evt-2", nothing: "useful" });

    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(response.status).toBe(200);
    expect(repository.recordWebhookEvent).toHaveBeenCalledTimes(1);
    expect(repository.recordInboundMessage).not.toHaveBeenCalled();
  });

  it("closes the repository and reports 503 when the whole write path throws", async () => {
    const repository = repositoryDouble();
    repository.recordInboundMessage.mockRejectedValueOnce(new Error("connection lost"));
    repository.recordWebhookEvent.mockRejectedValueOnce(new Error("connection lost"));
    const body = JSON.stringify(inboundPayload());

    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(response.status).toBe(503);
    expect(repository.close).toHaveBeenCalledTimes(1);
  });

  // Every documented payload must be acknowledged. A 503 means WOZTELL redelivers
  // forever; a throw means it is acked and lost.
  it("acknowledges every payload WOZTELL documents", async () => {
    for (const payload of WOZTELL_DOCUMENTED_PAYLOADS) {
      const repository = repositoryDouble();
      const body = JSON.stringify(payload);
      const response = await createWhatsAppWebhookHandler({
        webhookSecret: SECRET,
        createRepository: () => repository as never,
      })(request(body, { "x-woztell-signature": await sign(body) }));

      expect(response.status).toBe(200);
      expect(repository.recordWebhookEvent).toHaveBeenCalledTimes(1);
    }
  });

  it("stores a documented inbound text message", async () => {
    const repository = repositoryDouble();
    const body = JSON.stringify(WOZTELL_INBOUND_TEXT);
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(response.status).toBe(200);
    expect(repository.recordInboundMessage).toHaveBeenCalledTimes(1);
    expect(repository.recordInboundMessage.mock.calls[0][0]).toMatchObject({
      body: "Hello",
      fromWhatsAppId: "85260903521",
    });
  });

  // THE REGRESSION GUARD. normalizeWoztellInboundMessage happily turns a READ
  // receipt into a message with body "[read]", so without the classifier in the
  // request path every status webhook is stored as a fabricated customer message.
  it("never stores a status receipt as a customer message", async () => {
    for (const payload of [WOZTELL_STATUS_READ, WOZTELL_STATUS_DELIVERED]) {
      const repository = repositoryDouble();
      const body = JSON.stringify(payload);
      const response = await createWhatsAppWebhookHandler({
        webhookSecret: SECRET,
        createRepository: () => repository as never,
      })(request(body, { "x-woztell-signature": await sign(body) }));

      expect(response.status).toBe(200);
      expect(repository.recordInboundMessage).not.toHaveBeenCalled();
      expect(repository.recordMessageStatusEvent).toHaveBeenCalledTimes(1);
      expect(repository.recordMessageStatusEvent.mock.calls[0][0]).toMatchObject({
        providerMessageId: payload.data.messageId,
      });
    }
  });

  it("does not ingest a MEMBER_UPDATE as a customer message", async () => {
    const repository = repositoryDouble();
    const body = JSON.stringify(WOZTELL_MEMBER_UPDATE);
    await createWhatsAppWebhookHandler({
      webhookSecret: SECRET,
      createRepository: () => repository as never,
    })(request(body, { "x-woztell-signature": await sign(body) }));

    expect(repository.recordInboundMessage).not.toHaveBeenCalled();
    expect(repository.recordMessageStatusEvent).not.toHaveBeenCalled();
    expect(repository.recordWebhookEvent).toHaveBeenCalledTimes(1);
  });
});

describe("webhook header helpers", () => {
  it("reads the signature from any header WOZTELL may use", () => {
    expect(readWoztellSignatureHeader(new Headers({ "x-woztell-signature": "a" }))).toBe("a");
    expect(readWoztellSignatureHeader(new Headers({ "x-hub-signature-256": "b" }))).toBe("b");
    expect(readWoztellSignatureHeader(new Headers())).toBeNull();
  });

  it("prefers the event id header over the payload body", () => {
    expect(
      providerEventIdFrom(new Headers({ "x-woztell-event-id": "hdr" }), { eventId: "body" }),
    ).toBe("hdr");
    expect(providerEventIdFrom(new Headers(), { eventId: "body" })).toBe("body");
    expect(providerEventIdFrom(new Headers(), {})).toBeNull();
  });
});
