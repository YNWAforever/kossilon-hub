import { BusinessHandoverRejection } from "./business-handover-errors";
import type { BusinessHandoverReceipt } from "./types";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AdminRepository } from "./repository";
import {
  businessHandoverSchema,
  staffFiltersSchema,
  updateStaffSchema,
  reassignmentPreviewSchema,
  type StaffFilters,
  type UpdateStaffInput,
} from "./types";
function adminActor(actor: AuthenticatedActor) {
  assertStaffAccess(actor);
  if (actor.role !== "Admin") throw new Error("Forbidden: Admin access required.");
}
export async function updateStaffForActor(
  actor: AuthenticatedActor,
  input: UpdateStaffInput,
  repository: Pick<AdminRepository, "updateStaff">,
) {
  adminActor(actor);
  return repository.updateStaff(actor, updateStaffSchema.parse(input));
}
export async function listStaffForActor(
  actor: AuthenticatedActor,
  input: StaffFilters,
  repository: Pick<AdminRepository, "listStaff">,
) {
  adminActor(actor);
  return repository.listStaff(actor, staffFiltersSchema.parse(input));
}
const context = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { requireStaffActor },
    { currentProviderMode },
    { createAdminRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("@/server/provider-mode"),
    import("./repository"),
  ]);
  if (currentProviderMode() !== "live") throw new Error("Demo administration is read-only.");
  const actor = await requireStaffActor(getRequest());
  adminActor(actor);
  return { actor, repository: createAdminRepository() };
});
export const listStaff = createServerFn({ method: "GET" })
  .validator(staffFiltersSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return listStaffForActor(actor, data, repository);
  });
export const updateStaff = createServerFn({ method: "POST" })
  .validator(updateStaffSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    try {
      return await updateStaffForActor(actor, data, repository);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409)
        throw new Response(
          JSON.stringify({ code: "version_conflict", message: "Staff version changed. Refresh." }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      throw error;
    }
  });
export const previewReassignment = createServerFn({ method: "GET" })
  .validator(reassignmentPreviewSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.previewReassignment(actor, data);
  });
export const listAdminTeams = createServerFn({ method: "GET" })
  .validator(z.object({}).strict())
  .handler(async () => {
    const { actor, repository } = await context();
    return repository.listTeams(actor);
  });
export const listStaffAudit = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.listAudit(actor, data.userId);
  });

export const transferStaffBusinessHandover = createServerFn({ method: "POST" })
  .validator(businessHandoverSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return transferStaffBusinessHandoverForActor(actor, data, repository);
  });
export const getStaffBusinessHandoverReceipt = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid(), operationId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { actor, repository } = await context();
    return repository.getBusinessHandoverReceipt(actor, data.userId, data.operationId);
  });

export async function transferStaffBusinessHandoverForActor(
  actor: AuthenticatedActor,
  input: unknown,
  repository: Pick<AdminRepository, "transferBusinessHandover">,
): Promise<BusinessHandoverReceipt> {
  adminActor(actor);
  const data = businessHandoverSchema.parse(input);
  try {
    return await repository.transferBusinessHandover(actor, data);
  } catch (error) {
    if (error instanceof BusinessHandoverRejection)
      return {
        operationId: data.operationId,
        resourceId: data.item.id,
        kind: data.item.kind,
        state: "rejected",
        reason: error.reason,
        recipientId: data.recipientId,
      };
    throw error;
  }
}
