import type { NormalizedInboundWhatsAppMessage, WhatsAppProviderConfig } from "./types";

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
    const parsed =
      typeof value === "number"
        ? new Date(value < 10_000_000_000 ? value * 1000 : value)
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

export function normalizeWoztellInboundMessage(payload: unknown): NormalizedInboundWhatsAppMessage {
  if (!isRecord(payload)) {
    throw new Error("WOZTELL payload must be a JSON object.");
  }

  const providerMessageId = firstString(payload, [
    ["message", "id"],
    ["messageId"],
    ["providerMessageId"],
    ["id"],
    ["data", "message", "id"],
  ]);

  if (!providerMessageId) {
    throw new Error("WOZTELL payload is missing provider message id.");
  }

  const fromWhatsAppId = firstString(payload, [
    ["contact", "wa_id"],
    ["contact", "whatsappId"],
    ["sender", "wa_id"],
    ["sender", "id"],
    ["from"],
    ["source", "userId"],
    ["data", "from"],
  ]);
  const fromPhone = normalizePhone(
    firstString(payload, [["contact", "phone"], ["sender", "phone"], ["fromPhone"], ["phone"]]) ??
      fromWhatsAppId,
  );

  if (!fromWhatsAppId && !fromPhone) {
    throw new Error("WOZTELL payload is missing sender identity.");
  }

  const body = firstString(payload, [
    ["message", "text", "body"],
    ["message", "text"],
    ["message", "body"],
    ["text", "body"],
    ["text"],
    ["body"],
    ["data", "message", "text", "body"],
  ]);

  if (!body) {
    throw new Error("WOZTELL payload is missing message body.");
  }

  return {
    provider: "woztell",
    providerMessageId,
    channelId: firstString(payload, [
      ["channel", "id"],
      ["channelId"],
      ["recipient", "id"],
      ["botId"],
    ]),
    fromWhatsAppId: fromWhatsAppId ?? fromPhone!,
    fromPhone,
    contactName: firstString(payload, [
      ["contact", "profile", "name"],
      ["contact", "name"],
      ["profile", "name"],
      ["sender", "name"],
    ]),
    messageType: firstString(payload, [["message", "type"], ["type"]]) ?? "text",
    body,
    receivedAt: firstTimestamp(payload, [
      ["message", "timestamp"],
      ["timestamp"],
      ["createdAt"],
      ["date"],
    ]),
    rawPayload: payload,
  };
}
