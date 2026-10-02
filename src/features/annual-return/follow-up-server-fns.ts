import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { assertApprovedTemplate } from "@/features/whatsapp/approved-templates";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DispatchSummary } from "@/features/notifications/types";
import type { ProviderMode } from "@/server/provider-mode";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import { getAnnualReturnActionPermission } from "./permissions";
import type { AnnualReturnRepository } from "./repository";
import { hongKongBusinessDate } from "./workflow";
import { ReadinessConflictError } from "./readiness";
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
  caseId: z.string().uuid(),
  entityId: z.string().uuid(),
  expectedVersion: z.string().min(1).max(32_768),
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
  // listCases({}) is the 200 earliest-due cases, so every client past that row
  // was silently never chased at all. That is a correctness bug, not a display
  // one, and it is why this drains pages instead.
  const cases = await dependencies.annualReturnRepository.listAllCases({});
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
  identity: ProductionFollowUpIdentity & { expectedVersion: string },
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
  if (!currentCase.readiness?.sourceVersion || identity.expectedVersion !== draft.version)
    throw new ReadinessConflictError();
  if (draft.status === "unknown" || draft.status === "failed")
    throw new Error(
      "Follow-up requires provider reconciliation; do not retry an unknown or failed send from this draft.",
    );
  if (draft.status === "blocked" || !draft.recipientName || !draft.phone) {
    throw new Error("Follow-up is blocked because no persisted recipient is available.");
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
    actorAuthUserId: actor.authUserId,
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
      approvedByAuthUserId: actor.authUserId,
      approvalVersion: draft.version,
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

type SourceIdentityInput = { caseId: string; entityId: string; expectedVersion: string };

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
  input: ProductionFollowUpIdentity & { expectedVersion: string },
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

export async function withFollowUpVersionConflict<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command();
  } catch (error) {
    if (error instanceof ReadinessConflictError)
      throw new Response(
        JSON.stringify({
          code: "version_conflict",
          message:
            "Follow-up changed. Reload the full recipient and message preview before approval.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    throw error;
  }
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

export const listProductionFollowUpDrafts = createServerFn({ method: "GET" })
  .validator(z.undefined().or(z.object({}).strict()))
  .handler(async () => {
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
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      getSqlClient,
      createAnnualReturnRepository,
      createProductionFollowUpRepository,
      createWhatsAppRepository,
    } = await loadProductionFollowUpDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();
    const result = await withFollowUpVersionConflict(() =>
      sql.begin(async (tx) => {
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
      }),
    );
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
