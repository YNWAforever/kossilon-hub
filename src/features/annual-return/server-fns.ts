import { entityIdSchema } from "@/features/runtime/entity-id";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type {
  AnnualReturnRepository,
  AssignableStaffMember,
  CaseFilters,
  EligibleCompanyForCase,
} from "./repository";
import {
  assertAnnualReturnCaseVisible,
  caseFiltersForActor,
  isAnnualReturnCaseVisibleToActor,
} from "./permissions";
import { mergeCaseHistory, type CaseHistoryEntry } from "./case-history";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import {
  buildReminderDraft,
  completionBlockers,
  hongKongBusinessDate,
  isAllowedStatusTransition,
} from "./workflow";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase, type AnnualReturnStatus } from "./types";
import { queueAnnualReturnWhatsAppReminder } from "./whatsapp-reminders";
import { deriveWorkViews } from "./work-views";
import { listReturnExceptionsForScopedCases, type ReturnRecord } from "./return-service";
import type { DocumentFindingsView } from "@/features/documents/findings-review";
import type { DocumentAnalysisRepository } from "@/features/documents/analysis-repository";

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
    ownerId: entityIdSchema.optional(),
    teamId: entityIdSchema.optional(),
    reviewerId: entityIdSchema.optional(),
    risk: z.enum(RISK_LEVELS).optional(),
    status: annualReturnStatusSchema.optional(),
    missingDocuments: z.boolean().optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    overdueOnly: z.boolean().optional(),
    // Bounded so a caller cannot ask for the whole table in one request, and
    // trimmed so a whitespace-only search is the same as no search.
    q: z.string().trim().min(1).max(120).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .default({});

const annualReturnCaseIdSchema = z.object({
  caseId: entityIdSchema,
});
const assignOwnerSchema = z
  .object({
    caseId: entityIdSchema,
    ownerId: entityIdSchema,
  })
  .strict();
const addNoteSchema = z
  .object({
    caseId: entityIdSchema,
    body: z.string().trim().min(1).max(2000),
  })
  .strict();
export const queueAnnualReturnWhatsAppReminderSchema = z.object({
  caseId: entityIdSchema,
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(3),
});
const updateChecklistItemSchema = z
  .object({
    caseId: entityIdSchema,
    itemId: entityIdSchema,
    status: z.enum(CHECKLIST_STATUSES),
    documentId: entityIdSchema.nullable(),
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
    caseId: entityIdSchema,
    filingReference: z.string().trim().min(1),
    confirmationDocumentId: entityIdSchema,
  })
  .strict();

