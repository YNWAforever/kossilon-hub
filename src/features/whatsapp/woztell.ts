import type {
  NormalizedInboundWhatsAppMessage,
  NormalizedWoztellStatusEvent,
  WhatsAppProviderConfig,
  WoztellStatusType,
  WoztellWebhookEvent,
  InboundAttachment,
} from "./types";

export type WoztellTemplateComponent = Record<string, unknown>;

export type WoztellSendMode =
  | { kind: "text"; body: string }
  | {
      kind: "template";
      elementName: string;
      languageCode: string;
      components: readonly WoztellTemplateComponent[];
    };

export type WoztellOutboundMessage = {
  toPhone: string;
  mode: WoztellSendMode;
};

/** err_code 100: the number is invalid or has no WhatsApp account. Retrying cannot fix it. */
const WOZTELL_UNREACHABLE_RECIPIENT_ERR_CODE = 100;

export async function sendWoztellMessage(
  config: WhatsAppProviderConfig,
  input: WoztellOutboundMessage,
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number } = {},
): Promise<{ providerMessageId: string }> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("Invalid WOZTELL send deadline.");
  const controller = new AbortController();
  const unknown = () =>
    Object.assign(
      new Error(
        "WOZTELL send outcome is unknown; reconcile with the provider before any new send.",
      ),
      { code: "dispatch_outcome_unknown", dispatchOutcomeUnknown: true },
    );
  let outcomeKnown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const perform = async () => {
    // BotAPI is POST {base}/sendResponses. The previous version appended /messages,
    // which no value of WOZTELL_API_BASE_URL could correct.
    const response = await fetchImpl(`${config.apiBaseUrl.replace(/\/+$/, "")}/sendResponses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channelId: config.channelId,
        recipientId: input.toPhone.replace(/\D/g, ""),
        response: [woztellResponseElement(input.mode)],
      }),
      signal: controller.signal,
      redirect: "error",
    });
    controller.signal.throwIfAborted();
    const payload = JSON.parse(
      new TextDecoder().decode(await boundedProviderBytes(response, controller.signal, 16 * 1024)),
    ) as Record<string, unknown>;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      (payload.ok !== 0 && payload.ok !== 1)
    )
      throw unknown();

    // BotAPI reports application errors as `{ok: 0}` and does so on a 2xx as well as
    // on a 5xx, so the HTTP status alone cannot be trusted. Branching only on
    // `!response.ok` read a rejected send as a success until the missing-id throw
    // fired with a misleading message and no err_code.
    if (payload.ok !== 1) {
      outcomeKnown = true;
      const errCode = typeof payload.err_code === "number" ? payload.err_code : null;
      const message =
        typeof payload.err === "string"
          ? payload.err
          : `WOZTELL rejected the send with HTTP ${response.status}.`;

      throw Object.assign(new Error(message), {
        code: errCode === null ? `woztell_${response.status}` : `woztell_err_${errCode}`,
        errCode,
        unreachableRecipient: errCode === WOZTELL_UNREACHABLE_RECIPIENT_ERR_CODE,
      });
    }

    const providerMessageId = providerMessageIdFromSendResult(payload);
    if (!providerMessageId) {
      // ok:1 means WOZTELL accepted the send; delivery still requires a receipt. The
      // id is missing. This used to be a bare Error, indistinguishable to the
      // dispatcher from a failed send, so it retried and delivered a second copy of
      // the same statutory reminder. BotAPI /sendResponses takes no client-side
      // idempotency key that could collapse the pair, so the distinction has to
      // travel on the error itself.
      throw Object.assign(new Error("WOZTELL accepted the send but returned no message ID."), {
        code: "woztell_accepted_without_message_id",
        providerAccepted: true,
      });
    }
    return { providerMessageId };
  };
  try {
    return await Promise.race([
      perform().catch((error) => {
        if (
          outcomeKnown ||
          (error instanceof Error && "providerAccepted" in error && error.providerAccepted === true)
        )
          throw error;
        throw unknown();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(unknown());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Bounds provider acknowledgement bytes, including streams without Content-Length. */
export async function boundedProviderBytes(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider response has no body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error("Provider response exceeds its byte limit.");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/**
 * The TEXT-vs-TEMPLATE choice is WhatsApp's 24-hour session window rule. It is
 * resolved by the caller and handed here already decided, so this function does not
 * infer it from whether a template name was supplied — that inference had nothing to
 * do with the actual rule. P2-3 Task 8 moves the resolution into dispatchDue, which
 * owns the clock and the contact lookup.
 */
function woztellResponseElement(mode: WoztellSendMode): Record<string, unknown> {
  if (mode.kind === "template") {
    return {
      type: "TEMPLATE",
      elementName: mode.elementName,
      languageCode: mode.languageCode,
      components: mode.components,
    };
  }

  return { type: "TEXT", text: mode.body };
}

/** Documented success is `{ok: 1, member, sendResult}` — the id is inside sendResult. */
function providerMessageIdFromSendResult(payload: Record<string, unknown>): string | null {
  const sendResult = isRecord(payload.sendResult) ? payload.sendResult : null;
  const results = sendResult && Array.isArray(sendResult.result) ? sendResult.result : [];

  for (const entry of results) {
    if (!isRecord(entry)) continue;

    const messageEvent = isRecord(entry.messageEvent) ? entry.messageEvent : null;
    if (typeof messageEvent?.messageId === "string" && messageEvent.messageId.length > 0) {
      return messageEvent.messageId;
    }

    const result = isRecord(entry.result) ? entry.result : null;
    const messages = result && Array.isArray(result.messages) ? result.messages : [];
    for (const message of messages) {
      if (isRecord(message) && typeof message.id === "string" && message.id.length > 0) {
        return message.id;
      }
    }
  }

  return null;
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
    attachments: inboundAttachments(payload),
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
  const attachments = inboundAttachments(payload);

  // A caption used to hide the file. `if (text) return text` returned before the
  // attachments branch was reached, so a client who wrote "here is my HKID" and
  // attached the photograph produced a message body identical to one with no
  // attachment at all -- and since nothing else recorded the media, the file
  // vanished without trace.
  //
  // The caption is still the body; the attachment is named alongside it, because
  // a staff member reading the thread has to be able to tell that something
  // arrived. (WOZTELL's documented payloads carry no caption-plus-attachment
  // example, so this branch is reasoning about a shape the docs do not show. The
  // parts that ARE documented -- text alone, attachments alone -- keep exactly
  // their previous behaviour.)
  const label =
    attachments.length > 0
      ? `[${attachments.map((attachment) => attachment.mediaType.toLowerCase()).join(", ")}]`
      : null;

  if (text && label) return `${text} ${label}`;
  if (text) return text;
  if (label) return label;

  return `[${messageType}]`;
}

/**
 * The media a message carried, as references rather than as a placeholder word.
 *
 * WOZTELL's documented shape is `data.attachments: [{ type, waMediaId }]`, copied
 * verbatim into woztell-fixtures.ts, which that file calls the contract. An entry
 * without both fields is skipped rather than guessed at: a media row whose
 * provider id we invented would be a handle that downloads nothing.
 */
export function inboundAttachments(payload: JsonRecord): InboundAttachment[] {
  const fileId = firstString(payload, [["data", "fileId"]]);
  const type = firstString(payload, [["type"]]);
  if (fileId && type)
    return [{ providerMediaId: fileId, providerMediaKind: "file", mediaType: type, position: 0 }];
  const attachments = valueAtPath(payload, ["data", "attachments"]);
  if (!Array.isArray(attachments)) return [];

  const parsed: InboundAttachment[] = [];
  attachments.forEach((attachment, index) => {
    if (!isRecord(attachment)) return;
    const mediaType = firstString(attachment, [["type"]]);
    const providerMediaId = firstString(attachment, [["waMediaId"]]);
    if (!mediaType || !providerMediaId) return;
    parsed.push({ providerMediaId, mediaType, position: index });
  });

  return parsed;
}

/**
 * WOZTELL's documented inbound TEXT and MISC payloads carry no message id at all,
 * so idempotency has nothing to key on. The id is derived from the fields that
 * identify the event plus a hash of its data, which makes a redelivery of the
 * identical body produce the identical id.
 *
 * KNOWN LIMITATION, accepted deliberately: the seed's finest time resolution is
 * WOZTELL's `timestamp`, which for inbound is whole seconds. Two *distinct*
 * messages from the same member with byte-identical `data` inside the same second
 * therefore derive the same id, and `recordInboundMessage`'s
 * `on conflict do nothing` drops the second as if it were a redelivery — silently,
 * with no timeline event. There is nothing in WOZTELL's inbound payload to
 * separate them: it carries no message id and no sub-second component. Revisit if
 * WOZTELL ever exposes either.
 *
 * Deliberately synchronous and non-cryptographic. This is a dedupe key, not a
 * signature, and keeping it sync keeps `normalizeWoztellInboundMessage` pure so
 * `webhook.ts` can run it twice to pre-classify a failure at no cost.
 *
 * The `data` hash uses JSON.stringify, which is key-order dependent. A redelivery
 * that re-serialised the object with different key order would derive a different
 * id and be stored twice. WOZTELL replays the stored raw body, so this has not
 * been observed — but it is an assumption, not a guarantee, and the duplicate is
 * the failure mode if it is ever wrong.
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
