import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DispatchSummary } from "@/features/notifications/types";
import type { ProviderMode } from "@/server/provider-mode";
import { getSqlClient } from "@/server/db/client";
import { createWhatsAppRepository, type WhatsAppRepository } from "@/features/whatsapp/repository";
import { getAnnualReturnActionPermission } from "./permissions";
import { createAnnualReturnRepository, type AnnualReturnRepository } from "./repository";
import { getCurrentAnnualReturnActor } from "./session";
import { hongKongBusinessDate } from "./workflow";
import {
  deriveProductionFollowUpDrafts,
  PRODUCTION_FOLLOW_UP_SOURCES,
  stableFollowUpIdempotencyKey,
  type ProductionFollowUpDraft,
  type ProductionFollowUpIdentity,
  type ProductionFollowUpSource,
} from "./follow-ups";
import {
  createProductionFollowUpRepository,
  type ProductionFollowUpRepository,
} from "./follow-up-repository";

const followUpIdentityFields = {
  caseId: z.string().uuid(),
  entityId: z.string().uuid(),
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

export async function listProductionFollowUpDraftsForActor(
  actor: AuthenticatedActor,
  dependencies: ProductionFollowUpDependencies,
): Promise<ProductionFollowUpDraft[]> {
  const staff = staffIdentity(actor);
  const cases = await dependencies.annualReturnRepository.listCases({});
  const authorizedCases = cases.filter(
    (caseItem) => getAnnualReturnActionPermission(staff, caseItem, "record_reminder").allowed,
  );
  const state = await dependencies.followUpRepository.listPersistedState(
    authorizedCases.map((caseItem) => caseItem.id),
  );
  return deriveProductionFollowUpDrafts(authorizedCases, state, hongKongBusinessDate());
}

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

  const details = queueDetails(identity.source);
  const message = await dependencies.whatsAppRepository.queueOutboundTemplateMessage({
    actorId: staff.id,
    caseId: identity.caseId,
    toPhone: draft.phone,
    contactName: draft.recipientName,
    templateName: details.templateName,
    languageCode: "en",
    category: details.category,
    body: draft.messagePreview,
    idempotencyKey: stableFollowUpIdempotencyKey(identity),
    followUpId: identity.entityId,
    metadata: {
      source: identity.source,
      entityId: identity.entityId,
      documentId: identity.source === "annual-return" ? null : identity.entityId,
    },
  });
  const replayed = message.idempotentReplay === true;

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

export const listProductionFollowUpDrafts = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const annualReturnRepository = createAnnualReturnRepository();
  const followUpRepository = createProductionFollowUpRepository();
  const whatsAppRepository = createWhatsAppRepository();
  try {
    return await listProductionFollowUpDraftsForActor(actor, {
      annualReturnRepository,
      followUpRepository,
      whatsAppRepository,
    });
  } finally {
    await Promise.all([
      annualReturnRepository.close(),
      followUpRepository.close(),
      whatsAppRepository.close(),
    ]);
  }
});

export const sendProductionFollowUp = createServerFn({ method: "POST" })
  .validator(productionFollowUpSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();
    const result = await sql.begin(async (tx) => {
      const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
      const followUpRepository = createProductionFollowUpRepository({ sql: tx });
      const whatsAppRepository = createWhatsAppRepository({ sql: tx });
      try {
        return await sendProductionFollowUpForActor(actor, data, {
          annualReturnRepository,
          followUpRepository,
          whatsAppRepository,
        });
      } finally {
        await Promise.all([
          annualReturnRepository.close(),
          followUpRepository.close(),
          whatsAppRepository.close(),
        ]);
      }
    });
    const [{ currentProviderMode }, { dispatchDueNotificationsOnServer }] = await Promise.all([
      import("@/server/provider-mode"),
      import("@/features/notifications/runtime-dispatch"),
    ]);
    await dispatchSimulatedFollowUpIfNeeded({
      currentProviderMode,
      dispatchDue: dispatchDueNotificationsOnServer,
      now: () => new Date(),
    });
    return result;
  });

export { PRODUCTION_FOLLOW_UP_SOURCES };
