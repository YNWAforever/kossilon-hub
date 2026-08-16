import type {
  NormalizedInboundWhatsAppMessage,
  NormalizedWoztellStatusEvent,
  WhatsAppProviderConfig,
  WoztellStatusType,
  WoztellWebhookEvent,
} from "./types";

export type WoztellOutboundMessage = {
  toPhone: string;
  toWhatsAppId?: string | null;
  body: string;
  templateName?: string;
  languageCode?: string;
};

export async function sendWoztellMessage(
  config: WhatsAppProviderConfig,
  input: WoztellOutboundMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<{ providerMessageId: string }> {
  const response = await fetchImpl(`${config.apiBaseUrl.replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channelId: config.channelId,
      to: input.toPhone,
      whatsappId: input.toWhatsAppId ?? undefined,
      type: "text",
      text: input.body,
      templateName: input.templateName,
      languageCode: input.languageCode,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(
      typeof payload.error === "string"
        ? payload.error
        : `WOZTELL request failed with ${response.status}.`,
    );
    Object.assign(error, { code: `woztell_${response.status}` });
    throw error;
  }
  const data =
    typeof payload.data === "object" && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const providerMessageId = [payload.messageId, payload.id, data?.messageId].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!providerMessageId) throw new Error("WOZTELL response is missing a provider message ID.");
  return { providerMessageId };
}

/**
 * WOZTELL signs each webhook delivery with an HMAC-SHA256 of the raw request
 * body, keyed on `WOZTELL_WEBHOOK_SECRET`. The header is accepted either bare or
 * with the `sha256=` prefix that most providers emit.
 *
 * The body must be the *raw* bytes as received. Re-serialising the parsed JSON
 * changes key order and whitespace, which changes the digest, so callers have to
 * read the text once and hand the same string to both this and the parser.
 */
export async function verifyWoztellSignature(input: {
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
}): Promise<boolean> {
  const provided = input.signatureHeader?.trim().replace(/^sha256=/i, "");

  // A missing secret must never mean "everything is valid".
  if (!input.secret || !provided) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input.rawBody));

  // Base64, not hex: "Confirm that the Base64-encoded digest matches the signature
  // in the X-Woztell-Signature request header." Base64 is case-significant, so the
  // header is compared as sent — lowercasing it would reject every valid signature.
  return timingSafeEqual(base64FromBytes(new Uint8Array(digest)), provided);
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

/** Compares without leaking the position of the first difference through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

type JsonRecord = Record<string, unknown>;
type Path = readonly string[];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAtPath(source: JsonRecord, path: Path): unknown {
  let current: unknown = source;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function firstString(source: JsonRecord, paths: readonly Path[]): string | null {
  for (const path of paths) {
    const value = valueAtPath(source, path);

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function firstTimestamp(source: JsonRecord, paths: readonly Path[]): string {
  for (const path of paths) {
    const value = valueAtPath(source, path);

    // WOZTELL sends epoch seconds as a string on inbound ("1599536864") and epoch
    // milliseconds as a number on status events (1701914905000). `new Date` parses
    // a bare numeric string as a date *string*, which is Invalid Date, so numeric
    // strings are converted before parsing — otherwise every inbound message
    // silently gets stamped "now".
    const epoch =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value.trim())
          ? Number(value.trim())
          : null;
    const parsed =
      epoch !== null
        ? new Date(epoch < 10_000_000_000 ? epoch * 1000 : epoch)
        : typeof value === "string"
          ? new Date(value)
          : null;

    if (parsed && !Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function normalizePhone(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");

  return digits.length > 0 ? `${prefix}${digits}` : null;
}

const WOZTELL_STATUS_TYPES: Readonly<Record<string, WoztellStatusType>> = {
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
};

/**
 * Fans a delivery into the three things it can be.
 *
 * `eventType` is absent on inbound TEXT and MISC — WOZTELL only sets it on status
 * updates and on the non-message events — so absent means INBOUND. Reading it the
 * other way round classifies every real customer message as ignorable.
 *
 * API_OUTBOUND and NODE_TRIGGER nest their message under `messageEvent` and
 * describe messages this firm sent, not received; they are recorded and acked but
 * not ingested. An unrecognised eventType takes the same path deliberately: an
 * unknown event must never throw, because a throw is acked and lost.
 */
export function classifyWoztellWebhookEvent(payload: unknown): WoztellWebhookEvent {
  if (!isRecord(payload)) {
    throw new Error("WOZTELL payload must be a JSON object.");
  }

  const eventType = firstString(payload, [["eventType"]]) ?? "INBOUND";

  if (eventType !== "INBOUND") {
    return {
      kind: "ignored",
      eventType,
      reason: `WOZTELL ${eventType} events are recorded but not ingested as inbound messages.`,
    };
  }

  const type = firstString(payload, [["type"]]);
  const status = type ? WOZTELL_STATUS_TYPES[type.toUpperCase()] : undefined;

  if (status) {
    return { kind: "status", status: normalizeWoztellStatusEvent(payload, status) };
  }

  return { kind: "message", message: normalizeWoztellInboundMessage(payload) };
}

/** Internal: `JsonRecord` is module-private, so this is not part of the public API. */
function normalizeWoztellStatusEvent(
  payload: JsonRecord,
  status: WoztellStatusType,
): NormalizedWoztellStatusEvent {
  const providerMessageId = firstString(payload, [["data", "messageId"], ["messageId"]]);

  if (!providerMessageId) {
    throw new Error("WOZTELL status event is missing a message id.");
  }

  return {
    provider: "woztell",
    providerMessageId,
    status,
    occurredAt: firstTimestamp(payload, [["timestamp"]]),
  };
}

export function normalizeWoztellInboundMessage(payload: unknown): NormalizedInboundWhatsAppMessage {
  if (!isRecord(payload)) {
    throw new Error("WOZTELL payload must be a JSON object.");
  }

  // WOZTELL's documented shape: {from, to, timestamp, type, data, member, channel, app}.
  // `channel` is a string, not an object. The previous version walked Meta Cloud API
  // paths (contact.wa_id, message.text.body, channel.id) that WOZTELL never sends.
  const fromWhatsAppId = firstString(payload, [["from"]]);

  if (!fromWhatsAppId) {
    throw new Error("WOZTELL payload is missing sender identity.");
  }

  const messageType = (firstString(payload, [["type"]]) ?? "TEXT").toLowerCase();
  const receivedAt = firstTimestamp(payload, [["timestamp"]]);
  const channelId = firstString(payload, [["channel"]]);

  return {
    provider: "woztell",
    providerMessageId:
      firstString(payload, [["messageId"], ["data", "messageId"]]) ??
      derivedInboundMessageId(payload, { channelId, fromWhatsAppId, receivedAt }),
    channelId,
    fromWhatsAppId,
    fromPhone: normalizePhone(fromWhatsAppId),
    // WOZTELL's channel webhook carries no profile name. The inbox shows the phone
    // number until a name arrives from the Open API (roadmap P3-3); inventing one
    // from memberExtraData would be a guess about a customer-configured field.
    contactName: null,
    messageType,
    body: inboundBody(payload, messageType),
    receivedAt,
    rawPayload: payload,
  };
}

/**
 * A media message has no text but is still a real client message. The previous
 * code threw for any payload without a body, which the webhook classified as
 * "unreadable" and acknowledged 200 — the message was gone. A descriptive
 * placeholder satisfies `body text not null` and the full payload stays in
 * `rawPayload`.
 */
function inboundBody(payload: JsonRecord, messageType: string): string {
  const text = firstString(payload, [["data", "text"]]);
  if (text) return text;

  const attachments = valueAtPath(payload, ["data", "attachments"]);
  if (Array.isArray(attachments)) {
    const kinds = attachments
      .map((attachment) => (isRecord(attachment) ? firstString(attachment, [["type"]]) : null))
      .filter((kind): kind is string => typeof kind === "string");

    if (kinds.length > 0) return `[${kinds.join(", ").toLowerCase()}]`;
  }

  return `[${messageType}]`;
}

/**
 * WOZTELL's documented inbound TEXT and MISC payloads carry no message id at all,
 * so idempotency has nothing to key on. The id is derived from the fields that
 * identify the event plus a hash of its data, which makes a redelivery of the
 * identical body produce the identical id while two different messages do not
 * collide.
 *
 * Deliberately synchronous and non-cryptographic. This is a dedupe key, not a
 * signature, and keeping it sync keeps `normalizeWoztellInboundMessage` pure so
 * `webhook.ts` can run it twice to pre-classify a failure at no cost.
 */
function derivedInboundMessageId(
  payload: JsonRecord,
  parts: { channelId: string | null; fromWhatsAppId: string; receivedAt: string },
): string {
  const seed = [
    parts.channelId ?? "unknown-channel",
    firstString(payload, [["member"]]) ?? "unknown-member",
    parts.fromWhatsAppId,
    parts.receivedAt,
    JSON.stringify(payload.data ?? null),
  ].join("\u0000");

  return `woztell-derived:${fnv1a64(seed)}`;
}

/** FNV-1a across two 32-bit lanes, because JS bitwise operators are 32-bit. */
export function fnv1a64(value: string): string {
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ ((code + index) & 0xff), 0x01000193) >>> 0;
  }

  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}
