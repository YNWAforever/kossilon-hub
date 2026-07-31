import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import { requireStaffActor } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ProviderMode } from "@/server/provider-mode";
import { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS } from "./config";
import type { WhatsAppConversation, WhatsAppConversationMessage } from "./conversations";
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

export const listWhatsAppConversationsInputSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

export const listWhatsAppConversationMessagesInputSchema = z.object({
  contactId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
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

export type WhatsAppInboxDependencies = {
  repository: Pick<WhatsAppRepository, "listConversations" | "listConversationMessages">;
};

/**
 * Staff-only, and scoped no further than that on purpose:
 * `whatsapp_contacts.company_id` is nullable, so an inbound message the matcher
 * could not attach to a company belongs to no company at all. There is no client
 * scope to fall back on, which is exactly why a Client actor is refused outright
 * rather than shown a filtered view.
 */
export async function listWhatsAppConversationsForActor(
  actor: AuthenticatedActor,
  input: { limit?: number },
  dependencies: WhatsAppInboxDependencies,
): Promise<WhatsAppConversation[]> {
  assertStaffAccess(actor);
  return dependencies.repository.listConversations(input);
}

export async function listWhatsAppConversationMessagesForActor(
  actor: AuthenticatedActor,
  input: { contactId: string; limit?: number },
  dependencies: WhatsAppInboxDependencies,
): Promise<WhatsAppConversationMessage[]> {
  assertStaffAccess(actor);
  return dependencies.repository.listConversationMessages(input);
}

async function withWhatsAppStaffRepository<T>(
  handler: (repository: WhatsAppRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const actor = await requireStaffActor(getRequest());
  const repository = createWhatsAppRepository();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}

export const listWhatsAppConversations = createServerFn({ method: "GET" })
  .validator(listWhatsAppConversationsInputSchema)
  .handler(({ data }) =>
    withWhatsAppStaffRepository((repository, actor) =>
      listWhatsAppConversationsForActor(actor, data, { repository }),
    ),
  );

export const listWhatsAppConversationMessages = createServerFn({ method: "GET" })
  .validator(listWhatsAppConversationMessagesInputSchema)
  .handler(({ data }) =>
    withWhatsAppStaffRepository((repository, actor) =>
      listWhatsAppConversationMessagesForActor(actor, data, { repository }),
    ),
  );

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
