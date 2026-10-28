import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertCorporateChangeRequestWritable } from "./authorization";
import {
  corporateChangeListTeamScope,
  getCorporateChangeRequestForActor,
  listCorporateChangeRequestPageForActor,
} from "./read";
import { caseListQuerySchema } from "@/features/incorporation/case-list-query";
import { incorporationReadScope } from "@/features/incorporation/authorization";
import type { CorporateChangeRequestRepository } from "./repository";
import { createCorporateChangeRequestSchema } from "./create-input";
import { createCorporateChangeRequestForActor } from "./create";
export { createCorporateChangeRequestSchema } from "./create-input";

const loadDefaultCorporateChangeContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createCorporateChangeRequestRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return { getRequest, requireStaffActor, createCorporateChangeRequestRepository };
});

async function getCurrentCorporateChangeActor(): Promise<AuthenticatedActor & { userId: string }> {
  const { getRequest, requireStaffActor } = await loadDefaultCorporateChangeContext();
  const actor = await requireStaffActor(getRequest());

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}

async function withRepository<T>(
  handler: (repository: CorporateChangeRequestRepository) => Promise<T>,
): Promise<T> {
  const { createCorporateChangeRequestRepository } = await loadDefaultCorporateChangeContext();
  const repository = createCorporateChangeRequestRepository();
  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

async function requireWritableRequestCompany(
  repository: CorporateChangeRequestRepository,
  companyId: string,
): Promise<string> {
  const actor = await getCurrentCorporateChangeActor();
  const teamId = await repository.getCompanyTeamId(companyId);
  assertCorporateChangeRequestWritable(actor, { assignedTeamId: teamId });
  return actor.userId;
}

export const createCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(createCorporateChangeRequestSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentCorporateChangeActor();
    return withRepository((repository) =>
      createCorporateChangeRequestForActor(actor, data, { repository }),
    );
  });

const updateChecklistItemStatusSchema = z.object({
  requestId: z.string().guid(),
  itemId: z.string().guid(),
  status: z.enum(["Missing", "Received", "Verified", "Rejected"]),
  note: z.string().nullable(),
});

export const updateCorporateChangeChecklistItemStatus = createServerFn({ method: "POST" })
  .validator(updateChecklistItemStatusSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actorId = await requireWritableRequestCompany(repository, request.companyId);
      return repository.updateChecklistItemStatus({ ...data, actorId });
    }),
  );

const transitionStatusSchema = z.object({
  requestId: z.string().guid(),
  toStatus: z.enum([
    "Requested",
    "Documents pending",
    "Ready to file",
    "Filed with Registrar",
    "Completed",
    "Cancelled",
  ]),
});

export const transitionCorporateChangeRequestStatus = createServerFn({ method: "POST" })
  .validator(transitionStatusSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actorId = await requireWritableRequestCompany(repository, request.companyId);
      return repository.transitionStatus({ ...data, actorId });
    }),
  );

const requestIdSchema = z.object({ requestId: z.string().guid() });

export const cancelCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actorId = await requireWritableRequestCompany(repository, request.companyId);
      return repository.cancelRequest({ ...data, actorId });
    }),
  );

export const completeCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(requestIdSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      const actorId = await requireWritableRequestCompany(repository, request.companyId);
      return repository.completeRequest({ ...data, actorId });
    }),
  );

const listSchema = z.object({
  changeType: z
    .enum(["name_change", "share_transfer", "officer_change", "address_change"])
    .optional(),
  status: z
    .enum([
      "Requested",
      "Documents pending",
      "Ready to file",
      "Filed with Registrar",
      "Completed",
      "Cancelled",
    ])
    .optional(),
});

export const listCorporateChangeRequests = createServerFn({ method: "GET" })
  .validator(listSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const { getRequest, requireStaffActor } = await loadDefaultCorporateChangeContext();
      const actor = await requireStaffActor(getRequest());
      return repository.listRequests({
        ...data,
        teamId: corporateChangeListTeamScope(actor),
      });
    }),
  );

export const listCorporateChangeRequestPage = createServerFn({ method: "GET" })
  .validator(caseListQuerySchema)
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultCorporateChangeContext();
    const actor = await requireStaffActor(getRequest());
    incorporationReadScope(actor, data.teamId);
    return withRepository((repository) =>
      listCorporateChangeRequestPageForActor(actor, data, { repository }),
    );
  });

export const getCorporateChangeRequest = createServerFn({ method: "GET" })
  .validator(z.object({ requestId: z.string().guid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultCorporateChangeContext();
    const actor = await requireStaffActor(getRequest());
    return withRepository((repository) =>
      getCorporateChangeRequestForActor(actor, data.requestId, { repository }),
    );
  });
