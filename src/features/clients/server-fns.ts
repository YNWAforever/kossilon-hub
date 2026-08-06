import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireStaffActor, type AuthDependencies } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertClientCompanyCreatable, assertClientCompanyWritable } from "./authorization";
import { createClientRepository } from "./repository";

/**
 * Resolves the staff user id every client write is attributed to. Mirrors
 * getCurrentAnnualReturnActorId — a Neon Auth session alone is not enough, the
 * actor must also have a staff row in the database to own a timeline event.
 */
async function getCurrentClientActor(
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor & { userId: string }> {
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
  repository: ReturnType<typeof createClientRepository>,
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
  companySecretary: z.string().min(1),
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

/**
 * Acquire, use, close. Every other feature has one of these; the client register
 * landed without it and constructed a repository in eight handlers with no
 * close() anywhere. In production that leaks nothing today — with no explicit
 * url the repository resolves to the getSqlClient() singleton, so ownsClient is
 * false and close() is a no-op — but it is one `createClientRepository(url)`
 * away from leaking a pool per request.
 */
async function withClientRepository<T>(
  handler: (repository: ReturnType<typeof createClientRepository>) => Promise<T>,
): Promise<T> {
  const repository = createClientRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listClients());
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listAssignmentOptions());
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
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
