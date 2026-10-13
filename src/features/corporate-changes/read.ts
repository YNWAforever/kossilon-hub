import type { AuthenticatedActor } from "@/features/auth/types";

import { assertCorporateChangeRequestReadable } from "./authorization";
import { CorporateChangeRequestNotFoundError } from "./errors";
import type { CorporateChangeRequestRepository } from "./repository";
import type { CorporateChangeRequestDetail } from "./types";

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
