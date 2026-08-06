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
        superseded: 0,
      };
      for (const notification of due) {
        // Every terminal write is fenced on the attempt_count this claim saw. A
        // false return means another run reclaimed the row and finished it first,
        // so this outcome is not ours to count — previously both runs reported a
        // send and only one of them was recorded.
        try {
          const result = await transport.dispatch(notification);
          const applied = await repository.markSent(
            notification.id,
            result.providerMessageId,
            now,
            notification.attemptCount,
          );
          if (applied) summary.sent += 1;
          else summary.superseded += 1;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Notification dispatch failed.";
          const errorCode =
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : "dispatch_failed";
          const input = {
            errorCode,
            errorMessage,
            now,
            attemptCount: notification.attemptCount,
          };
          if (notification.attemptCount >= notification.maxAttempts) {
            if (await repository.markFailed(notification.id, input)) summary.permanentlyFailed += 1;
            else summary.superseded += 1;
          } else if (await repository.markRetry(notification.id, input)) {
            summary.retried += 1;
          } else {
            summary.superseded += 1;
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
