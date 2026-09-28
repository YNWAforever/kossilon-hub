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
      const suppressed = await repository.cancelFixtureOriginNotifications(now);
      const due = await repository.claimDeliveryAttempt(now, limit);
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
        let context: NotificationDispatchContext | undefined;
        try {
          context =
            notification.channel === "whatsapp" && options.lastInboundResolver
              ? {
                  whatsAppSendMode: await resolveWhatsAppSendMode(
                    notification,
                    now,
                    options.lastInboundResolver,
                  ),
                }
              : undefined;
        } catch (error) {
          // No external call has begun. A preflight error is safe to retry.
          const errorCode =
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : "dispatch_preflight_failed";
          try {
            const recorded = await repository.abortClaimedAttempt(
              notification.attemptId,
              notification.leaseToken,
              errorCode,
              now,
            );
            if (recorded === "stale") summary.superseded += 1;
            else if (notification.attemptCount >= notification.maxAttempts)
              summary.permanentlyFailed += 1;
            else summary.retried += 1;
          } catch (recordError) {
            console.error("notification preflight outcome not recorded", {
              id: notification.id,
              attemptId: notification.attemptId,
              errorCode,
              recordError,
            });
          }
          continue;
        }

        // This transaction commits before any provider call. A crash or timeout
        // after this point is unknown and must never enter automatic reclaim.
        let begun: "started" | "stale";
        try {
          begun = await repository.beginProviderCall(
            notification.attemptId,
            notification.leaseToken,
          );
        } catch (error) {
          console.error("notification begin boundary failed", {
            id: notification.id,
            attemptId: notification.attemptId,
            error,
          });
          continue;
        }
        if (begun === "stale") {
          summary.superseded += 1;
          continue;
        }

        let result: Awaited<ReturnType<NotificationTransport["dispatch"]>>;
        try {
          // Attempt credentials stay in the service, never in transport payloads.
          const { attemptId: _attemptId, leaseToken: _leaseToken, ...message } = notification;
          result = await transport.dispatch(message, context);
        } catch (error) {
          const errorCode =
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : "dispatch_outcome_unknown";
          // Only the provider's explicit unreachable-recipient response proves
          // non-acceptance. Network failures and ambiguous HTTP errors do not.
          const definitelyRejected =
            error instanceof Error &&
            "unreachableRecipient" in error &&
            error.unreachableRecipient === true &&
            errorCode === "woztell_err_100";
          try {
            const outcome = definitelyRejected
              ? { kind: "definitelyRejected" as const, code: errorCode }
              : {
                  kind: "unknown" as const,
                  errorCode,
                  attemptRef: notification.attemptId,
                };
            const recorded = await repository.recordProviderOutcome(
              notification.attemptId,
              notification.leaseToken,
              outcome,
              now,
            );
            if (recorded === "stale") summary.superseded += 1;
            else if (definitelyRejected) {
              if (notification.attemptCount >= notification.maxAttempts)
                summary.permanentlyFailed += 1;
              else summary.retried += 1;
            } else {
              summary.needsReconciliation = (summary.needsReconciliation ?? 0) + 1;
            }
          } catch (recordError) {
            console.error("notification provider failure outcome not recorded", {
              id: notification.id,
              attemptId: notification.attemptId,
              errorCode,
              recordError,
            });
            summary.needsReconciliation = (summary.needsReconciliation ?? 0) + 1;
          }
          continue;
        }

        try {
          const recorded = await repository.recordProviderOutcome(
            notification.attemptId,
            notification.leaseToken,
            result.delivery === "provider"
              ? { kind: "accepted", providerMessageId: result.providerMessageId }
              : { kind: "simulated" },
            now,
          );
          if (recorded === "stale") {
            summary.superseded += 1;
            continue;
          }
          summary.sent += 1;
        } catch (recordError) {
          // Provider acceptance is possible or known, so never mark for retry.
          // The send_started attempt is quarantined by the next stranded sweep.
          console.error("notification sent but not recorded", {
            id: notification.id,
            attemptId: notification.attemptId,
            message:
              recordError instanceof Error ? recordError.message : "Unknown recording failure.",
          });
          summary.sentButUnrecorded += 1;
          summary.needsReconciliation = (summary.needsReconciliation ?? 0) + 1;
          continue;
        }

        const whatsAppMessageId = notificationPayload(notification).whatsappMessageId;
        if (
          result.delivery === "provider" &&
          notification.channel === "whatsapp" &&
          typeof whatsAppMessageId === "string" &&
          options.whatsAppRepository
        ) {
          try {
            const sendMode = context?.whatsAppSendMode;
            await options.whatsAppRepository.attachProviderMessageId({
              messageId: whatsAppMessageId,
              providerMessageId: result.providerMessageId,
              ...(sendMode
                ? {
                    sentAs: sendMode.kind,
                    sentTemplateName: sendMode.kind === "template" ? sendMode.elementName : null,
                  }
                : {}),
            });
          } catch (linkError) {
            console.error("whatsapp provider id could not be linked", linkError);
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
