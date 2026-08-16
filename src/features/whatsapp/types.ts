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

export type NormalizedInboundWhatsAppMessage = {
  provider: "woztell";
  providerMessageId: string;
  channelId: string | null;
  fromWhatsAppId: string;
  fromPhone: string | null;
  contactName: string | null;
  messageType: string;
  body: string;
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
