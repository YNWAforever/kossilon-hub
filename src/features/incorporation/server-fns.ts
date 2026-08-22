import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertIncorporationCaseCreatable,
  assertIncorporationCaseWritable,
} from "./authorization";
import type { IncorporationRepository } from "./repository";

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
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  targetCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateChecklistItemSchema = z.object({
  caseId: z.string().uuid(),
  itemId: z.string().uuid(),
  status: z.enum(["Missing", "Received", "Verified", "Rejected"]),
  note: z.string().nullable(),
});

const updateCaseStatusSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(["Intake", "Documents pending", "Ready to file", "Filed with Registrar", "Completed"]),
});

const completeCaseSchema = z.object({
  caseId: z.string().uuid(),
  crNumber: z.string().min(1),
  brNumber: z.string().min(1),
  incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const listIncorporationCases = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
  await requireStaffActor(getRequest());
  return withIncorporationRepository((repository) => repository.listCases());
});

export const getIncorporationCase = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultIncorporationContext();
    await requireStaffActor(getRequest());
    return withIncorporationRepository((repository) => repository.getCase(data.id));
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

export const updateIncorporationChecklistItem = createServerFn({ method: "POST" })
  .validator(updateChecklistItemSchema)
  .handler(async ({ data }) =>
    withIncorporationRepository(async (repository) =>
      repository.updateChecklistItem({
        ...data,
        actorId: await requireWritableCase(repository, data.caseId),
      }),
    ),
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
