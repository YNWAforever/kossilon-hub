import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCurrentActorId } from "@/features/session/actor";
import { createClientRepository } from "./repository";

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

export const listClients = createServerFn({ method: "GET" }).handler(async () =>
  createClientRepository().listClients(),
);

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () =>
  createClientRepository().listAssignmentOptions(),
);

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => createClientRepository().getClient(data.id));

export const createClient = createServerFn({ method: "POST" })
  .validator(createClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().createClient({ ...data, actorId: getCurrentActorId() }),
  );

export const updateClient = createServerFn({ method: "POST" })
  .validator(updateClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateClient({ ...data, actorId: getCurrentActorId() }),
  );

export const addClientContact = createServerFn({ method: "POST" })
  .validator(addContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().addContact({ ...data, actorId: getCurrentActorId() }),
  );

export const updateClientContact = createServerFn({ method: "POST" })
  .validator(updateContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateContact({ ...data, actorId: getCurrentActorId() }),
  );

export const removeClientContact = createServerFn({ method: "POST" })
  .validator(removeContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().removeContact({ ...data, actorId: getCurrentActorId() }),
  );
