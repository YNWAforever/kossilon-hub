import { sendWoztellMessage } from "@/features/whatsapp/woztell";
import type { WhatsAppProviderConfig } from "@/features/whatsapp/types";
import type { ProviderMode } from "@/server/provider-mode";
import { createLocalNotificationTransport } from "./local-transport";
import { createSimulatedNotificationTransport } from "./simulated-transport";
import type {
  DispatchSummary,
  NotificationDispatcher,
  NotificationOutboxRecord,
  NotificationOutboxRepository,
  NotificationTransport,
} from "./types";

export function createNotificationDispatcher(
  repository: NotificationOutboxRepository,
  transport: NotificationTransport,
): NotificationDispatcher {
  return {
    async dispatchDue(now, limit = 50): Promise<DispatchSummary> {
      const due = await repository.claimDue(now, limit);
      const summary: DispatchSummary = {
        claimed: due.length,
        sent: 0,
        retried: 0,
        permanentlyFailed: 0,
      };
      for (const notification of due) {
        try {
          const result = await transport.dispatch(notification);
          await repository.markSent(notification.id, result.providerMessageId, now);
          summary.sent += 1;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Notification dispatch failed.";
          const errorCode =
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : "dispatch_failed";
          if (notification.attemptCount >= notification.maxAttempts) {
            await repository.markFailed(notification.id, { errorCode, errorMessage, now });
            summary.permanentlyFailed += 1;
          } else {
            await repository.markRetry(notification.id, { errorCode, errorMessage, now });
            summary.retried += 1;
          }
        }
      }
      return summary;
    },
  };
}

export function createWoztellNotificationTransport(
  config: WhatsAppProviderConfig,
  fetchImpl: typeof fetch = fetch,
): NotificationTransport {
  return {
    async dispatch(notification) {
      if (notification.channel !== "whatsapp")
        throw new Error(`Unsupported notification channel: ${notification.channel}.`);
      if (!notification.recipient) throw new Error("WhatsApp notification is missing a recipient.");
      const payload = notificationPayload(notification);
      const body = typeof payload.body === "string" ? payload.body : undefined;
      if (!body) throw new Error("WhatsApp notification is missing a message body.");
      return sendWoztellMessage(
        config,
        {
          toPhone: notification.recipient,
          toWhatsAppId: typeof payload.toWhatsAppId === "string" ? payload.toWhatsAppId : null,
          body,
          templateName: typeof payload.templateName === "string" ? payload.templateName : undefined,
          languageCode: typeof payload.languageCode === "string" ? payload.languageCode : undefined,
        },
        fetchImpl,
      );
    },
  };
}

export function createNotificationTransport(input: {
  providerMode: ProviderMode;
  config?: WhatsAppProviderConfig;
  fetchImpl?: typeof fetch;
}): NotificationTransport {
  if (input.providerMode === "local") return createLocalNotificationTransport();
  if (input.providerMode === "simulated") return createSimulatedNotificationTransport();
  if (!input.config) {
    throw new Error("Live notification transport requires a WhatsApp provider configuration.");
  }
  return createWoztellNotificationTransport(input.config, input.fetchImpl);
}

export function notificationPayload(
  notification: NotificationOutboxRecord,
): Record<string, unknown> {
  if (
    !notification.payload ||
    typeof notification.payload !== "object" ||
    Array.isArray(notification.payload)
  ) {
    return {};
  }
  return notification.payload as Record<string, unknown>;
}
