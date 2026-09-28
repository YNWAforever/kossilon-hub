import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertStaffAccess } from "@/features/auth/authorization";
import {
  assertAnnualReturnActionAllowed,
  type AnnualReturnActorRole,
} from "@/features/annual-return/permissions";
import { assertApprovedTemplate } from "./approved-templates";
import { isWithinSessionWindow } from "./session-window";
import type { QueueOutboundTemplateMessageInput } from "./repository";

const PREVIEW_LIFETIME_MS = 10 * 60_000;
const E164 = /^\+[1-9]\d{7,14}$/;
const REMINDER_TEMPLATE = "annual_return_manual_reminder";

export type MessageContext = {
  case: {
    id: string;
    companyId: string;
    companyName: string;
    companyTeamId: string;
    ownerId: string;
    reviewerId: string | null;
    status: string;
    dataOrigin: "client" | "fixture";
  };
  contact: null | {
    id: string;
    companyId: string;
    name: string;
    role: string;
    phoneE164: string | null;
    phoneVerifiedAt: string | null;
    languageCode: string | null;
    updatedAt: string;
  };
  /** The provider thread linked to the verified phone; never a case authority. */
  conversationId: string | null;
  lastInboundAt: string | null;
  template: null | {
    name: string;
    languageCode: string;
    body: string;
    active: boolean;
    /** Verified against the firm's provider tenant, not merely listed in code. */
    providerApprovalVerified: boolean;
  };
};

export type MessagePreview = {
  previewId: string;
  previewHash: string;
  caseId: string;
  companyId: string;
  contactId: string;
  conversationId: string | null;
  createdBy: string;
  recipientE164: string;
  recipientName: string;
  contactVersion: string;
  languageCode: string;
  purpose: "reply" | "reminder";
  sendMode: "text" | "template";
  templateName: string | null;
  components: [];
  renderedText: string;
  createdAt: string;
  expiresAt: string;
};

export type DeliveryRef = { messageId: string; replayed: boolean };
export type QueueOutbound = (
  input: QueueOutboundTemplateMessageInput,
) => Promise<{ id: string; idempotentReplay?: boolean }>;
export type MessagePreviewDependencies = {
  now(): Date;
  repository: {
    getContext(input: {
      caseId: string;
      contactId: string;
      conversationId?: string | null;
      templateName?: string | null;
    }): Promise<MessageContext>;
    savePreview(preview: MessagePreview): Promise<void>;
    /** Must lock preview, case and contact, then invoke callback in that same DB transaction. */
    queueIfCurrent(
      previewId: string,
      callback: (
        preview: MessagePreview,
        context: MessageContext,
        queue: QueueOutbound,
      ) => Promise<DeliveryRef>,
    ): Promise<DeliveryRef>;
  };
};

export type PrepareMessageInput = {
  caseId: string;
  conversationId?: string;
  contactId: string;
  purpose: "reply" | "reminder";
  draft: string;
};

function staffForCase(actor: AuthenticatedActor, context: MessageContext, creator?: string) {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("A staff database identity is required.");
  if (creator && creator !== staff.userId) {
    throw new Error("The preview was prepared by another staff member.");
  }
  assertAnnualReturnActionAllowed(
    {
      id: staff.userId,
      role: staff.role as AnnualReturnActorRole,
      teamId: staff.teamId,
      active: staff.active,
    },
    context.case,
    "record_reminder",
  );
  return staff.userId;
}

