import type { WhatsAppMessageDirection, WhatsAppMessageStatus } from "./types";

/**
 * A production WhatsApp thread, assembled from `whatsapp_contacts` and
 * `whatsapp_messages`.
 *
 * Deliberately narrower than the demo `Enquiry`: `intent` and a conversation-level
 * `status` have no column behind them, so they are not modelled here rather than
 * being invented on the server. Per-message delivery status is real and is kept.
 *
 * Pure — imports only `./types`, so the production inbox can use it in the browser.
 */
export type WhatsAppConversationMessage = {
  id: string;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  body: string;
  caseId: string | null;
  createdAt: string;
  receivedAt: string | null;
  sentAt: string | null;
};

export type WhatsAppConversation = {
  contactId: string;
  displayName: string | null;
  phoneE164: string | null;
  companyId: string | null;
  companyName: string | null;
  caseId: string | null;
  lastMessageBody: string;
  lastMessageDirection: WhatsAppMessageDirection;
  lastMessageAt: string;
};

/**
 * When a message actually happened, from the three timestamps the table keeps.
 *
 * Order matters. Outbound rows carry `sent_at` once the provider accepts them but
 * are written by `queueOutboundTemplateMessage` with only `created_at`; inbound
 * rows never carry `sent_at` at all, because the table's check constraint requires
 * `received_at` instead.
 */
export function conversationMessageOccurredAt(
  message: Pick<WhatsAppConversationMessage, "createdAt" | "receivedAt" | "sentAt">,
): string {
  return message.sentAt ?? message.receivedAt ?? message.createdAt;
}

/**
 * Display order for a thread. The repository reads newest first so that a row
 * limit keeps the most recent slice of a long conversation; the transcript itself
 * still has to read top to bottom, so the ordering is re-established here.
 */
export function sortConversationMessagesOldestFirst<T extends WhatsAppConversationMessage>(
  messages: readonly T[],
): T[] {
  return [...messages].sort((left, right) => {
    // Compared as instants, not as text. Two rows can legitimately carry different
    // spellings of the same moment — `timestampString` yields an ISO string for a
    // Date but the raw column text for a string — and "2026-07-30 02:00:00+00"
    // sorts before "2026-07-30T02:00:00.000Z" on the separator alone.
    const leftAt = conversationMessageOccurredAt(left);
    const rightAt = conversationMessageOccurredAt(right);
    const leftMs = parseTimestamp(leftAt).getTime();
    const rightMs = parseTimestamp(rightAt).getTime();

    if (!Number.isNaN(leftMs) && !Number.isNaN(rightMs)) {
      if (leftMs !== rightMs) return leftMs - rightMs;
    } else if (leftAt !== rightAt) {
      // Neither is a usable instant; fall back to a stable textual order rather
      // than declaring them equal and letting sort order drift.
      return leftAt < rightAt ? -1 : 1;
    }

    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

/**
 * Row caps for the inbox reads, shared by the repository defaults and the screen
 * that requests them. They live here rather than in `repository.ts` because that
 * module pulls in the database client and cannot be imported from the browser.
 */
export const CONVERSATION_PAGE_SIZE = 100;
export const CONVERSATION_MESSAGE_PAGE_SIZE = 200;

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

/**
 * Parses the timestamp spellings this feature actually sees.
 *
 * Postgres renders `timestamptz::text` as "2026-07-30 02:00:00+00" — a space
 * separator and a two-digit offset, neither of which is ISO 8601. V8 accepts it
 * through its lenient fallback parser; JavaScriptCore does not, so on Safari a
 * plain `new Date(value)` yields Invalid Date for every row the repository
 * returns. Normalising first keeps the browsers in agreement.
 */
export function normalizeTimestampText(value: string): string {
  return value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
}

function parseTimestamp(value: string): Date {
  const normalized = new Date(normalizeTimestampText(value));

  return Number.isNaN(normalized.getTime()) ? new Date(value) : normalized;
}

const hongKongTimestampFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: HONG_KONG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // h23 rather than hour12:false — the latter renders midnight as "24:00" under
  // some ICU builds.
  hourCycle: "h23",
});

/**
 * Renders a timestamp in Hong Kong time. The firm, its clients and every filing
 * deadline are in HKT, so a UTC rendering is eight hours wrong on every row.
 * Unparseable input is passed through rather than replaced with a wrong date.
 */
export function formatHongKongTimestamp(value: string): string {
  const parsed = parseTimestamp(value);

  if (Number.isNaN(parsed.getTime())) return value;

  // Assembled from parts rather than string-surgeried out of format(): the
  // pattern a locale produces is an ICU implementation detail, so a runtime
  // without full en-CA data would silently emit US-order dates instead.
  const parts = new Map(
    hongKongTimestampFormat.formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = parts.get("hour");
  const minute = parts.get("minute");

  if (!year || !month || !day || !hour || !minute) return value;

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * What to call a contact. `whatsapp_contacts.display_name` is nullable — a contact
 * first seen as a phone number has no name until the provider supplies one — so
 * the inbox cannot assume a name the way the demo fixtures could.
 */
export function conversationContactLabel(
  conversation: Pick<WhatsAppConversation, "displayName" | "phoneE164">,
): string {
  return conversation.displayName ?? conversation.phoneE164 ?? "Unknown contact";
}
