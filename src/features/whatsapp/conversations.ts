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
    // Plain relational comparison, not localeCompare: ICU collation gives
    // punctuation variable weight, and the repository returns Postgres
    // `timestamptz::text` ("2026-07-30 02:00:00+00"), where two rows in the same
    // second differ only by a "." versus a "+".
    const leftAt = conversationMessageOccurredAt(left);
    const rightAt = conversationMessageOccurredAt(right);
    if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
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
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return value;

  return hongKongTimestampFormat.format(parsed).replace(",", "");
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
