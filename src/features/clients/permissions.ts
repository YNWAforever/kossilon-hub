import type { AuthRole } from "@/features/auth/types";

export type ClientAction =
  | "view_register"
  | "edit_details"
  | "create_client"
  | "deactivate_client"
  | "reassign_client";

export type ClientActor = {
  userId: string | null;
  role: AuthRole;
  active: boolean;
};

/** Actions that change assignment or lifecycle rather than servicing an account. */
const MANAGED_ACTIONS = new Set<ClientAction>([
  "create_client",
  "deactivate_client",
  "reassign_client",
]);

/**
 * The register is readable firm-wide by any active staff member — it is reference
 * data, and a system of record that hides most of the record cannot do its job.
 * Deliberately unlike caseFiltersForActor, which narrows reads by team and owner.
 * See docs/superpowers/specs/2026-08-05-client-register-ui-design.md.
 */
export function canPerformClientAction(actor: ClientActor, action: ClientAction): boolean {
  // Checked before the Admin shortcut, matching caseFiltersForActor: an inactive
  // admin is refused for being inactive, not admitted for being an admin.
  if (!actor.active) return false;
  if (actor.role !== "Admin" && actor.role !== "Manager" && actor.role !== "Staff") return false;
  if (!actor.userId) return false;
  if (MANAGED_ACTIONS.has(action)) return actor.role === "Admin" || actor.role === "Manager";

  return true;
}

export function assertClientActionAllowed(actor: ClientActor, action: ClientAction): ClientActor {
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot access the client register.");
  }

  if (actor.role !== "Admin" && actor.role !== "Manager" && actor.role !== "Staff") {
    throw new Error("Forbidden: staff access is required.");
  }

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  if (MANAGED_ACTIONS.has(action) && actor.role === "Staff") {
    throw new Error(`Forbidden: ${action} requires a Manager or an Admin.`);
  }

  return actor;
}
