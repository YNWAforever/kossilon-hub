import type { NormalizedInboundWhatsAppMessage } from "./types";

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
