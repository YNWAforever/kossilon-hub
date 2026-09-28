import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertCorporateChangeRequestWritable } from "./authorization";
import type { CorporateChangeRequestRepository } from "./repository";
import type { CreateCorporateChangeRequestInput } from "./types";

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

const baseCreateSchema = z.object({
  companyId: z.string().uuid(),
  quotedFee: z.number().nonnegative(),
});

const createNameChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("name_change"),
  newNameEn: z.string().min(1),
  newNameZh: z.string().nullable(),
});

const createShareTransferSchema = baseCreateSchema.extend({
  changeType: z.literal("share_transfer"),
  transferorShareholdingId: z.string().uuid(),
  sharesTransferred: z.number().int().positive(),
  consideration: z.number().nonnegative(),
  stampDutyAmount: z.number().nonnegative(),
  transfereeShareholdingId: z.string().uuid().nullable(),
  transfereeNewShareholderName: z.string().nullable(),
  transfereeNewShareholderAddress: z.string().nullable(),
});

const createOfficerChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("officer_change"),
  officerAction: z.enum(["appoint", "resign", "detail_change"]),
  officerId: z.string().uuid().nullable(),
  newOfficerType: z.enum(["director", "secretary"]).nullable(),
  newOfficerName: z.string().nullable(),
  newOfficerIdentificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
  newOfficerIdentificationNumber: z.string().nullable(),
  newOfficerAddress: z.string().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createAddressChangeSchema = baseCreateSchema.extend({
  changeType: z.literal("address_change"),
  newRegisteredOffice: z.string().min(1),
});

// zod v3's discriminatedUnion introspects each member's `.shape`, so members must stay plain
// ZodObjects — a `.refine()` on `createShareTransferSchema` would return a ZodEffects with no
// `.shape` and crash discriminatedUnion at schema-construction time. The "exactly one of an
// existing transferee or a new shareholder name" cross-field check is applied afterwards, via
// superRefine on the assembled union, and only when the branch is share_transfer.
export const createCorporateChangeRequestSchema = z
  .discriminatedUnion("changeType", [
    createNameChangeSchema,
    createShareTransferSchema,
    createOfficerChangeSchema,
    createAddressChangeSchema,
  ])
  .superRefine((input, ctx) => {
    if (
      input.changeType === "share_transfer" &&
      Boolean(input.transfereeShareholdingId) === Boolean(input.transfereeNewShareholderName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of an existing transferee or a new shareholder name.",
        path: ["transfereeShareholdingId"],
      });
    }
  });

export const createCorporateChangeRequest = createServerFn({ method: "POST" })
  .validator(createCorporateChangeRequestSchema)
  .handler(async ({ data }) =>
    withRepository(async (repository) => {
      const actorId = await requireWritableRequestCompany(repository, data.companyId);
      return repository.createRequest({
        ...data,
        actorId,
      } as CreateCorporateChangeRequestInput);
    }),
  );

const updateChecklistItemStatusSchema = z.object({
  requestId: z.string().uuid(),
  itemId: z.string().uuid(),
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
  requestId: z.string().uuid(),
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

const requestIdSchema = z.object({ requestId: z.string().uuid() });

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
      if (actor.role !== "Admin" && !actor.teamId) {
        throw new Error("Forbidden: staff actor has no assigned team.");
      }
      return repository.listRequests({
        ...data,
        teamId: actor.role === "Admin" ? undefined : (actor.teamId ?? undefined),
      });
    }),
  );

export const getCorporateChangeRequest = createServerFn({ method: "GET" })
  .validator(z.object({ requestId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultCorporateChangeContext();
    await requireStaffActor(getRequest());
    return withRepository(async (repository) => {
      const request = await repository.getRequest(data.requestId);
      await requireWritableRequestCompany(repository, request.companyId);
      return request;
    });
  });
