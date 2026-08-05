import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireStaffActor, type AuthDependencies } from "@/features/auth/neon-auth-server";
import { createClientRepository } from "./repository";

/**
 * Resolves the staff user id every client write is attributed to. Mirrors
 * getCurrentAnnualReturnActorId — a Neon Auth session alone is not enough, the
 * actor must also have a staff row in the database to own a timeline event.
 */
async function getCurrentClientActorId(dependencies: AuthDependencies = {}): Promise<string> {
  const actor = await requireStaffActor(getRequest(), dependencies);

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
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

export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor(getRequest());
  return createClientRepository().listClients();
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor(getRequest());
  return createClientRepository().listAssignmentOptions();
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireStaffActor(getRequest());
    return createClientRepository().getClient(data.id);
  });

export const createClient = createServerFn({ method: "POST" })
  .validator(createClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().createClient({ ...data, actorId: await getCurrentClientActorId() }),
  );

export const updateClient = createServerFn({ method: "POST" })
  .validator(updateClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateClient({ ...data, actorId: await getCurrentClientActorId() }),
  );

export const addClientContact = createServerFn({ method: "POST" })
  .validator(addContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().addContact({ ...data, actorId: await getCurrentClientActorId() }),
  );

export const updateClientContact = createServerFn({ method: "POST" })
  .validator(updateContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateContact({ ...data, actorId: await getCurrentClientActorId() }),
  );

export const removeClientContact = createServerFn({ method: "POST" })
  .validator(removeContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().removeContact({ ...data, actorId: await getCurrentClientActorId() }),
  );
