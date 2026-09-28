import { entityIdSchema } from "@/features/runtime/entity-id";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { assertApprovedTemplate } from "@/features/whatsapp/approved-templates";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DispatchSummary } from "@/features/notifications/types";
import type { ProviderMode } from "@/server/provider-mode";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import { caseFiltersForActor, getAnnualReturnActionPermission } from "./permissions";
import type { AnnualReturnRepository } from "./repository";
import { hongKongBusinessDate } from "./workflow";
import { toPhoneDigits } from "@/features/whatsapp/phone";
import {
  buildProductionFollowUpPreview,
  type ProductionFollowUpPreview,
} from "./follow-up-preview";
import type { SqlClient } from "@/server/db/client";
import type postgres from "postgres";
import {
  deriveProductionFollowUpDrafts,
  PRODUCTION_FOLLOW_UP_SOURCES,
  stableFollowUpIdempotencyKey,
  type ProductionFollowUpDraft,
  type ProductionFollowUpIdentity,
  type ProductionFollowUpSource,
} from "./follow-ups";
import type { ProductionFollowUpRepository } from "./follow-up-repository";

const followUpIdentityFields = {
  caseId: entityIdSchema,
  entityId: entityIdSchema,
};

export const annualReturnFollowUpSchema = z
  .object({ source: z.literal("annual-return"), ...followUpIdentityFields })
  .strict();
export const documentReviewFollowUpSchema = z
  .object({ source: z.literal("document-review"), ...followUpIdentityFields })
  .strict();
export const paymentProofFollowUpSchema = z
  .object({ source: z.literal("payment-proof-review"), ...followUpIdentityFields })
  .strict();
export const productionFollowUpSchema = z.discriminatedUnion("source", [
  annualReturnFollowUpSchema,
  documentReviewFollowUpSchema,
  paymentProofFollowUpSchema,
]);

export type ProductionFollowUpDependencies = {
  annualReturnRepository: AnnualReturnRepository;
  followUpRepository: ProductionFollowUpRepository;
  whatsAppRepository: WhatsAppRepository;
  approvedPreview?: ProductionFollowUpPreview;
};

function staffIdentity(actor: AuthenticatedActor) {
  const staff = assertStaffAccess(actor);
  return {
    id: staff.userId!,
    role: staff.role as "Admin" | "Manager" | "Staff",
    teamId: staff.teamId,
    active: staff.active,
  };
}

export type ProductionFollowUpDraftPage = {
  drafts: ProductionFollowUpDraft[];
  nextCursor: string | null;
};

export async function listProductionFollowUpDraftsForActor(
  actor: AuthenticatedActor,
  dependencies: ProductionFollowUpDependencies,
  input: { cursor?: string; limit?: number } = {},
): Promise<ProductionFollowUpDraftPage> {
  const staff = staffIdentity(actor);
  const scope = caseFiltersForActor({
    id: staff.id,
    role: staff.role,
    teamId: staff.teamId,
    active: staff.active,
  });
  const page = await dependencies.annualReturnRepository.listCasePage({
    ...scope,
    cursor: input.cursor,
    limit: input.limit ?? 50,
  });
  const authorizedCases = page.cases.filter(
    (caseItem) => getAnnualReturnActionPermission(staff, caseItem, "record_reminder").allowed,
  );
  const state = await dependencies.followUpRepository.listPersistedState(
    authorizedCases.map((caseItem) => caseItem.id),
  );
  return {
    drafts: deriveProductionFollowUpDrafts(authorizedCases, state, hongKongBusinessDate()),
    nextCursor: page.nextCursor,
  };
}

type FollowUpQueryClient = SqlClient | postgres.TransactionSql;

