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
    const difference = conversationMessageOccurredAt(left).localeCompare(
      conversationMessageOccurredAt(right),
    );
    return difference !== 0 ? difference : left.id.localeCompare(right.id);
  });
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
