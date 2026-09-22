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
      // Before the claim, not after: a fixture-origin row must never become a
      // claimed row, because a claimed row is one transport failure away from
      // being retried at a real recipient.
      const suppressed = await repository.cancelFixtureOriginNotifications(now);
      const due = await repository.claimDue(now, limit);
      const summary: DispatchSummary = {
        claimed: due.length,
        sent: 0,
        retried: 0,
        permanentlyFailed: 0,
        superseded: 0,
        sentButUnrecorded: 0,
        suppressedFixtureOrigin: suppressed.cancelled,
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
          // Before the send, not after. Everything above can still fail without a
          // message having gone anywhere (a missing fallback template throws in
          // resolveWhatsAppSendMode), and those failures retry normally. From the
          // next line on, the outcome may be unknown rather than merely bad, and a
          // row whose outcome is unknown must never be claimed again: the attempt
          // fence only stops a double COUNT, and by then the client has two copies.
          await repository.markDispatchStarted(notification.id, {
            attemptCount: notification.attemptCount,
          });
          const result = await transport.dispatch(notification, context);

          // From here the provider has the message. Everything below is
          // record-keeping, and record-keeping must never reach the outer catch:
          // that would call markRetry on a message the client already has and
          // deliver a second copy. The linkback twelve lines down already had
          // this guard and said so; markSent, where the same hazard is worse,
          // did not.
          try {
            const applied = await repository.markSent(notification.id, {
              providerMessageId: result.delivery === "provider" ? result.providerMessageId : null,
              // Recorded positively rather than left to be inferred from a null
              // provider_message_id, which is also what a redacted row and a
              // never-dispatched row look like. The transport is the only layer that
              // knows, and the fact is already in hand right here.
              delivery: result.delivery,
              sentAt: now,
              attemptCount: notification.attemptCount,
            });
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
                // What actually went on the wire. `body` on that row is the
                // draft, and outside the 24-hour window the template branch
                // sends zero variables -- so for a template send the body is not
                // what the client received, and the inbox has to be able to say
                // so rather than presenting the draft as delivered.
                //
                // Spread rather than passed as undefined: local and simulated
                // dispatch have no send-mode context, and this call stays exactly
                // what it was for them.
                const sendMode = context?.whatsAppSendMode;
                await options.whatsAppRepository.attachProviderMessageId({
                  messageId: whatsAppMessageId,
                  providerMessageId: result.providerMessageId,
                  ...(sendMode
                    ? {
                        sentAs: sendMode.kind,
                        sentTemplateName:
                          sendMode.kind === "template" ? sendMode.elementName : null,
                      }
                    : {}),
                });
              } catch (linkError) {
                // The message was sent. Letting this reach the outer catch would
                // mark the row for retry and send the client a second copy — a
                // missing receipt link is strictly the lesser failure.
                console.error("whatsapp provider id could not be linked", linkError);
              }
            }
          } catch (recordError) {
            // The provider accepted it and we could not write that down. Not
            // retried, because the client already has the message; not counted as
            // sent, because nothing recorded it. The row stays 'processing' and
            // the visibility timeout will reclaim it, so this is logged loudly
            // enough to be acted on before that happens.
            console.error("notification sent but not recorded", {
              id: notification.id,
              companyId: notification.companyId,
              channel: notification.channel,
              notificationType: notification.notificationType,
              message:
                recordError instanceof Error ? recordError.message : "Unknown recording failure.",
            });
            summary.sentButUnrecorded += 1;
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

          // The provider took the message and the failure is downstream of that
          // — WOZTELL answering ok:1 with no message id is the case this exists
          // for. Retrying delivers a second copy of a statutory reminder, so this
          // is terminal however many attempts remain. Counted as sentButUnrecorded
          // because that is exactly what it is: sent, and not written down.
          if (
            error instanceof Error &&
            "providerAccepted" in error &&
            error.providerAccepted === true
          ) {
            console.error("notification accepted by the provider but not recorded", {
              id: notification.id,
              companyId: notification.companyId,
              notificationType: notification.notificationType,
              errorCode,
            });
            // spendAttempts, because markFailed writes next_attempt_at = now and
            // claimDue takes a 'failed' row whose attempts are not exhausted. Left
            // off, "terminal however many attempts remain" would be a comment and
            // nothing else: the next tick re-claims the row and the client gets the
            // second copy this whole branch exists to prevent.
            if (await repository.markFailed(notification.id, { ...input, spendAttempts: true }))
              summary.sentButUnrecorded += 1;
            else summary.superseded += 1;
            continue;
          }

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
