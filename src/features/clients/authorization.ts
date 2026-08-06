import type { AuthenticatedActor } from "@/features/auth/types";

/**
 * Who may change a client company.
 *
 * The client register landed enforcing only "is some active staff member with a
 * database identity". Every other feature scopes by team — annual-return cases via
 * caseFiltersForActor, the work queue via queueFiltersForActor — so a Staff user
 * who could not see another team's cases could still rename that team's client,
 * move its contacts, or reassign its owner and team outright.
 *
 * The policy applied here mirrors the rest of the app:
 *
 *   Admin    unrestricted.
 *   Manager  may act on companies assigned to their team, and may create a company
 *            into their own team.
 *   Staff    same as Manager. Onboarding a client is ordinary fee-earner work in a
 *            company-secretary firm, so it is not restricted further — what changes
 *            is that it can no longer reach across teams.
 *
 * Reads are deliberately left firm-wide: the client register doubles as a directory,
 * and listClientAssignmentOptions has to return owners and teams across the firm for
 * an Admin to be able to assign across them.
 */
export type ClientCompanyTeam = { assignedTeamId: string };

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertClientCompanyWritable(
  actor: AuthenticatedActor,
  company: ClientCompanyTeam,
): void {
  if (!actor.active) {
    throw forbidden("inactive users cannot change client companies.");
  }

  if (actor.role === "Client") {
    throw forbidden("staff access is required.");
  }

  if (actor.role === "Admin") return;

  if (!actor.teamId) {
    throw forbidden("staff actor has no assigned team.");
  }

  if (actor.teamId !== company.assignedTeamId) {
    throw forbidden("this client company belongs to another team.");
  }
}

/**
 * Creation has no existing row to compare against, so the check is on the team the
 * caller is asking to create into.
 */
export function assertClientCompanyCreatable(
  actor: AuthenticatedActor,
  input: { teamId: string },
): void {
  assertClientCompanyWritable(actor, { assignedTeamId: input.teamId });
}