function assertReachableContext(
  context: MessageContext,
  caseId: string,
  contactId: string,
  conversationId: string | null,
) {
  if (context.case.id !== caseId) throw new Error("Message case context changed.");
  if (context.case.dataOrigin !== "client") throw new Error("Fixture cases cannot queue messages.");
  if (context.case.status === "Completed" || context.case.status === "Filed") {
    throw new Error("Closed annual return cases cannot queue messages.");
  }
  const contact = context.contact;
  if (!contact || contact.id !== contactId || contact.companyId !== context.case.companyId) {
    throw new Error("Select a contact on this client company before messaging.");
  }
  if (!contact.phoneE164 || !E164.test(contact.phoneE164) || !contact.phoneVerifiedAt) {
    throw new Error("Verify the contact E.164 phone number before messaging.");
  }
  if (!contact.languageCode) throw new Error("Set the contact language before messaging.");
  if (conversationId && context.conversationId !== conversationId) {
    throw new Error("The conversation does not match this contact and case.");
  }
  return contact;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(object[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function hashPreview(preview: Omit<MessagePreview, "previewHash">): string {
  return createHash("sha256").update(canonicalJson(preview)).digest("hex");
}

export async function prepareMessageForActor(
  actor: AuthenticatedActor,
  input: PrepareMessageInput,
  dependencies: MessagePreviewDependencies,
): Promise<MessagePreview> {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("A staff database identity is required.");
  const draft = input.draft.trim();
  if (!draft || draft.length > 4096) throw new Error("Enter a message of at most 4096 characters.");
  const now = dependencies.now();
  const context = await dependencies.repository.getContext({
    caseId: input.caseId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    templateName: input.purpose === "reminder" ? REMINDER_TEMPLATE : null,
  });
  const createdBy = staffForCase(actor, context);
  const contact = assertReachableContext(
    context,
    input.caseId,
    input.contactId,
    input.conversationId ?? null,
  );
  let sendMode: MessagePreview["sendMode"];
  let templateName: string | null = null;
  if (input.purpose === "reply") {
    if (!input.conversationId)
      throw new Error("A case-linked conversation is required for a reply.");
    if (!isWithinSessionWindow(context.lastInboundAt, now)) {
      throw new Error(
        "The WhatsApp session window has closed. Prepare an approved template instead.",
      );
    }
    sendMode = "text";
  } else {
    const template = context.template;
    if (!template || !template.active || !template.providerApprovalVerified) {
      throw new Error("The reminder template is not verified active with the provider.");
    }
    assertApprovedTemplate({ templateName: template.name, languageCode: contact.languageCode! });
    if (template.languageCode !== contact.languageCode || draft !== template.body) {
      throw new Error(
        "The rendered message must exactly match the active template body and language.",
      );
    }
    sendMode = "template";
    templateName = template.name;
  }
  const body: Omit<MessagePreview, "previewHash"> = {
    previewId: randomUUID(),
    caseId: input.caseId,
    companyId: context.case.companyId,
    contactId: contact.id,
    conversationId: input.conversationId ?? null,
    createdBy,
    recipientE164: contact.phoneE164!,
    recipientName: contact.name,
    contactVersion: contact.updatedAt,
    languageCode: contact.languageCode!,
    purpose: input.purpose,
    sendMode,
    templateName,
    components: [],
    renderedText: draft,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREVIEW_LIFETIME_MS).toISOString(),
  };
  const preview: MessagePreview = { ...body, previewHash: hashPreview(body) };
  await dependencies.repository.savePreview(preview);
  return preview;
}

/** Reused at approval and immediately before a live provider call. */
export function assertPreviewStillCurrent(
  preview: MessagePreview,
  context: MessageContext,
  now: Date,
): void {
  const contact = assertReachableContext(
    context,
    preview.caseId,
    preview.contactId,
    preview.conversationId,
  );
  if (Date.parse(preview.expiresAt) <= now.getTime()) {
    throw new Error("Message preview expired. Prepare a new preview.");
  }
  if (
    preview.companyId !== context.case.companyId ||
    preview.recipientE164 !== contact.phoneE164 ||
    preview.recipientName !== contact.name ||
    preview.contactVersion !== contact.updatedAt ||
    preview.languageCode !== contact.languageCode
  ) {
    throw new Error("Contact changed. Prepare a new message preview.");
  }
  if (preview.sendMode === "text") {
    if (!isWithinSessionWindow(context.lastInboundAt, now)) {
      throw new Error("WhatsApp session window changed. Prepare a new preview.");
    }
  } else {
    const template = context.template;
    if (
      !template ||
      !template.active ||
      !template.providerApprovalVerified ||
      template.name !== preview.templateName ||
      template.languageCode !== preview.languageCode ||
      template.body !== preview.renderedText
    ) {
      throw new Error("Template changed or was disabled. Prepare a new preview.");
    }
    assertApprovedTemplate({ templateName: template.name, languageCode: template.languageCode });
  }
}

export async function queueApprovedMessageForActor(
  actor: AuthenticatedActor,
  input: { previewId: string; previewHash: string; idempotencyKey: string },
  dependencies: MessagePreviewDependencies,
): Promise<DeliveryRef> {
  const staff = assertStaffAccess(actor);
  if (!staff.userId) throw new Error("A staff database identity is required.");
  if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required.");
  return dependencies.repository.queueIfCurrent(
    input.previewId,
    async (preview, context, queue) => {
      const { previewHash: _storedHash, ...body } = preview;
      if (preview.previewHash !== input.previewHash || hashPreview(body) !== input.previewHash) {
        throw new Error("Message preview hash changed. Prepare a new preview.");
      }
      const createdBy = staffForCase(actor, context, preview.createdBy);
      assertPreviewStillCurrent(preview, context, dependencies.now());
      const result = await queue({
        actorId: createdBy,
        caseId: preview.caseId,
        toPhone: preview.recipientE164,
        contactName: preview.recipientName,
        templateName: preview.templateName ?? REMINDER_TEMPLATE,
        languageCode: preview.sendMode === "template" ? preview.languageCode : "en",
        category: "annual_return",
        body: preview.renderedText,
        idempotencyKey: "message-preview:" + preview.previewId,
        metadata: {
          source: "approved-message-preview",
          previewId: preview.previewId,
          previewHash: preview.previewHash,
          conversationId: preview.conversationId,
          frozenSendMode: preview.sendMode,
          renderedText: preview.renderedText,
        },
      });
      return { messageId: result.id, replayed: result.idempotentReplay === true };
    },
  );
}
