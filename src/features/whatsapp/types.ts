export type WhatsAppProvider = "woztell";

export type WhatsAppWebhookConfig = {
  provider: WhatsAppProvider;
  webhookSecret: string;
};

export type WhatsAppProviderConfig = WhatsAppWebhookConfig & {
  apiBaseUrl: string;
  accessToken: string;
  channelId: string;
};

export type WhatsAppMessageDirection = "inbound" | "outbound";

export type WhatsAppMessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/**
 * A file the client attached, by reference.
 *
 * `providerMediaId` is WOZTELL's own handle and the only thing a download could
 * ever be issued against. There is no documented download endpoint --
 * BLOCKED_INTEGRATION: whatsapp-media-download -- so this identifies the file
 * without being able to fetch it.
 */
export type InboundAttachment = {
  providerMediaId: string;
  /** WOZTELL's vocabulary, as sent. Documented payloads use uppercase. */
  mediaType: string;
  /** Order within the message, so "the third one" stays the third one. */
  position: number;
};

export type NormalizedInboundWhatsAppMessage = {
  provider: "woztell";
  providerMessageId: string;
  channelId: string | null;
  fromWhatsAppId: string;
  fromPhone: string | null;
  contactName: string | null;
  messageType: string;
  body: string;
  /** Empty for a text-only message. Never inferred from the body string. */
  attachments: InboundAttachment[];
  receivedAt: string;
  rawPayload: unknown;
};

export type WoztellStatusType = "sent" | "delivered" | "read";

export type NormalizedWoztellStatusEvent = {
  provider: "woztell";
  providerMessageId: string;
  status: WoztellStatusType;
  occurredAt: string;
};

/**
 * What a delivery turned out to be. Classifying before any write is what lets the
 * webhook distinguish "cannot read this, ack it" from "database failed, do not ack".
 */
export type WoztellWebhookEvent =
  | { kind: "message"; message: NormalizedInboundWhatsAppMessage }
  | { kind: "status"; status: NormalizedWoztellStatusEvent }
  | { kind: "ignored"; eventType: string; reason: string };
