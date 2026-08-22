import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthDependencies } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertClientCompanyCreatable, assertClientCompanyWritable } from "./authorization";
import type { ClientRepository } from "./repository";

const loadDefaultClientContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createClientRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  return { getRequest, requireStaffActor, createClientRepository };
});

/**
 * Resolves the staff user id every client write is attributed to. Mirrors
 * getCurrentAnnualReturnActorId — a Neon Auth session alone is not enough, the
 * actor must also have a staff row in the database to own a timeline event.
 */
async function getCurrentClientActor(
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor & { userId: string }> {
  const { getRequest, requireStaffActor } = await loadDefaultClientContext();
  const actor = await requireStaffActor(getRequest(), dependencies);

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}

/**
 * Resolves the acting staff member and checks they may write to this company.
 * Reads stay firm-wide — the register doubles as a directory — but a Staff or
 * Manager user can no longer rename, reassign or re-contact another team's client.
 */
async function requireWritableCompany(
  repository: ClientRepository,
  companyId: string,
  /**
   * The team the write would MOVE the company to, when it can move one.
   *
   * Checking only the current team leaves the scope trivially escapable: a Staff
   * user cannot edit another team's client, but updateClient accepts a teamId, so
   * they could take their own client and reassign it into any team they liked —
   * out of their own scope and into someone else's, unreviewed.
   */
  targetTeamId?: string,
): Promise<string> {
  const actor = await getCurrentClientActor();
  const assignedTeamId = await repository.getCompanyTeamId(companyId);

  if (!assignedTeamId) {
    throw new Error("Client company not found.");
  }

  assertClientCompanyWritable(actor, { assignedTeamId });

  if (targetTeamId !== undefined && targetTeamId !== assignedTeamId) {
    assertClientCompanyWritable(actor, { assignedTeamId: targetTeamId });
  }

  return actor.userId;
}

const contactSchema = z
  .object({
    name: z.string().min(1),
    role: z.string().min(1),
    email: z.string().email().nullable(),
    phone: z.string().min(3).nullable(),
    isPrimary: z.boolean(),
  })
  .refine((contact) => contact.email !== null || contact.phone !== null, {
    message: "Provide an email or a phone number.",
    path: ["email"],
  });

const createClientSchema = z.object({
  companyName: z.string().min(1),
  crNumber: z.string().min(1),
  brNumber: z.string().min(1),
  incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  annualReturnBasisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  registeredOffice: z.string().min(1),
  companySecretary: z.string().min(1),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
  contacts: z.array(contactSchema).default([]),
});

const updateClientSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string().min(1),
  registeredOffice: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  ownerId: z.string().uuid(),
  teamId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
});

const addContactSchema = z.object({ companyId: z.string().uuid() }).and(contactSchema);

const updateContactSchema = z
  .object({ companyId: z.string().uuid(), contactId: z.string().uuid() })
  .and(contactSchema);

const removeContactSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid(),
});

