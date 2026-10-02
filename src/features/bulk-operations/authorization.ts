import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
export function assertBulkManager(actor: AuthenticatedActor) {
  assertStaffAccess(actor);
  if (
    !actor.userId ||
    !["Admin", "Manager"].includes(actor.role) ||
    (actor.role === "Manager" && !actor.teamId)
  )
    throw new Error("Forbidden: active Admin or team Manager required.");
}
