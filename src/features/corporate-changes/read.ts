import type { AuthenticatedActor } from "@/features/auth/types";

import { assertCorporateChangeRequestReadable } from "./authorization";
import { CorporateChangeRequestNotFoundError } from "./errors";
import type { CorporateChangeRequestRepository } from "./repository";
import type { CorporateChangeRequestDetail } from "./types";
import { CORPORATE_CHANGE_STATUSES, CORPORATE_CHANGE_TYPES } from "./types";
import { incorporationReadScope } from "@/features/incorporation/authorization";
import { prepareCaseListQuery, type CaseListQuery } from "@/features/incorporation/case-list-query";

export async function listCorporateChangeRequestPageForActor(
  actor: AuthenticatedActor,
  input: CaseListQuery,
  dependencies: { repository: Pick<CorporateChangeRequestRepository, "listRequestPage"> },
) {
  const scope = incorporationReadScope(actor, input.teamId);
  const query = prepareCaseListQuery(actor, "corporate-changes", input);
  if (query.status && !(CORPORATE_CHANGE_STATUSES as readonly string[]).includes(query.status))
    throw new Error("Invalid corporate change status.");
  if (query.changeType && !(CORPORATE_CHANGE_TYPES as readonly string[]).includes(query.changeType))
    throw new Error("Invalid corporate change type.");
  return dependencies.repository.listRequestPage(scope, query);
}

/**
 * One request, if it exists and the actor may see it.
 *
 * Reads follow the list's scoping (an Admin sees every team, anyone else only
 * their own), which the detail read used to skip.
 */
export async function getCorporateChangeRequestForActor(
  actor: AuthenticatedActor,
  requestId: string,
  dependencies: {
    repository: Pick<CorporateChangeRequestRepository, "getRequest" | "getCompanyTeamId">;
  },
): Promise<CorporateChangeRequestDetail | null> {
  let request: CorporateChangeRequestDetail;
  try {
    request = await dependencies.repository.getRequest(requestId);
  } catch (error) {
    if (error instanceof CorporateChangeRequestNotFoundError) return null;
    throw error;
  }

  const assignedTeamId = await dependencies.repository.getCompanyTeamId(request.companyId);
  assertCorporateChangeRequestReadable(actor, { assignedTeamId });
  return request;
}

/**
 * The team a request list is limited to: none for an Admin, otherwise the
 * actor's own. A non-Admin without a team is refused, matching the detail
 * read — an unscoped list would show them every team's requests.
 */
export function corporateChangeListTeamScope(actor: AuthenticatedActor): string | undefined {
  if (!actor.active || actor.role === "Client")
    throw new Error("Forbidden: active staff access is required.");
  if (actor.role === "Admin") return undefined;
  if (!actor.teamId) throw new Error("Forbidden: staff actor has no assigned team.");
  return actor.teamId;
}
