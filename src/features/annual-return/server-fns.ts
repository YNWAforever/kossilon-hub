import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnRepository, CaseFilters } from "./repository";
import {
  assertAnnualReturnCaseVisible,
  caseFiltersForActor,
  isAnnualReturnCaseVisibleToActor,
} from "./permissions";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import {
  buildReminderDraft,
  completionBlockers,
  hongKongBusinessDate,
  isAllowedStatusTransition,
} from "./workflow";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase, type AnnualReturnStatus } from "./types";
import { queueAnnualReturnWhatsAppReminder } from "./whatsapp-reminders";

const RISK_LEVELS = ["green", "yellow", "orange", "red"] as const;
const CHECKLIST_STATUSES = ["Missing", "Received", "Verified", "Rejected"] as const;
const PAYMENT_STATUSES = [
  "Not invoiced",
  "Payment pending",
  "Payment received",
  "Overdue",
] as const;

const annualReturnStatusSchema = z.enum(ANNUAL_RETURN_STATUSES);
const listAnnualReturnCasesSchema = z
  .object({
    ownerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    reviewerId: z.string().uuid().optional(),
    risk: z.enum(RISK_LEVELS).optional(),
    status: annualReturnStatusSchema.optional(),
    missingDocuments: z.boolean().optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    overdueOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .default({});

const annualReturnCaseIdSchema = z.object({
  caseId: z.string().uuid(),
});
const assignOwnerSchema = z
  .object({
    caseId: z.string().uuid(),
    ownerId: z.string().uuid(),
  })
  .strict();
const addNoteSchema = z
  .object({
    caseId: z.string().uuid(),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();
export const queueAnnualReturnWhatsAppReminderSchema = z.object({
  caseId: z.string().uuid(),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(3),
});
const updateChecklistItemSchema = z
  .object({
    caseId: z.string().uuid(),
    itemId: z.string().uuid(),
    status: z.enum(CHECKLIST_STATUSES),
    documentId: z.string().uuid().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Verified" && !data.documentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentId"],
        message: "documentId is required when verifying a checklist item.",
      });
    }
  });
const updateFilingProofSchema = z
  .object({
    caseId: z.string().uuid(),
    filingReference: z.string().trim().min(1),
    confirmationDocumentId: z.string().uuid(),
  })
  .strict();

const updatePaymentSchema = z
  .object({
    caseId: z.string().uuid(),
    status: z.enum(PAYMENT_STATUSES),
    paymentProofDocumentId: z.string().uuid().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Payment received" && !data.paymentProofDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentProofDocumentId"],
        message: "paymentProofDocumentId is required when payment is received.",
      });
    }
  });

export type AnnualReturnCaseCommandDependencies = {
  repository: AnnualReturnRepository;
};

function requireStaffUserId(actor: AuthenticatedActor): string {
  const staff = assertStaffAccess(actor);

  if (!staff.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return staff.userId;
}

/**
 * The board's read. Scope is applied after the caller's filters so a
 * client-supplied teamId can never widen what the actor is allowed to see.
 */
export async function listAnnualReturnCasesForActor(
  actor: AuthenticatedActor,
  filters: CaseFilters,
  dependencies: { repository: Pick<AnnualReturnRepository, "listCases"> },
) {
  const scope = caseFiltersForActor({
    id: actor.userId,
    role: actor.role,
    teamId: actor.teamId,
    active: actor.active,
  });

  return dependencies.repository.listCases({ ...filters, ...scope });
}

/**
 * The tiles count exactly the cases the board would list. They used to be
 * firm-wide for every role, so a Staff user saw headline numbers spanning teams
 * whose cases they cannot open.
 */
export async function getAnnualReturnDashboardMetricsForActor(
  actor: AuthenticatedActor,
  dependencies: { repository: Pick<AnnualReturnRepository, "dashboardMetrics"> },
) {
  const scope = caseFiltersForActor(boardActorFrom(actor));
  return dependencies.repository.dashboardMetrics(
    hongKongBusinessDate(),
    actor.userId ?? "",
    scope,
  );
}

function boardActorFrom(actor: AuthenticatedActor) {
  return { id: actor.userId, role: actor.role, teamId: actor.teamId, active: actor.active };
}

/**
 * The detail read behind the board. Applies the same scope as
 * listAnnualReturnCasesForActor, so a case that does not appear on an actor's
 * board cannot be fetched by id either — which is what used to happen.
 *
 * An out-of-scope case reads as "not found" rather than "forbidden": the caller
 * has no business learning that a case with that id exists.
 */
export async function getAnnualReturnCaseForActor(
  actor: AuthenticatedActor,
  input: { id: string },
  dependencies: { repository: Pick<AnnualReturnRepository, "getCase"> },
) {
  const case_ = await dependencies.repository.getCase(input.id);
  if (!case_) return null;

  return isAnnualReturnCaseVisibleToActor(boardActorFrom(actor), case_) ? case_ : null;
}

export async function listAnnualReturnCaseNotesForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: { repository: Pick<AnnualReturnRepository, "getCase" | "listNotes"> },
) {
  const case_ = await dependencies.repository.getCase(input.caseId);

  if (!case_) {
    throw new Error("Annual return case not found.");
  }

  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);
  return dependencies.repository.listNotes(input.caseId);
}

export async function assignAnnualReturnCaseOwnerForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; ownerId: string },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = assignOwnerSchema.parse(input);
  return dependencies.repository.assignOwner({
    ...data,
    actorId: requireStaffUserId(actor),
  });
}

export async function addAnnualReturnCaseNoteForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; body: string },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = addNoteSchema.parse(input);
  return dependencies.repository.addNote({
    ...data,
    actorId: requireStaffUserId(actor),
  });
}

export async function updateAnnualReturnStatusForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; nextStatus: AnnualReturnStatus },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = z
    .object({
      caseId: z.string().uuid(),
      nextStatus: annualReturnStatusSchema,
    })
    .parse(input);
  const actorId = requireStaffUserId(actor);
  const current = await dependencies.repository.getCase(data.caseId);

  if (!current) {
    throw new Error("Annual return case not found.");
  }

  assertAnnualReturnStatusActionAllowed(current, data.nextStatus);
  return dependencies.repository.updateStatus(data.caseId, data.nextStatus, actorId);
}

export async function updateAnnualReturnChecklistItemForActor(
  actor: AuthenticatedActor,
  input: {
    caseId: string;
    itemId: string;
    status: (typeof CHECKLIST_STATUSES)[number];
    documentId: string | null;
  },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = updateChecklistItemSchema.parse(input);
  return dependencies.repository.updateChecklistItem({
    ...data,
    actorId: requireStaffUserId(actor),
  });
}

export async function updateAnnualReturnPaymentForActor(
  actor: AuthenticatedActor,
  input: {
    caseId: string;
    status: (typeof PAYMENT_STATUSES)[number];
    paymentProofDocumentId: string | null;
  },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = updatePaymentSchema.parse(input);
  return dependencies.repository.updatePayment({
    ...data,
    actorId: requireStaffUserId(actor),
  });
}

export async function updateAnnualReturnFilingProofForActor(
  actor: AuthenticatedActor,
  input: {
    caseId: string;
    filingReference: string;
    confirmationDocumentId: string;
  },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = updateFilingProofSchema.parse(input);
  return dependencies.repository.updateFilingProof({
    ...data,
    actorId: requireStaffUserId(actor),
  });
}

export type AnnualReturnReminderCommandDependencies = {
  annualReturnRepository: AnnualReturnRepository;
  whatsAppRepository: WhatsAppRepository;
};

export async function queueAnnualReturnWhatsAppReminderMessageForActor(
  actor: AuthenticatedActor,
  input: {
    caseId: string;
    recipientName: string;
    recipientPhone: string;
  },
  dependencies: AnnualReturnReminderCommandDependencies,
) {
  const data = queueAnnualReturnWhatsAppReminderSchema.parse(input);
  const actorId = requireStaffUserId(actor);
  const caseItem = await dependencies.annualReturnRepository.getCase(data.caseId);

  if (!caseItem) {
    throw new Error("Annual return case not found.");
  }

  const result = await queueAnnualReturnWhatsAppReminder({
    annualReturnRepository: dependencies.annualReturnRepository,
    whatsAppRepository: dependencies.whatsAppRepository,
    case_: caseItem,
    actorId,
    recipientName: data.recipientName,
    recipientPhone: data.recipientPhone,
    today: hongKongBusinessDate(),
  });

  return {
    caseId: result.case.id,
    remindersSent: result.case.remindersSent,
    currentStatus: result.case.currentStatus,
    messageId: result.message.id,
    messageStatus: result.message.status,
  };
}

export function assertAnnualReturnStatusActionAllowed(
  current: AnnualReturnCase,
  nextStatus: AnnualReturnStatus,
): void {
  if (nextStatus === "Completed") {
    const blockers = completionBlockers(current);

    if (blockers.length > 0) {
      throw new Error(blockers.map((blocker) => blocker.message).join(" "));
    }

    return;
  }

  if (!isAllowedStatusTransition(current.currentStatus, nextStatus)) {
    throw new Error(`Cannot move from ${current.currentStatus} to ${nextStatus}.`);
  }
}

