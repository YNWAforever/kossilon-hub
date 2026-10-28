import {
  BR_NUMBER_MESSAGE,
  CR_NUMBER_MESSAGE,
  isValidBrNumber,
  isValidCrNumber,
  normalizeBrNumber,
  normalizeCrNumber,
} from "@/features/clients/identifiers";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertIncorporationCaseCreatable,
  assertIncorporationCaseWritable,
  incorporationReadScope,
} from "./authorization";
import {
  getIncorporationCaseForActor,
  listIncorporationCasesForActor,
  listIncorporationCasePageForActor,
} from "./read";
import { caseListQuerySchema } from "./case-list-query";
import type { IncorporationRepository } from "./repository";
import { INCORPORATION_STATUSES } from "./types";

const loadDefaultIncorporationContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createIncorporationRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return { getRequest, requireStaffActor, createIncorporationRepository };
});

async function getCurrentIncorporationActor(): Promise<AuthenticatedActor & { userId: string }> {
  const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
  const actor = await requireStaffActor(getRequest());

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}

async function requireWritableCase(
  repository: IncorporationRepository,
  caseId: string,
): Promise<string> {
  const actor = await getCurrentIncorporationActor();
  const teamId = await repository.getCaseTeamId(caseId);

  if (!teamId) {
    throw new Error("Incorporation case not found.");
  }

  assertIncorporationCaseWritable(actor, { teamId });
  return actor.userId;
}

async function withIncorporationRepository<T>(
  handler: (repository: IncorporationRepository) => Promise<T>,
): Promise<T> {
  const { createIncorporationRepository } = await loadDefaultIncorporationContext();
  const repository = createIncorporationRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

const createCaseSchema = z.object({
  proposedCompanyNameEn: z.string().min(1),
  proposedCompanyNameZh: z.string().nullable(),
  proposedRegisteredOffice: z.string().min(1),
  proposedCompanySecretary: z.string().min(1),
  registeredCapital: z.number().int().positive(),
  businessNature: z.string().min(1),
  ownerId: z.string().guid(),
  teamId: z.string().guid(),
  targetCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateChecklistItemSchema = z.object({
  caseId: z.string().guid(),
  itemId: z.string().guid(),
  status: z.enum(["Missing", "Received", "Verified", "Rejected"]),
  note: z.string().nullable(),
});

const updateCaseStatusSchema = z.object({
  caseId: z.string().guid(),
  status: z.enum(INCORPORATION_STATUSES),
});

const completeCaseSchema = z.object({
  caseId: z.string().guid(),
  crNumber: z.string().transform(normalizeCrNumber).refine(isValidCrNumber, CR_NUMBER_MESSAGE),
  brNumber: z.string().transform(normalizeBrNumber).refine(isValidBrNumber, BR_NUMBER_MESSAGE),
  incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const listCasesSchema = z
  .object({
    teamId: z.string().guid().optional(),
    ownerId: z.string().guid().optional(),
    q: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()
  .optional();

export const listIncorporationCases = createServerFn({ method: "GET" })
  .validator(listCasesSchema)
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
    const actor = await requireStaffActor(getRequest());
    incorporationReadScope(actor, data?.teamId);
    return withIncorporationRepository((repository) =>
      listIncorporationCasesForActor(actor, data ?? {}, { repository }),
    );
  });

export const listIncorporationCasePage = createServerFn({ method: "GET" })
  .validator(caseListQuerySchema)
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
    const actor = await requireStaffActor(getRequest());
    incorporationReadScope(actor, data.teamId);
    return withIncorporationRepository((repository) =>
      listIncorporationCasePageForActor(actor, data, { repository }),
    );
  });

export const getIncorporationCase = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().guid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
    const actor = await requireStaffActor(getRequest());
    incorporationReadScope(actor);
    return withIncorporationRepository((repository) =>
      getIncorporationCaseForActor(actor, data.id, { repository }),
    );
  });

export const createIncorporationCase = createServerFn({ method: "POST" })
  .validator(createCaseSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) => {
      const actor = await getCurrentIncorporationActor();
      assertIncorporationCaseCreatable(actor, { teamId: data.teamId });
      return repository.createCase({ ...data, actorId: actor.userId });
    }),
  );

/** Test seam for the existing command; request authentication stays in the native handler. */
export async function updateIncorporationChecklistItemForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repository: Pick<IncorporationRepository, "getCaseTeamId" | "updateChecklistItem">,
) {
  const data = updateChecklistItemSchema.parse(input);
  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }
  const teamId = await repository.getCaseTeamId(data.caseId);
  if (!teamId) {
    throw new Error("Incorporation case not found.");
  }
  assertIncorporationCaseWritable(actor, { teamId });
  return repository.updateChecklistItem({ ...data, actorId: actor.userId });
}

export const updateIncorporationChecklistItem = createServerFn({ method: "POST" })
  .validator(updateChecklistItemSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) => {
      const actor = await getCurrentIncorporationActor();
      return updateIncorporationChecklistItemForActor(actor, data, repository);
    }),
  );

export const updateIncorporationCaseStatus = createServerFn({ method: "POST" })
  .validator(updateCaseStatusSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) =>
      repository.updateCaseStatus({
        ...data,
        actorId: await requireWritableCase(repository, data.caseId),
      }),
    ),
  );

export const completeIncorporationCase = createServerFn({ method: "POST" })
  .validator(completeCaseSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) =>
      repository.completeCase({
        ...data,
        actorId: await requireWritableCase(repository, data.caseId),
      }),
    ),
  );