const appointOfficerSchema = z
  .object({
    companyId: z.string().uuid(),
    officerType: z.enum(["director", "secretary", "designated_representative"]),
    name: z.string().min(1),
    identificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
    identificationNumber: z.string().nullable(),
    address: z.string().nullable(),
    appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine(
    (officer) => (officer.identificationType === null) === (officer.identificationNumber === null),
    {
      message: "Provide both an identification type and number, or neither.",
      path: ["identificationNumber"],
    },
  );

const ceaseOfficerSchema = z.object({
  companyId: z.string().uuid(),
  officerId: z.string().uuid(),
  cessationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const recordShareholdingSchema = z.object({
  companyId: z.string().uuid(),
  shareholderName: z.string().min(1),
  shareholderAddress: z.string().nullable(),
  shareClass: z.string().min(1),
  numberOfShares: z.number().int().positive(),
  allotmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ceaseShareholdingSchema = z.object({
  companyId: z.string().uuid(),
  shareholdingId: z.string().uuid(),
  cessationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const controlBasisSchema = z.enum([
  "shares_over_25pct",
  "votes_over_25pct",
  "board_appointment_right",
  "significant_influence",
]);

const recordControllerSchema = z
  .object({
    companyId: z.string().uuid(),
    controllerName: z.string().min(1),
    identificationType: z.enum(["hkid", "passport", "br_number"]).nullable(),
    identificationNumber: z.string().nullable(),
    address: z.string().nullable(),
    controlBases: z.array(controlBasisSchema).min(1),
    registeredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    registerUpdateDueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .refine(
    (controller) =>
      (controller.identificationType === null) === (controller.identificationNumber === null),
    {
      message: "Provide both an identification type and number, or neither.",
      path: ["identificationNumber"],
    },
  )
  .refine(
    (controller) =>
      controller.registerUpdateDueDate === null ||
      controller.registerUpdateDueDate >= controller.registeredDate,
    {
      message: "Register update due date cannot be before the registered date.",
      path: ["registerUpdateDueDate"],
    },
  );

const updateControllerParticularsSchema = z.object({
  companyId: z.string().uuid(),
  controllerId: z.string().uuid(),
  address: z.string().nullable(),
  controlBases: z.array(controlBasisSchema).min(1),
  registerUpdateDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

const ceaseControllerSchema = z.object({
  companyId: z.string().uuid(),
  controllerId: z.string().uuid(),
  cessationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const recordInspectionRequestSchema = z.object({
  companyId: z.string().uuid(),
  requesterName: z.string().min(1),
  requesterAuthority: z.string().min(1),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const resolveInspectionRequestSchema = z.object({
  companyId: z.string().uuid(),
  inspectionRequestId: z.string().uuid(),
  resolutionNote: z.string().min(1),
});

/**
 * Acquire, use, close. Every other feature has one of these; the client register
 * landed without it and constructed a repository in eight handlers with no
 * close() anywhere. In production that leaks nothing today — with no explicit
 * url the repository resolves to the getSqlClient() singleton, so ownsClient is
 * false and close() is a no-op — but it is one `createClientRepository(url)`
 * away from leaking a pool per request.
 */
async function withClientRepository<T>(
  handler: (repository: ClientRepository) => Promise<T>,
): Promise<T> {
  const { createClientRepository } = await loadDefaultClientContext();
  const repository = createClientRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor } = await loadDefaultClientContext();
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listClients());
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor } = await loadDefaultClientContext();
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listAssignmentOptions());
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultClientContext();
    await requireStaffActor(getRequest());
    return withClientRepository((repository) => repository.getClient(data.id));
  });

export const createClient = createServerFn({ method: "POST" })
  .validator(createClientSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) => {
      const actor = await getCurrentClientActor();
      assertClientCompanyCreatable(actor, { teamId: data.teamId });
      return repository.createClient({ ...data, actorId: actor.userId });
    }),
  );

export const updateClient = createServerFn({ method: "POST" })
  .validator(updateClientSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.updateClient({
        ...data,
        actorId: await requireWritableCompany(repository, data.id, data.teamId),
      }),
    ),
  );

export const addClientContact = createServerFn({ method: "POST" })
  .validator(addContactSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.addContact({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const updateClientContact = createServerFn({ method: "POST" })
  .validator(updateContactSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.updateContact({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const removeClientContact = createServerFn({ method: "POST" })
  .validator(removeContactSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.removeContact({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const appointClientOfficer = createServerFn({ method: "POST" })
  .validator(appointOfficerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.appointOfficer({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const ceaseClientOfficer = createServerFn({ method: "POST" })
  .validator(ceaseOfficerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.ceaseOfficer({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const recordClientShareholding = createServerFn({ method: "POST" })
  .validator(recordShareholdingSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.recordShareholding({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const ceaseClientShareholding = createServerFn({ method: "POST" })
  .validator(ceaseShareholdingSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.ceaseShareholding({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const recordClientController = createServerFn({ method: "POST" })
  .validator(recordControllerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.recordController({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const updateClientControllerParticulars = createServerFn({ method: "POST" })
  .validator(updateControllerParticularsSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.updateControllerParticulars({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const ceaseClientController = createServerFn({ method: "POST" })
  .validator(ceaseControllerSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.ceaseController({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const recordClientInspectionRequest = createServerFn({ method: "POST" })
  .validator(recordInspectionRequestSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.recordInspectionRequest({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );

export const resolveClientInspectionRequest = createServerFn({ method: "POST" })
  .validator(resolveInspectionRequestSchema)
  .handler(async ({ data }) =>
    withClientRepository(async (repository) =>
      repository.resolveInspectionRequest({
        ...data,
        actorId: await requireWritableCompany(repository, data.companyId),
      }),
    ),
  );
