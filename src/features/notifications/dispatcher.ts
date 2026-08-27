import { fallbackTemplateFor } from "@/features/whatsapp/fallback-templates";
import { toPhoneDigits } from "@/features/whatsapp/phone";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import { isWithinSessionWindow } from "@/features/whatsapp/session-window";
import {
  sendWoztellMessage,
  type WoztellSendMode,
  type WoztellTemplateComponent,
} from "@/features/whatsapp/woztell";
import type { WhatsAppProviderConfig } from "@/features/whatsapp/types";
import type { ProviderMode } from "@/server/provider-mode";
import type { ResendConfig } from "@/server/runtime-env";
import { createLocalNotificationTransport } from "./local-transport";
import { createResendNotificationTransport } from "./resend-transport";
import { createSimulatedNotificationTransport } from "./simulated-transport";
import {
  notificationPayload,
  type DispatchSummary,
  type LastInboundResolver,
  type NotificationDispatchContext,
  type NotificationDispatcher,
  type NotificationOutboxRecord,
  type NotificationOutboxRepository,
  type NotificationTransport,
} from "./types";

export type NotificationDispatcherOptions = {
  whatsAppRepository?: Pick<WhatsAppRepository, "attachProviderMessageId">;
  /**
   * Supplied only in live provider mode (see runtime-dispatch.ts). Its absence
   * means "do not resolve", which keeps local and simulated dispatch byte-identical
   * to their previous behaviour.
   */
  lastInboundResolver?: LastInboundResolver;
};

/**
 * Chooses TEXT or TEMPLATE on WhatsApp's actual rule. Runs here rather than in the
 * transport because this is the layer that owns the clock: dispatchDue's `now` is
 * the cron's intended tick, and a transport calling new Date() would introduce a
 * second clock inside one dispatch run.
 */
async function resolveWhatsAppSendMode(
  notification: NotificationOutboxRecord,
  now: string,
  lastInboundResolver: LastInboundResolver,
): Promise<WoztellSendMode> {
  const payload = notificationPayload(notification);
  const body = typeof payload.body === "string" ? payload.body : undefined;
  if (!body) throw new Error("WhatsApp notification is missing a message body.");

  const phoneDigits = toPhoneDigits(notification.recipient);
  const lastInboundAt = phoneDigits ? await lastInboundResolver(phoneDigits) : null;

  // Inside the window the composed body is sent even when the caller supplied a
  // template name — the TEMPLATE branch drops the body on the wire, which is how an
  // actively-engaged client used to lose their case-specific reminder.
  if (isWithinSessionWindow(lastInboundAt, now)) {
    return { kind: "text", body };
  }

  const components = Array.isArray(payload.templateComponents)
    ? (payload.templateComponents as WoztellTemplateComponent[])
    : [];

  const templateName = typeof payload.templateName === "string" ? payload.templateName : undefined;
  if (templateName) {
    return {
      kind: "template",
      elementName: templateName,
      languageCode: typeof payload.languageCode === "string" ? payload.languageCode : "en",
      components,
    };
  }

  const fallback = fallbackTemplateFor(notification.notificationType);
  if (!fallback) {
    throw Object.assign(
      new Error(
        `WhatsApp notification ${notification.notificationType} is outside the 24-hour session window and has no template to fall back to.`,
      ),
      { code: "whatsapp_no_fallback_template" },
    );
  }

  return {
    kind: "template",
    elementName: fallback.templateName,
    languageCode: fallback.languageCode,
    components: [],
  };
}