/** Read-only review of the exact persisted recipient and in-window body. */
export async function prepareProductionFollowUpForActor(
  actor: AuthenticatedActor,
  identity: ProductionFollowUpIdentity,
  dependencies: ProductionFollowUpDependencies,
  sql: FollowUpQueryClient,
  now: Date,
): Promise<ProductionFollowUpPreview> {
  const data = productionFollowUpSchema.parse(identity);
  const staff = staffIdentity(actor);
  const caseItem = await dependencies.annualReturnRepository.getCase(data.caseId);
  if (!caseItem || !getAnnualReturnActionPermission(staff, caseItem, "record_reminder").allowed) {
    throw new Error("No current authorized follow-up draft exists.");
  }
  const state = await dependencies.followUpRepository.listPersistedState([caseItem.id]);
  const draft = deriveProductionFollowUpDrafts([caseItem], state, hongKongBusinessDate()).find(
    (candidate) =>
      candidate.source === data.source &&
      candidate.caseId === data.caseId &&
      candidate.entityId === data.entityId,
  );
  if (!draft) throw new Error("No current authorized follow-up draft exists.");
  const digits = toPhoneDigits(draft.phone);
  if (!digits) throw new Error("Follow-up recipient has no saved phone.");
  const contacts = await sql<
    {
      id: string;
      name: string;
      phone_e164: string;
      preferred_language: string;
      updated_at: string;
    }[]
  >`
    select id, name, phone_e164, preferred_language, updated_at::text as updated_at
    from company_contacts
    where company_id = ${draft.companyId}
      and name = ${draft.recipientName}
      and phone_e164 is not null and phone_verified_at is not null
      and preferred_language is not null
      and regexp_replace(phone_e164, '[^0-9]', '', 'g') = ${digits}
    order by id
    limit 2
    for share
  `;
  if (contacts.length > 1) throw new Error("Multiple verified contacts match this recipient.");
  const contact = contacts[0];
  const lastInboundAt = await dependencies.whatsAppRepository.lastInboundAtForPhoneDigits(digits);
  return buildProductionFollowUpPreview({
    draft,
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          phoneE164: contact.phone_e164,
          languageCode: contact.preferred_language,
          updatedAt: contact.updated_at,
        }
      : null,
    lastInboundAt,
    now,
  });
}

