import type { AuthenticatedActor } from "@/features/auth/types";

export type IncorporationCaseTeam = { teamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertIncorporationCaseWritable(
  actor: AuthenticatedActor,
  incorporationCase: IncorporationCaseTeam,
): void {
  if (!actor.active) {
    throw forbidden("inactive users cannot change incorporation cases.");
  }

  if (actor.role === "Client") {
    throw forbidden("staff access is required.");
  }

  if (actor.role === "Admin") return;

  if (!actor.teamId) {
    throw forbidden("staff actor has no assigned team.");
  }

  if (actor.teamId !== incorporationCase.teamId) {
    throw forbidden("this incorporation case belongs to another team.");
  }
}

export function assertIncorporationCaseCreatable(
  actor: AuthenticatedActor,
  input: { teamId: string },
): void {
  assertIncorporationCaseWritable(actor, { teamId: input.teamId });
}
