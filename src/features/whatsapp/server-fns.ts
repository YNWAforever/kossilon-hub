import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ProviderMode } from "@/server/provider-mode";
import { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS } from "./config";
import {
  createWhatsAppRepository,
  type InboundWhatsAppMessageRecord,
  type WhatsAppRepository,
  type WhatsAppTemplateCategory,
  type WhatsAppWebhookEventRecord,
  type WhatsAppWebhookProcessingStatus,
} from "./repository";
import { normalizeWoztellInboundMessage } from "./woztell";

type Env = Record<string, string | undefined>;
type ProcessWhatsAppInboundWebhookInput = z.infer<typeof processWhatsAppInboundWebhookInputSchema>;
type ProcessWhatsAppInboundWebhookRepository = Pick<
  WhatsAppRepository,
  "recordInboundMessage" | "recordWebhookEvent"
>;

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

export type WhatsAppDeliveryMode = "live" | "simulated" | "blocked";

export function getWhatsAppIntegrationStatusForEnv(
  env: Env = process.env,
  providerMode: ProviderMode = "live",
) {
  const missingLiveEnvVars = missingWhatsAppEnvVars(env, WHATSAPP_LIVE_PROVIDER_ENV_KEYS);
  const deliveryMode: WhatsAppDeliveryMode =
    providerMode === "simulated"
      ? "simulated"
      : missingLiveEnvVars.length === 0
        ? "live"
        : "blocked";

  return {
    provider: providerMode === "simulated" ? ("simulated" as const) : ("woztell" as const),
    deliveryMode,
    webhookConfigured:
      providerMode === "live" && !missingLiveEnvVars.includes("WOZTELL_WEBHOOK_SECRET"),
    liveSendConfigured: deliveryMode === "live",
    missingLiveEnvVars,
  };
}

export type WhatsAppInboundWebhookResponse = {
  ok: boolean;
  messageId: string | null;
  eventId: string;
  processingStatus: WhatsAppWebhookProcessingStatus;
  errorMessage: string | null;
  matchedCompanyId: string | null;
  matchedCaseId: string | null;
  timelineEventCreated: boolean;
};

export function buildWhatsAppInboundWebhookResponse(input: {
  signatureValid: boolean;
  message: Pick<
    InboundWhatsAppMessageRecord,
    "id" | "companyId" | "caseId" | "timelineEventCreated"
  >;
  event: Pick<WhatsAppWebhookEventRecord, "id" | "processingStatus" | "errorMessage">;
}): WhatsAppInboundWebhookResponse {
  return {
    ok: input.signatureValid,
    messageId: input.message.id,
    eventId: input.event.id,
    processingStatus: input.event.processingStatus,
    errorMessage: input.event.errorMessage,
    matchedCompanyId: input.message.companyId,
    matchedCaseId: input.message.caseId,
    timelineEventCreated: input.message.timelineEventCreated,
  };
}

function buildFailedWhatsAppInboundWebhookResponse(
  event: Pick<WhatsAppWebhookEventRecord, "id" | "processingStatus" | "errorMessage">,
): WhatsAppInboundWebhookResponse {
  return {
    ok: false,
    messageId: null,
    eventId: event.id,
    processingStatus: event.processingStatus,
    errorMessage: event.errorMessage,
    matchedCompanyId: null,
    matchedCaseId: null,
    timelineEventCreated: false,
  };
}

export async function processWhatsAppInboundWebhookWithRepository(
  repository: ProcessWhatsAppInboundWebhookRepository,
  data: ProcessWhatsAppInboundWebhookInput,
): Promise<WhatsAppInboundWebhookResponse> {
  if (!data.signatureValid) {
    const event = await repository.recordWebhookEvent({
      providerEventId: data.providerEventId,
      signatureValid: data.signatureValid,
      payload: data.payload,
      normalizedMessageId: null,
      processingStatus: "failed",
      errorMessage: "Webhook signature was not verified.",
    });

    return buildFailedWhatsAppInboundWebhookResponse(event);
  }

  try {
    const normalized = normalizeWoztellInboundMessage(data.payload);
    const message = await repository.recordInboundMessage(normalized);
    const event = await repository.recordWebhookEvent({
      providerEventId: data.providerEventId,
      signatureValid: data.signatureValid,
      payload: data.payload,
      normalizedMessageId: message.id,
      processingStatus: "processed",
      errorMessage: null,
    });

    return buildWhatsAppInboundWebhookResponse({
      signatureValid: data.signatureValid,
      message,
      event,
    });
  } catch (error) {
    const event = await repository.recordWebhookEvent({
      providerEventId: data.providerEventId,
      signatureValid: data.signatureValid,
      payload: data.payload,
      normalizedMessageId: null,
      processingStatus: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown WhatsApp webhook error.",
    });

    return buildFailedWhatsAppInboundWebhookResponse(event);
  }
}

export const getWhatsAppIntegrationStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { currentProviderMode } = await import("@/server/provider-mode");
  return getWhatsAppIntegrationStatusForEnv(process.env, currentProviderMode());
});

export const processWhatsAppInboundWebhook = createServerFn({ method: "POST" })
  .validator(processWhatsAppInboundWebhookInputSchema)
  .handler(async ({ data }) =>
    withWhatsAppRepository((repository) =>
      processWhatsAppInboundWebhookWithRepository(repository, data),
    ),
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