export function createNotificationDispatcher(
  repository: NotificationOutboxRepository,
  transport: NotificationTransport,
  options: NotificationDispatcherOptions = {},
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
          const context: NotificationDispatchContext | undefined =
            notification.channel === "whatsapp" && options.lastInboundResolver
              ? {
                  whatsAppSendMode: await resolveWhatsAppSendMode(
                    notification,
                    now,
                    options.lastInboundResolver,
                  ),
                }
              : undefined;
          const result = await transport.dispatch(notification, context);
          const applied = await repository.markSent(
            notification.id,
            result.delivery === "provider" ? result.providerMessageId : null,
            now,
            notification.attemptCount,
          );
          if (applied) summary.sent += 1;
          else summary.superseded += 1;

          // Receipt linkback — live sends only. A simulated dispatch has no
          // provider id to link, and writing one flips whatsapp_messages to
          // 'sent' with a fabricated provider_message_id on a row that asserts
          // provider = 'woztell'. The row stays 'queued', which is what happened.
          const whatsAppMessageId = notificationPayload(notification).whatsappMessageId;
          if (
            result.delivery === "provider" &&
            notification.channel === "whatsapp" &&
            typeof whatsAppMessageId === "string" &&
            options.whatsAppRepository
          ) {
            try {
              await options.whatsAppRepository.attachProviderMessageId({
                messageId: whatsAppMessageId,
                providerMessageId: result.providerMessageId,
              });
            } catch (linkError) {
              // The message was sent. Letting this reach the outer catch would
              // mark the row for retry and send the client a second copy — a
              // missing receipt link is strictly the lesser failure.
              console.error("whatsapp provider id could not be linked", linkError);
            }
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Notification dispatch failed.";
          const errorCode =
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : "dispatch_failed";
          // The only screen that reads notification_outbox filters on
          // idempotency_key like 'follow-up:%', so sweep failures are otherwise
          // invisible — and redactExpired nulls last_error_code/message at
          // retention, putting the evidence on a 90-day fuse. A permanently
          // unapproved fallback template would surface only as an aggregate count.
          console.error("notification dispatch failed", {
            id: notification.id,
            notificationType: notification.notificationType,
            channel: notification.channel,
            errorCode,
          });
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
    async dispatch(notification, context) {
      if (notification.channel !== "whatsapp")
        throw new Error(`Unsupported notification channel: ${notification.channel}.`);
      if (!notification.recipient) throw new Error("WhatsApp notification is missing a recipient.");

      // Resolved by dispatchDue, which owns the clock. Its absence means the
      // dispatcher was mis-wired — fail loudly rather than silently reverting to
      // un-windowed sends.
      const mode = context?.whatsAppSendMode;
      if (!mode) {
        throw Object.assign(
          new Error("WhatsApp dispatch is missing a resolved session-window send mode."),
          { code: "whatsapp_send_mode_missing" },
        );
      }

      const { providerMessageId } = await sendWoztellMessage(
        config,
        { toPhone: notification.recipient, mode },
        fetchImpl,
      );
      return { delivery: "provider", providerMessageId };
    },
  };
}

export function createNotificationTransport(input: {
  providerMode: ProviderMode;
  config?: WhatsAppProviderConfig;
  resendConfig?: ResendConfig | null;
  fetchImpl?: typeof fetch;
}): NotificationTransport {
  if (input.providerMode === "local") return createLocalNotificationTransport();
  if (input.providerMode === "simulated") return createSimulatedNotificationTransport();
  if (!input.config) {
    throw new Error("Live notification transport requires a WhatsApp provider configuration.");
  }

  const whatsappTransport = createWoztellNotificationTransport(input.config, input.fetchImpl);
  const emailTransport = input.resendConfig
    ? createResendNotificationTransport(input.resendConfig, input.fetchImpl)
    : null;

  return {
    async dispatch(notification, context) {
      if (notification.channel === "whatsapp")
        return whatsappTransport.dispatch(notification, context);
      if (notification.channel === "email") {
        if (!emailTransport) {
          throw Object.assign(new Error("Email notifications are not configured for this firm."), {
            code: "resend_not_configured",
          });
        }
        return emailTransport.dispatch(notification);
      }
      throw new Error(`Unsupported notification channel: ${notification.channel}.`);
    },
  };
}