const updatePaymentSchema = z
  .object({
    caseId: entityIdSchema,
    status: z.enum(PAYMENT_STATUSES),
    paymentProofDocumentId: entityIdSchema.nullable(),
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

const createAnnualReturnCaseSchema = z
  .object({
    companyId: entityIdSchema,
    templateId: entityIdSchema,
    ownerId: entityIdSchema,
    invoiceNumber: z.string().trim().min(1),
    feeAmount: z.number().int().positive(),
  })
  .strict();

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
 * A page of the board, scoped identically to listAnnualReturnCasesForActor.
 *
 * The scope is applied after the caller's filters, so a client-supplied
 * companyId or ownerId can narrow within an actor's reach but never widen past
 * it -- the same ordering the list read already uses.
 */
export async function listAnnualReturnCasePageForActor(
  actor: AuthenticatedActor,
  filters: CaseFilters,
  dependencies: { repository: Pick<AnnualReturnRepository, "listCasePage"> },
) {
  const scope = caseFiltersForActor({
    id: actor.userId,
    role: actor.role,
    teamId: actor.teamId,
    active: actor.active,
  });

  return dependencies.repository.listCasePage({ ...filters, ...scope });
}

/**
 * Board tiles counted in SQL across the actor's whole scope.
 *
 * They were computed in the browser over the same truncated page the board
 * rendered, so "12 overdue" meant "12 overdue among the 200 cases we loaded".
 */
export async function getAnnualReturnBoardTotalsForActor(
  actor: AuthenticatedActor,
  filters: CaseFilters,
  dependencies: { repository: Pick<AnnualReturnRepository, "boardTotals"> },
) {
  const scope = caseFiltersForActor({
    id: actor.userId,
    role: actor.role,
    teamId: actor.teamId,
    active: actor.active,
  });

  return dependencies.repository.boardTotals({ ...filters, ...scope });
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

export async function listCompaniesEligibleForCaseForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: { repository: Pick<AnnualReturnRepository, "listCompaniesEligibleForCase"> },
): Promise<EligibleCompanyForCase[]> {
  requireStaffUserId(actor);
  const companies = await dependencies.repository.listCompaniesEligibleForCase();

  // Admin unrestricted; Manager/Staff only ever see companies they could
  // actually submit for — matches assertAnnualReturnCaseCreatable's policy
  // exactly, so the picker never offers a company that would just bounce
  // back with a Forbidden error after the whole form is filled out.
  if (actor.role === "Admin") {
    return companies;
  }

  return companies.filter((company) => company.assignedTeamId === actor.teamId);
}

export async function createAnnualReturnCaseForActor(
  actor: AuthenticatedActor,
  input: {
    companyId: string;
    templateId: string;
    ownerId: string;
    invoiceNumber: string;
    feeAmount: number;
  },
  dependencies: AnnualReturnCaseCommandDependencies,
) {
  const data = createAnnualReturnCaseSchema.parse(input);
  return dependencies.repository.createCase({
    ...data,
    actorId: requireStaffUserId(actor),
  });
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

/**
 * Findings on a case, and the run state that says whether silence means
 * anything.
 *
 * The case is loaded and checked first, and the analysis repository is only
 * touched once it is visible: findings quote a document's own text, so reaching
 * them at all is a decision about who may read the case.
 */
/**
 * The parties to a filing, seeded from the officer register on first read.
 *
 * Seeded here rather than at case creation because the register changes: a
 * director appointed after the case was opened would otherwise never become a
 * candidate. The seed is insert-only and idempotent, so reading this repeatedly
 * costs nothing and never disturbs a party somebody has confirmed.
 */
export async function listAnnualReturnCasePartiesForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: {
    repository: Pick<
      AnnualReturnRepository,
      "getCase" | "syncCasePartiesFromOfficers" | "listCaseParties"
    >;
  },
) {
  requireStaffUserId(actor);
  const case_ = await dependencies.repository.getCase(input.caseId);
  if (!case_) throw new Error("Annual return case not found.");
  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);

  await dependencies.repository.syncCasePartiesFromOfficers(input.caseId);
  return dependencies.repository.listCaseParties(input.caseId);
}

/**
 * A person confirms that a candidate really is a party to this filing.
 *
 * `confirmedByUserId` comes from the actor, never the caller: the whole value of
 * the field is that it names who decided. The requirements that party owes are
 * created in the same transaction as the confirmation.
 */
export async function confirmAnnualReturnCasePartyForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; partyId: string },
  dependencies: {
    repository: Pick<AnnualReturnRepository, "getCase" | "confirmCaseParty">;
  },
) {
  const confirmedByUserId = requireStaffUserId(actor);
  const case_ = await dependencies.repository.getCase(input.caseId);
  if (!case_) throw new Error("Annual return case not found.");
  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);

  return dependencies.repository.confirmCaseParty({
    caseId: input.caseId,
    partyId: input.partyId,
    confirmedByUserId,
  });
}

export async function listAnnualReturnCaseFindingsForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: {
    repository: Pick<AnnualReturnRepository, "getCase">;
    analysis: { listFindingsForCase(caseId: string): Promise<DocumentFindingsView[]> };
  },
) {
  const case_ = await dependencies.repository.getCase(input.caseId);
  if (!case_) throw new Error("Annual return case not found.");
  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);

  return dependencies.analysis.listFindingsForCase(input.caseId);
}