const loadAnnualReturnServerDependencies = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { getCurrentAnnualReturnActor, getCurrentAnnualReturnActorId },
    { getSqlClient },
    { createAnnualReturnRepository },
    { createWhatsAppRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./session"),
    import("@/server/db/client"),
    import("./repository"),
    import("@/features/whatsapp/repository"),
  ]);
  return {
    getRequest,
    getCurrentAnnualReturnActor,
    getCurrentAnnualReturnActorId,
    getSqlClient,
    createAnnualReturnRepository,
    createWhatsAppRepository,
  };
});

async function withAnnualReturnRepository<T>(
  handler: (repository: AnnualReturnRepository, actorId: string) => Promise<T>,
): Promise<T> {
  const { getRequest, getCurrentAnnualReturnActorId, createAnnualReturnRepository } =
    await loadAnnualReturnServerDependencies();
  const actorId = await getCurrentAnnualReturnActorId(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actorId);
  } finally {
    await repository.close();
  }
}

async function withAnnualReturnActorRepository<T>(
  handler: (repository: AnnualReturnRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const { getRequest, getCurrentAnnualReturnActor, createAnnualReturnRepository } =
    await loadAnnualReturnServerDependencies();
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}
export const listAnnualReturnCases = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCasesForActor(actor, data, { repository }),
    ),
  );

export const getAnnualReturnCase = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      getAnnualReturnCaseForActor(actor, { id: data.id }, { repository }),
    ),
  );

export const getAnnualReturnDashboardMetrics = createServerFn({ method: "GET" }).handler(async () =>
  withAnnualReturnActorRepository((repository, actor) =>
    getAnnualReturnDashboardMetricsForActor(actor, { repository }),
  ),
);

export const assignAnnualReturnCaseOwner = createServerFn({ method: "POST" })
  .validator(assignOwnerSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      assignAnnualReturnCaseOwnerForActor(actor, data, { repository }),
    ),
  );
export const listAnnualReturnCaseNotes = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCaseNotesForActor(actor, data, { repository }),
    ),
  );

export const addAnnualReturnCaseNote = createServerFn({ method: "POST" })
  .validator(addNoteSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      addAnnualReturnCaseNoteForActor(actor, data, { repository }),
    ),
  );
export const updateAnnualReturnStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      nextStatus: annualReturnStatusSchema,
    }),
  )
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      updateAnnualReturnStatusForActor(actor, data, { repository }),
    ),
  );
export const recordAnnualReturnReminder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      templateLabel: z.string().min(1),
      recipientName: z.string().min(1),
      recipientPhone: z.string().min(3),
      draftBody: z.string().min(1),
      note: z.string().default(""),
    }),
  )
  .handler(async ({ data }) =>
    withAnnualReturnRepository(async (repository, actorId) => {
      // A write, so it takes the same mutation guard as every other case write
      // rather than the weaker "is some active staff member" it had before.
      await repository.assertCanMutateCase(data.caseId, actorId, "record_reminder");
      return repository.recordReminder({ ...data, actorId });
    }),
  );

export const queueAnnualReturnWhatsAppReminderMessage = createServerFn({ method: "POST" })
  .validator(queueAnnualReturnWhatsAppReminderSchema)
  .handler(async ({ data }) => {
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      getSqlClient,
      createAnnualReturnRepository,
      createWhatsAppRepository,
    } = await loadAnnualReturnServerDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();

    return sql.begin(async (tx) => {
      const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
      const whatsAppRepository = createWhatsAppRepository({ sql: tx });

      try {
        return await queueAnnualReturnWhatsAppReminderMessageForActor(actor, data, {
          annualReturnRepository,
          whatsAppRepository,
        });
      } finally {
        await annualReturnRepository.close();
        await whatsAppRepository.close();
      }
    });
  });
export const updateAnnualReturnChecklistItem = createServerFn({ method: "POST" })
  .validator(updateChecklistItemSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      updateAnnualReturnChecklistItemForActor(actor, data, { repository }),
    ),
  );
export const updateAnnualReturnPayment = createServerFn({ method: "POST" })
  .validator(updatePaymentSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      updateAnnualReturnPaymentForActor(actor, data, { repository }),
    ),
  );
export const updateAnnualReturnFilingProof = createServerFn({ method: "POST" })
  .validator(updateFilingProofSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      updateAnnualReturnFilingProofForActor(actor, data, { repository }),
    ),
  );
export const buildAnnualReturnReminderDraft = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(async ({ data }) =>
    withAnnualReturnActorRepository(async (repository, actor) => {
      const case_ = await getAnnualReturnCaseForActor(actor, { id: data.caseId }, { repository });

      if (!case_) {
        throw new Error("Annual return case not found.");
      }

      return { draftBody: buildReminderDraft(case_, "貴公司", hongKongBusinessDate()) };
    }),
  );
