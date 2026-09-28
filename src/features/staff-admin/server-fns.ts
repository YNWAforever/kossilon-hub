import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";

const id = z.string().uuid();
const role = z.enum(["Admin", "Manager", "Staff"]);
const staffAccessSchema = z
  .object({
    staffId: id,
    role,
    teamId: id.nullable(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const staffDisableSchema = z
  .object({
    staffId: id,
    expectedRevision: z.number().int().positive(),
    handoverOperationId: id.optional(),
  })
  .strict();
const staffInviteSchema = z
  .object({
    email: z.string().email().max(320),
    name: z.string().trim().min(1).max(200),
    role,
    teamId: id.nullable(),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();

const currentAdmin = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { currentProviderMode }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("@/server/provider-mode"),
  ]);
  if (currentProviderMode() !== "live") throw new Error("Demo administration is read-only.");
  const actor = await requireStaffActor(getRequest());
  if (actor.role !== "Admin" || !actor.userId) throw new Error("Forbidden: Admin access required.");
  return actor;
});

export const listStaffAdministration = createServerFn({ method: "GET" })
  .validator(z.object({}).strict())
  .handler(async () => {
    const actor = await currentAdmin();
    const { listStaffAdministrationForActor } = await import("./repository");
    return listStaffAdministrationForActor(actor);
  });

export const changeStaffAccess = createServerFn({ method: "POST" })
  .validator(staffAccessSchema)
  .handler(async ({ data }) => {
    const actor = await currentAdmin();
    const { changeStaffAccessForActor } = await import("./repository");
    return changeStaffAccessForActor(actor, data);
  });

export const disableStaff = createServerFn({ method: "POST" })
  .validator(staffDisableSchema)
  .handler(async ({ data }) => {
    const actor = await currentAdmin();
    const { disableStaffForActor } = await import("./repository");
    return disableStaffForActor(actor, data);
  });

export const inviteStaff = createServerFn({ method: "POST" })
  .validator(staffInviteSchema)
  .handler(async ({ data }) => {
    const actor = await currentAdmin();
    const [{ inviteStaffForActor }, { verifiedStaffInviteProvider }] = await Promise.all([
      import("./repository"),
      import("./auth-provider"),
    ]);
    const provider = verifiedStaffInviteProvider();
    if (!provider) throw new Error("Neon staff invitation provider capability is unverified.");
    return inviteStaffForActor(actor, data, { provider });
  });
