import type { AuthenticatedActor } from "@/features/auth/types";

export type CorporateChangeCompanyTeam = { assignedTeamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertCorporateChangeRequestWritable(
  actor: AuthenticatedActor,
  company: CorporateChangeCompanyTeam,
): void {
  if (!actor.active) {
    throw forbidden("inactive users cannot change corporate change requests.");
  }

  if (actor.role === "Client") {
    throw forbidden("staff access is required.");
  }

  if (actor.role === "Admin") return;

  if (!actor.teamId) {
    throw forbidden("staff actor has no assigned team.");
  }

  if (actor.teamId !== company.assignedTeamId) {
    throw forbidden("this company belongs to another team.");
  }
}

export function assertCorporateChangeRequestCreatable(
  actor: AuthenticatedActor,
  input: { teamId: string },
): void {
  assertCorporateChangeRequestWritable(actor, { assignedTeamId: input.teamId });
}