/**
 * A person deals with a finding.
 *
 * Two independent checks, deliberately. The case must be visible to this actor,
 * and the write itself joins the case in so a finding from another case cannot
 * be resolved by pairing its id with a caseId this actor happens to be allowed
 * to see.
 *
 * `resolvedByUserId` comes from the actor, never from the caller.
 */
export async function resolveAnnualReturnCaseFindingForActor(
  actor: AuthenticatedActor,
  input: { caseId: string; findingId: string; note: string | null },
  dependencies: {
    repository: Pick<AnnualReturnRepository, "getCase">;
    analysis: {
      resolveFinding(input: {
        findingId: string;
        caseId: string;
        resolvedByUserId: string;
        note: string | null;
      }): Promise<boolean>;
    };
  },
) {
  // Staff, and a real user row. A resolution is the record of who decided, so an
  // actor with no staff user id must not be able to make one -- it would either
  // violate the resolved_by/resolved_at constraint or, worse, record a decision
  // attributable to nobody.
  const resolvedByUserId = requireStaffUserId(actor);

  const case_ = await dependencies.repository.getCase(input.caseId);
  if (!case_) throw new Error("Annual return case not found.");
  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);

  const applied = await dependencies.analysis.resolveFinding({
    findingId: input.findingId,
    caseId: input.caseId,
    resolvedByUserId,
    note: input.note,
  });

  // False means somebody else resolved it first, or it does not belong to this
  // case. Reported rather than thrown: the reviewer's intent is satisfied either
  // way, and the refreshed list shows whose decision stands.
  return { applied };
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

export async function listAnnualReturnCaseHistoryForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: {
    repository: Pick<
      AnnualReturnRepository,
      "getCase" | "listAuditEventsForCase" | "listAssignmentEventsForCase"
    >;
  },
): Promise<CaseHistoryEntry[]> {
  const case_ = await dependencies.repository.getCase(input.caseId);

  if (!case_) {
    throw new Error("Annual return case not found.");
  }

  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);

  const [auditEvents, assignmentEvents] = await Promise.all([
    dependencies.repository.listAuditEventsForCase(input.caseId),
    dependencies.repository.listAssignmentEventsForCase(input.caseId),
  ]);

  return mergeCaseHistory(auditEvents, assignmentEvents);
}

/**
 * The people this actor may name as an owner or reviewer.
 *
 * Scoped identically to listCompaniesEligibleForCaseForActor and to
 * getAnnualReturnActionPermission itself, so the picker never offers someone the
 * assignment would then be refused for.
 */
export async function listAssignableStaffForActor(
  actor: AuthenticatedActor,
  _input: Record<string, never>,
  dependencies: { repository: Pick<AnnualReturnRepository, "listAssignableStaff"> },
): Promise<AssignableStaffMember[]> {
  requireStaffUserId(actor);
  if (actor.role === "Admin") return dependencies.repository.listAssignableStaff({});
  if (!actor.teamId) throw new Error("Forbidden: staff actor has no assigned team.");
  return dependencies.repository.listAssignableStaff({ teamId: actor.teamId });
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
      caseId: entityIdSchema,
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
  if (nextStatus === "NAR1 prepared" || nextStatus === "Filed") {
    throw new Error("Package approval and filing proof use their dedicated audited workflows.");
  }

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
  .validator(z.object({ id: entityIdSchema }))
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

/**
 * Requirement instances for one case, scoped by the same visibility rule as the
 * case itself so a requirement read cannot reach a case the board would hide.
 */
export async function listAnnualReturnCaseRequirementsForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: {
    repository: Pick<AnnualReturnRepository, "getCase" | "listCaseRequirements">;
  },
) {
  const case_ = await dependencies.repository.getCase(input.caseId);
  if (!case_) throw new Error("Annual return case not found.");
  assertAnnualReturnCaseVisible(
    { id: actor.userId, role: actor.role, teamId: actor.teamId, active: actor.active },
    case_,
  );
  return dependencies.repository.listCaseRequirements(input.caseId);
}

export const listAnnualReturnCaseRequirements = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCaseRequirementsForActor(actor, data, { repository }),
    ),
  );

