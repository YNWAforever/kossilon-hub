import type { ResendConfig } from "@/server/runtime-env";
import { notificationPayload, type NotificationTransport } from "./types";

export function createResendNotificationTransport(
  config: ResendConfig,
  fetchImpl: typeof fetch = fetch,
): NotificationTransport {
  return {
    async dispatch(notification) {
      if (notification.channel !== "email")
        throw new Error(`Unsupported notification channel: ${notification.channel}.`);
      if (!notification.recipient) throw new Error("Email notification is missing a recipient.");

      const payload = notificationPayload(notification);
      const body = typeof payload.body === "string" ? payload.body : undefined;
      if (!body) throw new Error("Email notification is missing a message body.");
      const subject =
        typeof payload.subject === "string" ? payload.subject : "Kossilon Hub notification";

      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `notification-outbox/${notification.idempotencyKey}`,
        },
        body: JSON.stringify({
          from: config.from,
          to: [notification.recipient],
          subject,
          text: body,
        }),
      });
      const responsePayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const message =
          typeof responsePayload.message === "string"
            ? responsePayload.message
            : `Resend rejected the send with HTTP ${response.status}.`;
        throw Object.assign(new Error(message), { code: `resend_${response.status}` });
      }

      // Resend's documented success shape is a top-level {"id": "..."} — unverified against
      // a live send from this codebase; if a real response differs, fix this parsing, not
      // the tests. See the Acceptance section of docs/superpowers/plans/2026-08-16-live-email-transport.md.
      const providerMessageId = responsePayload.id;
      if (typeof providerMessageId !== "string" || providerMessageId.length === 0) {
        throw new Error("Resend response is missing a provider message ID.");
      }
      return { providerMessageId };
    },
  };
}
