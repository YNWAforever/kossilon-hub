import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertAnnualReturnActionAllowed,
  type AnnualReturnActorRole,
} from "@/features/annual-return/permissions";
import type { ProviderMode } from "@/server/provider-mode";
import { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS } from "./config";
import type { WhatsAppConversation, WhatsAppConversationMessage } from "./conversations";
import type {
  InboundWhatsAppMessageRecord,
  WhatsAppRepository,
  WhatsAppTemplateCategory,
  WhatsAppWebhookEventRecord,
  WhatsAppWebhookProcessingStatus,
} from "./repository";
import { classifyWoztellWebhookEvent } from "./woztell";

type Env = Record<string, string | undefined>;
type ProcessWhatsAppInboundWebhookInput = z.infer<typeof processWhatsAppInboundWebhookInputSchema>;
export type ProcessWhatsAppInboundWebhookRepository = Pick<
  WhatsAppRepository,
  "recordInboundMessage" | "recordWebhookEvent" | "recordMessageStatusEvent"
>;
type QueueWhatsAppTemplateMessageInput = z.infer<typeof queueWhatsAppTemplateMessageInputSchema> & {
  actorId: string;
};

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

// CLAUDE.md: "every one validates with a Zod schema". This server fn takes no
// input, so the schema states exactly that rather than the rule being skipped.
export const noInputSchema = z.undefined().or(z.object({}).strict());

export const listWhatsAppConversationsInputSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

export const listWhatsAppConversationMessagesInputSchema = z.object({
  contactId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
});

// No `actorId`: identity is derived from the request, never accepted from it.
export const queueWhatsAppTemplateMessageInputSchema = z.object({
  caseId: z.string().uuid(),
  toPhone: z.string().min(3),
  toWhatsAppId: z.string().min(1).nullable().optional(),
  contactName: z.string().min(1).nullable().optional(),
  templateName: z.string().min(1),
  languageCode: z.string().min(2).default("en"),
  category: z.enum(templateCategories),
  body: z.string().min(1),
});

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
    const event = classifyWoztellWebhookEvent(data.payload);

    if (event.kind === "ignored") {
      // Recorded and acknowledged on purpose. Redelivering it would produce the
      // same classification, and 503 here would make WOZTELL retry forever.
      const row = await repository.recordWebhookEvent({
        providerEventId: data.providerEventId,
        signatureValid: true,
        payload: data.payload,
        normalizedMessageId: null,
        processingStatus: "ignored",
        errorMessage: event.reason,
      });

      return { ...buildFailedWhatsAppInboundWebhookResponse(row), ok: true };
    }

    if (event.kind === "status") {
      const applied = await repository.recordMessageStatusEvent(event.status);
      const row = await repository.recordWebhookEvent({
        providerEventId: data.providerEventId,
        signatureValid: true,
        payload: data.payload,
        normalizedMessageId: applied.messageId,
        processingStatus: applied.matched ? "processed" : "ignored",
        errorMessage: applied.matched ? null : "No outbound message matched this status update.",
      });

      return {
        ...buildFailedWhatsAppInboundWebhookResponse(row),
        ok: true,
        messageId: applied.messageId,
      };
    }

    const message = await repository.recordInboundMessage(event.message);
    const row = await repository.recordWebhookEvent({
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
      event: row,
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

export type QueueWhatsAppTemplateMessageDependencies = {
  repository: Pick<
    WhatsAppRepository,
    "getCaseAuthorizationContext" | "queueOutboundTemplateMessage"
  >;
};

/**
 * Messaging a client about a case is an action on that case, so it is scoped with
 * the same predicate as every other case action. The actor id is taken from the
 * resolved actor and never from the input — the previous version accepted an
 * `actorId` in the request body and had no authentication at all, so anyone could
 * send a WhatsApp message from the firm's number attributed to any staff member.
 */
export async function queueWhatsAppTemplateMessageForActor(
  actor: AuthenticatedActor,
  input: Omit<QueueWhatsAppTemplateMessageInput, "actorId">,
  dependencies: QueueWhatsAppTemplateMessageDependencies,
) {
  const staff = assertStaffAccess(actor);

  if (!staff.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  const case_ = await dependencies.repository.getCaseAuthorizationContext(input.caseId);

  if (!case_) {
    throw new Error("Annual return case not found for WhatsApp template message.");
  }

  assertAnnualReturnActionAllowed(
    {
      id: staff.userId,
      role: staff.role as AnnualReturnActorRole,
      teamId: staff.teamId,
      active: staff.active,
    },
    case_,
    "record_reminder",
  );

  return dependencies.repository.queueOutboundTemplateMessage({ ...input, actorId: staff.userId });
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

// Staff is asserted before a connection is acquired, so an unauthorised caller
// never reaches the pool. The *ForActor functions assert again on the actor they
// are handed — they are the seam the unit tests drive, and have to stand on their
// own rather than inherit a guarantee from this wrapper.
const loadDefaultWhatsAppInboxContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireActor }, { createWhatsAppRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  const actor = assertStaffAccess(await requireActor(getRequest()));
  return { actor, repository: createWhatsAppRepository() };
});

async function withWhatsAppInboxRepository<T>(
  handler: (repository: WhatsAppRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const { actor, repository } = await loadDefaultWhatsAppInboxContext();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}

export const listWhatsAppConversations = createServerFn({ method: "GET" })
  .validator(listWhatsAppConversationsInputSchema)
  .handler(({ data }) =>
    withWhatsAppInboxRepository((repository, actor) =>
      listWhatsAppConversationsForActor(actor, data, { repository }),
    ),
  );

export const listWhatsAppConversationMessages = createServerFn({ method: "GET" })
  .validator(listWhatsAppConversationMessagesInputSchema)
  .handler(({ data }) =>
    withWhatsAppInboxRepository((repository, actor) =>
      listWhatsAppConversationMessagesForActor(actor, data, { repository }),
    ),
  );

// Staff-only: the response names the firm's unconfigured bindings and its
// provider mode. No values leak, but that is internal infrastructure state and a
// client portal session has no business reading it.
export const getWhatsAppIntegrationStatus = createServerFn({ method: "GET" })
  .validator(noInputSchema)
  .handler(async () => {
    const [{ getRequest }, { requireStaffActor }, { currentProviderMode }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("@/server/provider-mode"),
    ]);
    await requireStaffActor(getRequest());
    return getWhatsAppIntegrationStatusForEnv(process.env, currentProviderMode());
  });

// Inbound ingestion is NOT a server function. WOZTELL authenticates with an HMAC
// over the raw body, which only an HTTP route can verify — see ./webhook.ts and
// the `/api/webhooks/whatsapp` branch in src/server.ts. The previous server fn
// took `signatureValid` as a boolean from the caller and had no actor check at
// all, so anyone could post a forged inbound message.

export const queueWhatsAppTemplateMessage = createServerFn({ method: "POST" })
  .validator(queueWhatsAppTemplateMessageInputSchema)
  .handler(async ({ data }) =>
    withWhatsAppInboxRepository(async (repository, actor) => {
      const message = await queueWhatsAppTemplateMessageForActor(actor, data, { repository });

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
