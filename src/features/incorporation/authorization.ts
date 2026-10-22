import type { AuthenticatedActor } from "@/features/auth/types";

export type IncorporationCaseTeam = { teamId: string };

export type IncorporationReadScope =
  | { kind: "all"; teamId?: never }
  | { kind: "team"; teamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

/** Owner/search/page filters may narrow this scope, never grant another team. */
export function incorporationReadScope(
  actor: AuthenticatedActor,
  requestedTeamId?: string,
): IncorporationReadScope {
  if (!actor.active) throw forbidden("inactive users cannot view incorporation cases.");
  if (actor.role === "Client") throw forbidden("staff access is required.");
  if (actor.role === "Admin") {
    return requestedTeamId ? { kind: "team", teamId: requestedTeamId } : { kind: "all" };
  }
  if (!actor.teamId) throw forbidden("staff actor has no assigned team.");
  if (requestedTeamId && requestedTeamId !== actor.teamId) {
    throw forbidden("this incorporation case belongs to another team.");
  }
  return { kind: "team", teamId: actor.teamId };
}

export function assertIncorporationCaseReadable(
  actor: AuthenticatedActor,
  incorporationCase: IncorporationCaseTeam,
): void {
  const scope = incorporationReadScope(actor);
  if (scope.kind === "team" && scope.teamId !== incorporationCase.teamId) {
    throw forbidden("this incorporation case belongs to another team.");
  }
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
