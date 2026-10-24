import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AdminRepository } from "./repository";
import {
  staffFiltersSchema,
  updateStaffSchema,
  reassignmentPreviewSchema,
  handoverPageSchema,
  handoverCommandSchema,
  type StaffFilters,
  type UpdateStaffInput,
  type HandoverCommand,
} from "./types";
function adminActor(actor: AuthenticatedActor) {
  assertStaffAccess(actor);
  if (actor.role !== "Admin" || !actor.userId) throw new Error("Forbidden: Admin access required.");
}
async function handoverResponse<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const status =
      (error as { statusCode?: number })?.statusCode ??
      (error instanceof Error && error.message.startsWith("Forbidden") ? 403 : 0);
    if ([403, 409, 503].includes(status))
      throw new Response(
        JSON.stringify({
          code:
            status === 409
              ? "HANDOVER_CONFLICT"
              : status === 403
                ? "FORBIDDEN"
                : "SCHEMA_WRITE_BLOCKED",
          message:
            status === 409
              ? "責任或員工版本已改變，請重新預覽。"
              : status === 403
                ? "沒有執行此操作的權限。"
                : "資料庫結構未能核實，操作未執行。",
        }),
        { status, headers: { "content-type": "application/json" } },
      );
    throw error;
  }
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
export async function previewHandoverForActor(
  actor: AuthenticatedActor,
  input: ReturnType<typeof handoverPageSchema.parse>,
  repository: Pick<AdminRepository, "previewHandover">,
) {
  adminActor(actor);
  return repository.previewHandover(actor, handoverPageSchema.parse(input));
}
export async function executeHandoverForActor(
  actor: AuthenticatedActor,
  input: HandoverCommand,
  repository: Pick<AdminRepository, "executeHandover">,
) {
  adminActor(actor);
  return repository.executeHandover(actor, handoverCommandSchema.parse(input));
}
export async function cancelHandoverForActor(
  actor: AuthenticatedActor,
  input: HandoverCommand,
  repository: Pick<AdminRepository, "cancelHandover">,
) {
  adminActor(actor);
  return repository.cancelHandover(actor, handoverCommandSchema.parse(input));
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
export const previewStaffHandover = createServerFn({ method: "POST" })
  .validator(handoverPageSchema)
  .handler(async ({ data }) =>
    handoverResponse(async () => {
      const { actor, repository } = await context();
      return previewHandoverForActor(actor, data, repository);
    }),
  );
export const executeStaffHandover = createServerFn({ method: "POST" })
  .validator(handoverCommandSchema)
  .handler(async ({ data }) =>
    handoverResponse(async () => {
      const { actor, repository } = await context();
      return executeHandoverForActor(actor, data, repository);
    }),
  );
export const readStaffHandoverReceipt = createServerFn({ method: "GET" })
  .validator(z.object({ operationId: z.string().uuid() }).strict())
  .handler(async ({ data }) =>
    handoverResponse(async () => {
      const { actor, repository } = await context();
      return repository.readHandoverReceipt(actor, data.operationId);
    }),
  );
export const cancelStaffHandover = createServerFn({ method: "POST" })
  .validator(handoverCommandSchema)
  .handler(async ({ data }) =>
    handoverResponse(async () => {
      const { actor, repository } = await context();
      return cancelHandoverForActor(actor, data, repository);
    }),
  );
