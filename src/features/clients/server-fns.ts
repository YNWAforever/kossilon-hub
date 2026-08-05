import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireStaffActor, type AuthDependencies } from "@/features/auth/neon-auth-server";
import { assertClientActionAllowed, type ClientAction } from "./permissions";
import { createClientRepository } from "./repository";

/**
 * Resolves the acting staff member and asserts they may perform `action`, then
 * hands back the user id the repository attributes the write to. The repository
 * still runs its own active-user check — it must not trust its caller, and that
 * check also catches a user deactivated mid-session.
 */
async function actorIdFor(
  action: ClientAction,
  dependencies: AuthDependencies = {},
): Promise<string> {
  const actor = await requireStaffActor(getRequest(), dependencies);
  assertClientActionAllowed(
    { userId: actor.userId, role: actor.role, active: actor.active },
    action,
  );

  // assertClientActionAllowed throws when userId is null, so this is narrowing only.
  return actor.userId as string;
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
  await actorIdFor("view_register");
  return createClientRepository().listClients();
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  await actorIdFor("view_register");
  return createClientRepository().listAssignmentOptions();
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await actorIdFor("view_register");
    return createClientRepository().getClient(data.id);
  });

export const createClient = createServerFn({ method: "POST" })
  .validator(createClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().createClient({ ...data, actorId: await actorIdFor("create_client") }),
  );

export const updateClient = createServerFn({ method: "POST" })
  .validator(updateClientSchema)
  .handler(async ({ data }) => {
    // Authenticate before touching the database: view_register is the floor every
    // client action requires, so an inactive or non-staff caller is refused before
    // we spend a query working out which finer permission applies.
    const actor = await requireStaffActor(getRequest());
    const clientActor = { userId: actor.userId, role: actor.role, active: actor.active };
    assertClientActionAllowed(clientActor, "view_register");

    const current = await createClientRepository().getClient(data.id);

    if (!current) {
      throw new Error("Client not found.");
    }

    // Reassignment and deactivation are managed actions; editing the rest is not.
    const reassigns = data.ownerId !== current.ownerId || data.teamId !== current.teamId;
    const deactivates = data.status !== current.status;
    const action: ClientAction = reassigns
      ? "reassign_client"
      : deactivates
        ? "deactivate_client"
        : "edit_details";

    assertClientActionAllowed(clientActor, action);

    return createClientRepository().updateClient({
      ...data,
      actorId: actor.userId as string,
    });
  });

export const addClientContact = createServerFn({ method: "POST" })
  .validator(addContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().addContact({ ...data, actorId: await actorIdFor("edit_details") }),
  );

export const updateClientContact = createServerFn({ method: "POST" })
  .validator(updateContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateContact({ ...data, actorId: await actorIdFor("edit_details") }),
  );

export const removeClientContact = createServerFn({ method: "POST" })
  .validator(removeContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().removeContact({ ...data, actorId: await actorIdFor("edit_details") }),
  );
