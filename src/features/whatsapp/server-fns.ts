import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS } from "./config";
import {
  createWhatsAppRepository,
  type WhatsAppRepository,
  type WhatsAppTemplateCategory,
} from "./repository";
import { normalizeWoztellInboundMessage } from "./woztell";

type Env = Record<string, string | undefined>;

const templateCategories = [
  "annual_return",
  "payment",
  "document",
  "signature",
  "general",
] as const satisfies readonly WhatsAppTemplateCategory[];

const jsonObjectSchema = z
  .record(z.unknown())
  .refine((value) => value !== null && !Array.isArray(value), {
    message: "payload must be a JSON object.",
  });

export const processWhatsAppInboundWebhookInputSchema = z.object({
  providerEventId: z.string().min(1).nullable().default(null),
  signatureValid: z.boolean(),
  payload: jsonObjectSchema,
});

export const queueWhatsAppTemplateMessageInputSchema = z.object({
  actorId: z.string().uuid(),
  caseId: z.string().uuid(),
  toPhone: z.string().min(3),
  toWhatsAppId: z.string().min(1).nullable().optional(),
  contactName: z.string().min(1).nullable().optional(),
  templateName: z.string().min(1),
  languageCode: z.string().min(2).default("en"),
  category: z.enum(templateCategories),
  body: z.string().min(1),
});

async function withWhatsAppRepository<T>(
  handler: (repository: WhatsAppRepository) => Promise<T>,
): Promise<T> {
  const repository = createWhatsAppRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

export function getWhatsAppIntegrationStatusForEnv(env: Env = process.env) {
  const missingLiveEnvVars = missingWhatsAppEnvVars(env, WHATSAPP_LIVE_PROVIDER_ENV_KEYS);

  return {
    provider: "woztell" as const,
    webhookConfigured: !missingLiveEnvVars.includes("WOZTELL_WEBHOOK_SECRET"),
    liveSendConfigured: missingLiveEnvVars.length === 0,
    missingLiveEnvVars,
  };
}

export const getWhatsAppIntegrationStatus = createServerFn({ method: "GET" }).handler(async () =>
  getWhatsAppIntegrationStatusForEnv(),
);

export const processWhatsAppInboundWebhook = createServerFn({ method: "POST" })
  .validator(processWhatsAppInboundWebhookInputSchema)
  .handler(async ({ data }) =>
    withWhatsAppRepository(async (repository) => {
      try {
        const normalized = normalizeWoztellInboundMessage(data.payload);
        const message = await repository.recordInboundMessage(normalized);
        const event = await repository.recordWebhookEvent({
          providerEventId: data.providerEventId,
          signatureValid: data.signatureValid,
          payload: data.payload,
          normalizedMessageId: message.id,
          processingStatus: data.signatureValid ? "processed" : "failed",
          errorMessage: data.signatureValid ? null : "Webhook signature was not verified.",
        });

        return {
          ok: data.signatureValid,
          messageId: message.id,
          eventId: event.id,
          processingStatus: event.processingStatus,
          errorMessage: event.errorMessage,
        };
      } catch (error) {
        const event = await repository.recordWebhookEvent({
          providerEventId: data.providerEventId,
          signatureValid: data.signatureValid,
          payload: data.payload,
          normalizedMessageId: null,
          processingStatus: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown WhatsApp webhook error.",
        });

        return {
          ok: false,
          messageId: null,
          eventId: event.id,
          processingStatus: event.processingStatus,
          errorMessage: event.errorMessage,
        };
      }
    }),
  );

export const queueWhatsAppTemplateMessage = createServerFn({ method: "POST" })
  .validator(queueWhatsAppTemplateMessageInputSchema)
  .handler(async ({ data }) =>
    withWhatsAppRepository(async (repository) => {
      const message = await repository.queueOutboundTemplateMessage(data);

      return {
        messageId: message.id,
        provider: message.provider,
        direction: message.direction,
        status: message.status,
        companyId: message.companyId,
        caseId: message.caseId,
      };
    }),
  );