export const productionFollowUpApprovalSchema = z
  .object({
    source: z.enum(["annual-return", "document-review", "payment-proof-review"]),
    ...followUpIdentityFields,
    previewHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

function queueDetails(source: ProductionFollowUpSource) {
  if (source === "document-review") {
    return {
      templateName: "annual_return_document_replacement",
      templateLabel: "Annual return document replacement follow-up",
      category: "document" as const,
    };
  }
  if (source === "payment-proof-review") {
    return {
      templateName: "annual_return_payment_proof_replacement",
      templateLabel: "Annual return payment proof replacement follow-up",
      category: "payment" as const,
    };
  }
  return {
    templateName: "annual_return_manual_reminder",
    templateLabel: "Annual return WhatsApp reminder",
    category: "annual_return" as const,
  };
}

async function sendFollowUpForActor(
  actor: AuthenticatedActor,
  identity: ProductionFollowUpIdentity,
  dependencies: ProductionFollowUpDependencies,
) {
  const staff = staffIdentity(actor);
  const caseItem = await dependencies.annualReturnRepository.getCase(identity.caseId);
  if (!caseItem) throw new Error("Annual return case not found.");

  await dependencies.annualReturnRepository.assertCanMutateCase(
    identity.caseId,
    staff.id,
    "record_reminder",
  );
  const currentCase = await dependencies.annualReturnRepository.getCase(identity.caseId);
  if (!currentCase) throw new Error("Annual return case not found.");
  const state = await dependencies.followUpRepository.listPersistedState([identity.caseId]);
  const draft = deriveProductionFollowUpDrafts([currentCase], state, hongKongBusinessDate()).find(
    (candidate) => candidate.source === identity.source && candidate.entityId === identity.entityId,
  );
  if (!draft) {
    throw new Error(`No current ${identity.source} follow-up exists for this case.`);
  }
  if (draft.status === "blocked" || !draft.recipientName || !draft.phone) {
    throw new Error("Follow-up is blocked because no persisted recipient is available.");
  }
  const approved = dependencies.approvedPreview;
  if (
    approved &&
    (draft.status !== "draft" ||
      approved.caseId !== draft.caseId ||
      approved.companyId !== draft.companyId ||
      approved.renderedText !== draft.messagePreview ||
      approved.recipientName !== draft.recipientName ||
      toPhoneDigits(approved.recipientE164) !== toPhoneDigits(draft.phone))
  ) {
    throw new Error("Follow-up changed since approval; prepare a new preview.");
  }

  const details = queueDetails(identity.source);
  // Refused here rather than at WOZTELL. An unapproved name is rejected outside
  // the 24-hour window with ok:0, and by the runbook's own account that failure
  // reaches a console.error and is nulled out after 90 days -- so a permanently
  // unapproved template shows up as an aggregate count and nothing else.
  const approvedTemplate = assertApprovedTemplate({
    templateName: details.templateName,
    languageCode: "en",
  });

  const message = await dependencies.whatsAppRepository.queueOutboundTemplateMessage({
    actorId: staff.id,
    caseId: identity.caseId,
    toPhone: draft.phone,
    contactName: draft.recipientName,
    // Refused here rather than at WOZTELL. An unapproved name is rejected
    // outside the 24-hour window with ok:0, and by the runbook's own account
    // that failure reaches a console.error and is nulled out after 90 days --
    // so a permanently unapproved template shows up as an aggregate count and
    // nothing else.
    templateName: approvedTemplate.templateName,
    languageCode: approvedTemplate.languageCode,
    category: details.category,
    body: draft.messagePreview,
    idempotencyKey: stableFollowUpIdempotencyKey(identity),
    followUpId: identity.entityId,
    metadata: {
      source: identity.source,
      entityId: identity.entityId,
      documentId: identity.source === "annual-return" ? null : identity.entityId,
      ...(approved
        ? {
            approvedPreviewKind: "follow-up",
            frozenSendMode: approved.sendMode,
            previewHash: approved.previewHash,
            renderedText: approved.renderedText,
            contactId: approved.contactId,
            contactVersion: approved.contactVersion,
            companyId: approved.companyId,
            recipientName: approved.recipientName,
            recipientE164: approved.recipientE164,
            languageCode: approved.languageCode,
          }
        : {}),
    },
  });
  const replayed = message.idempotentReplay === true;
  if (replayed && approved) {
    const payload =
      message.payload &&
      typeof message.payload === "object" &&
      !Array.isArray(message.payload) &&
      !(message.payload instanceof Date)
        ? (message.payload as Record<string, unknown>)
        : {};
    if (
      payload.approvedPreviewKind !== "follow-up" ||
      payload.previewHash !== approved.previewHash ||
      payload.contactId !== approved.contactId
    ) {
      throw new Error("Existing follow-up has different approval; inspect its delivery.");
    }
  }

  if (!replayed) {
    await dependencies.annualReturnRepository.recordReminder({
      caseId: identity.caseId,
      actorId: staff.id,
      templateLabel: details.templateLabel,
      recipientName: draft.recipientName,
      recipientPhone: draft.phone,
      draftBody: draft.messagePreview,
      note: `Queued from production automation (${identity.source}).`,
    });
  }

  return {
    source: identity.source,
    caseId: identity.caseId,
    entityId: identity.entityId,
    messageId: message.id,
    messageStatus: message.status,
    replayed,
  };
}

export type SimulatedFollowUpDispatchDependencies = {
  currentProviderMode(): ProviderMode;
  dispatchDue(input: { now: string; limit: number }): Promise<DispatchSummary>;
  now(): Date;
};

export async function dispatchSimulatedFollowUpIfNeeded(
  dependencies: SimulatedFollowUpDispatchDependencies,
): Promise<DispatchSummary | null> {
  if (dependencies.currentProviderMode() !== "simulated") return null;

  return dependencies.dispatchDue({
    now: dependencies.now().toISOString(),
    limit: 50,
  });
}

type SourceIdentityInput = { caseId: string; entityId: string };

export function sendAnnualReturnFollowUpForActor(
  actor: AuthenticatedActor,
  input: SourceIdentityInput,
  dependencies: ProductionFollowUpDependencies,
) {
  const data = annualReturnFollowUpSchema.parse({ source: "annual-return", ...input });
  return sendFollowUpForActor(actor, data, dependencies);
}

export function sendDocumentReviewFollowUpForActor(
  actor: AuthenticatedActor,
  input: SourceIdentityInput,
  dependencies: ProductionFollowUpDependencies,
) {
  const data = documentReviewFollowUpSchema.parse({ source: "document-review", ...input });
  return sendFollowUpForActor(actor, data, dependencies);
}

export function sendPaymentProofFollowUpForActor(
  actor: AuthenticatedActor,
  input: SourceIdentityInput,
  dependencies: ProductionFollowUpDependencies,
) {
  const data = paymentProofFollowUpSchema.parse({ source: "payment-proof-review", ...input });
  return sendFollowUpForActor(actor, data, dependencies);
}

export function sendProductionFollowUpForActor(
  actor: AuthenticatedActor,
  input: ProductionFollowUpIdentity,
  dependencies: ProductionFollowUpDependencies,
) {
  const data = productionFollowUpSchema.parse(input);
  if (data.source === "annual-return") {
    return sendAnnualReturnFollowUpForActor(actor, data, dependencies);
  }
  if (data.source === "document-review") {
    return sendDocumentReviewFollowUpForActor(actor, data, dependencies);
  }
  return sendPaymentProofFollowUpForActor(actor, data, dependencies);
}

const loadProductionFollowUpDependencies = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { getCurrentAnnualReturnActor },
    { getSqlClient },
    { createAnnualReturnRepository },
    { createProductionFollowUpRepository },
    { createWhatsAppRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./session"),
    import("@/server/db/client"),
    import("./repository"),
    import("./follow-up-repository"),
    import("@/features/whatsapp/repository"),
  ]);
  return {
    getRequest,
    getCurrentAnnualReturnActor,
    getSqlClient,
    createAnnualReturnRepository,
    createProductionFollowUpRepository,
    createWhatsAppRepository,
  };
});

const productionFollowUpPageSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const listProductionFollowUpDrafts = createServerFn({ method: "GET" })
  .validator(productionFollowUpPageSchema)
  .handler(async ({ data }) => {
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      createAnnualReturnRepository,
      createProductionFollowUpRepository,
      createWhatsAppRepository,
    } = await loadProductionFollowUpDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const annualReturnRepository = createAnnualReturnRepository();
    const followUpRepository = createProductionFollowUpRepository();
    const whatsAppRepository = createWhatsAppRepository();
    try {
      return await listProductionFollowUpDraftsForActor(
        actor,
        {
          annualReturnRepository,
          followUpRepository,
          whatsAppRepository,
        },
        data,
      );
    } finally {
      await Promise.all([
        annualReturnRepository.close(),
        followUpRepository.close(),
        whatsAppRepository.close(),
      ]);
    }
  });

export const previewProductionFollowUp = createServerFn({ method: "GET" })
  .validator(productionFollowUpSchema)
  .handler(async ({ data }) => {
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      getSqlClient,
      createAnnualReturnRepository,
      createProductionFollowUpRepository,
      createWhatsAppRepository,
    } = await loadProductionFollowUpDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const annualReturnRepository = createAnnualReturnRepository();
    const followUpRepository = createProductionFollowUpRepository();
    const whatsAppRepository = createWhatsAppRepository();
    try {
      return await prepareProductionFollowUpForActor(
        actor,
        data,
        {
          annualReturnRepository,
          followUpRepository,
          whatsAppRepository,
        },
        getSqlClient(),
        new Date(),
      );
    } finally {
      await Promise.all([
        annualReturnRepository.close(),
        followUpRepository.close(),
        whatsAppRepository.close(),
      ]);
    }
  });

export const sendProductionFollowUp = createServerFn({ method: "POST" })
  .validator(productionFollowUpApprovalSchema)
  .handler(async ({ data }) => {
    const { previewHash, ...identity } = data;
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      getSqlClient,
      createAnnualReturnRepository,
      createProductionFollowUpRepository,
      createWhatsAppRepository,
    } = await loadProductionFollowUpDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const [{ currentProviderMode }, { getWhatsAppIntegrationStatusForActor }] = await Promise.all([
      import("@/server/provider-mode"),
      import("@/features/whatsapp/server-fns"),
    ]);
    const providerMode = currentProviderMode();
    const providerStatus = getWhatsAppIntegrationStatusForActor(actor, process.env, providerMode);
    if (providerMode !== "live" || providerStatus.capabilityStatus.state !== "healthy") {
      throw new Error("Provider delivery is unverified; this follow-up cannot be queued.");
    }
    const sql = getSqlClient();
    const result = await sql.begin(async (tx) => {
      const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
      const followUpRepository = createProductionFollowUpRepository({ sql: tx });
      const whatsAppRepository = createWhatsAppRepository({ sql: tx });
      try {
        const dependencies = {
          annualReturnRepository,
          followUpRepository,
          whatsAppRepository,
        };
        const preview = await prepareProductionFollowUpForActor(
          actor,
          identity,
          dependencies,
          tx,
          new Date(),
        );
        if (preview.previewHash !== previewHash) {
          throw new Error("Follow-up preview changed. Review and approve it again.");
        }
        return await sendProductionFollowUpForActor(actor, identity, {
          ...dependencies,
          approvedPreview: preview,
        });
      } finally {
        await Promise.all([
          annualReturnRepository.close(),
          followUpRepository.close(),
          whatsAppRepository.close(),
        ]);
      }
    });
    return result;
  });

export { PRODUCTION_FOLLOW_UP_SOURCES };
