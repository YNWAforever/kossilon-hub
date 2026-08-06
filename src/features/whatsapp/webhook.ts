import type { WhatsAppRepository } from "./repository";
import {
  processWhatsAppInboundWebhookWithRepository,
  type ProcessWhatsAppInboundWebhookRepository,
} from "./server-fns";
import { normalizeWoztellInboundMessage, verifyWoztellSignature } from "./woztell";

/**
 * Inbound WhatsApp ingestion.
 *
 * This is deliberately an HTTP route rather than a server function. The caller is
 * WOZTELL, not a signed-in staff member, so there is no actor to derive and no
 * session cookie to check — the request authenticates itself with an HMAC over
 * the raw body. A server function is the wrong shape for that: it sits behind the
 * CSRF middleware (which an API client cannot satisfy) and, more importantly, the
 * previous version simply took `signatureValid` as a boolean from the caller.
 *
 * Replay safety comes from the repository: `recordInboundMessage` is idempotent on
 * `provider_message_id` and `recordWebhookEvent` upserts on
 * `(provider, provider_event_id)`, so a redelivery is recorded once.
 */
export const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";

const SIGNATURE_HEADERS = [
  "x-woztell-signature",
  "x-hub-signature-256",
  "x-signature-256",
] as const;

export function readWoztellSignatureHeader(headers: Headers): string | null {
  for (const header of SIGNATURE_HEADERS) {
    const value = headers.get(header);
    if (value && value.trim().length > 0) return value;
  }

  return null;
}

export function providerEventIdFrom(headers: Headers, payload: unknown): string | null {
  const header = headers.get("x-woztell-event-id")?.trim();
  if (header) return header;

  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const candidate = (payload as Record<string, unknown>).eventId;
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }

  return null;
}

export type WhatsAppWebhookHandlerConfig = {
  webhookSecret: string;
  createRepository: () => WhatsAppRepository;
};

export function createWhatsAppWebhookHandler(config: WhatsAppWebhookHandlerConfig) {
  return async function handleWhatsAppWebhook(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    const rawBody = await request.text();
    const signatureValid = await verifyWoztellSignature({
      secret: config.webhookSecret,
      rawBody,
      signatureHeader: readWoztellSignatureHeader(request.headers),
    });

    // An unverified delivery is refused before it reaches the database. It is not
    // recorded either: an attacker who can write rows by failing the signature check
    // still gets to fill the table. It IS logged, because the other way to land here
    // is a misconfigured secret after a rotation, and that would otherwise be a
    // silent total loss of inbound messages.
    if (!signatureValid) {
      console.warn("whatsapp webhook rejected: signature did not verify", {
        hadSignatureHeader: readWoztellSignatureHeader(request.headers) !== null,
        bodyBytes: rawBody.length,
      });
      return json({ ok: false, error: "Webhook signature was not verified." }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "Webhook payload must be JSON." }, 400);
    }

    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ ok: false, error: "Webhook payload must be a JSON object." }, 400);
    }

    // Classifies the failure before it happens. processWhatsAppInboundWebhookWithRepository
    // catches everything and reports `ok: false` either way, so without this a
    // deadlock or a transient write error would be acknowledged exactly like a
    // malformed payload — and an acknowledged message is never redelivered.
    // normalizeWoztellInboundMessage is pure, so running it twice costs nothing.
    let payloadIsUnreadable = false;
    try {
      normalizeWoztellInboundMessage(payload);
    } catch {
      payloadIsUnreadable = true;
    }

    const repository = config.createRepository();
    try {
      const result = await processWhatsAppInboundWebhookWithRepository(
        repository as ProcessWhatsAppInboundWebhookRepository,
        {
          providerEventId: providerEventIdFrom(request.headers, payload),
          signatureValid: true,
          payload: payload as Record<string, unknown>,
        },
      );

      // A payload this firm cannot read is still a delivery WOZTELL made: record it
      // as failed and acknowledge, because resending it would fail identically.
      // A failure with a readable payload is the database's fault, so refuse to
      // acknowledge and let WOZTELL redeliver.
      if (!result.ok && !payloadIsUnreadable) {
        console.error("whatsapp webhook could not be persisted", result.errorMessage);
        return json(result, 503);
      }

      return json(result, 200);
    } catch (error) {
      // Never acknowledge what was not stored.
      console.error("whatsapp webhook failed", error);
      return json({ ok: false, error: "Webhook could not be processed." }, 503);
    } finally {
      await repository.close();
    }
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
