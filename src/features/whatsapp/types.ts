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
  "received" | "queued" | "sent" | "delivered" | "read" | "failed";

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