/**
 * The five daily work views, derived on the server.
 *
 * Server-side because the views need the viewer's own staff id to separate "work
 * on my cases" from "work anywhere", and because they read every case in scope --
 * listAllCases drains pages, so a firm past the old 200-row window does not
 * silently lose the back half of its day.
 */
export async function getAnnualReturnWorkViewsForActor(
  actor: AuthenticatedActor,
  dependencies: {
    repository: Pick<AnnualReturnRepository, "listAllCases">;
    loadReturnExceptions?: (caseIds: readonly string[]) => Promise<ReturnRecord[]>;
  },
) {
  const scope = caseFiltersForActor({
    id: actor.userId,
    role: actor.role,
    teamId: actor.teamId,
    active: actor.active,
  });
  const cases = await dependencies.repository.listAllCases(scope);
  const exceptions = dependencies.loadReturnExceptions
    ? await dependencies.loadReturnExceptions(cases.map((case_) => case_.id))
    : null;
  const counts = new Map<string, number>();
  for (const entry of exceptions ?? []) {
    counts.set(entry.caseId, (counts.get(entry.caseId) ?? 0) + 1);
  }
  return deriveWorkViews(
    cases,
    hongKongBusinessDate(),
    { userId: actor.userId },
    undefined,
    exceptions ? { complete: true, openCountByCaseId: counts } : undefined,
  );
}

export const getAnnualReturnWorkViews = createServerFn({ method: "GET" }).handler(() =>
  withAnnualReturnActorRepository((repository, actor) =>
    getAnnualReturnWorkViewsForActor(actor, {
      repository,
      loadReturnExceptions: (caseIds) => listReturnExceptionsForScopedCases(caseIds),
    }),
  ),
);

export const listAnnualReturnCasePage = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCasePageForActor(actor, data, { repository }),
    ),
  );

export const getAnnualReturnBoardTotals = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      getAnnualReturnBoardTotalsForActor(actor, data, { repository }),
    ),
  );

export const listCompaniesEligibleForCase = createServerFn({ method: "GET" }).handler(() =>
  withAnnualReturnActorRepository((repository, actor) =>
    listCompaniesEligibleForCaseForActor(actor, {}, { repository }),
  ),
);

export const listAssignableStaff = createServerFn({ method: "GET" }).handler(() =>
  withAnnualReturnActorRepository((repository, actor) =>
    listAssignableStaffForActor(actor, {}, { repository }),
  ),
);

export const createAnnualReturnCase = createServerFn({ method: "POST" })
  .validator(createAnnualReturnCaseSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      createAnnualReturnCaseForActor(actor, data, { repository }),
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

export const listAnnualReturnCaseHistory = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCaseHistoryForActor(actor, data, { repository }),
    ),
  );

async function withAnalysisRepository<T>(
  handler: (analysis: DocumentAnalysisRepository) => Promise<T>,
): Promise<T> {
  const { createDocumentAnalysisRepository } =
    await import("@/features/documents/analysis-repository");
  const analysis = createDocumentAnalysisRepository();
  try {
    return await handler(analysis);
  } finally {
    await analysis.close();
  }
}

export const listAnnualReturnCaseParties = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCasePartiesForActor(actor, data, { repository }),
    ),
  );

export const confirmAnnualReturnCaseParty = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: entityIdSchema, partyId: entityIdSchema }))
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      confirmAnnualReturnCasePartyForActor(actor, data, { repository }),
    ),
  );

export const listAnnualReturnCaseFindings = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      withAnalysisRepository((analysis) =>
        listAnnualReturnCaseFindingsForActor(actor, data, { repository, analysis }),
      ),
    ),
  );

export const resolveAnnualReturnCaseFinding = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: entityIdSchema,
      findingId: entityIdSchema,
      // Bounded: this is a person's note, not a place to paste a document.
      note: z.string().trim().min(1).max(1000).nullable().default(null),
    }),
  )
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      withAnalysisRepository((analysis) =>
        resolveAnnualReturnCaseFindingForActor(actor, data, { repository, analysis }),
      ),
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
      caseId: entityIdSchema,
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
      caseId: entityIdSchema,
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
