import type { AuthenticatedActor } from "@/features/auth/types";
import { assertCorporateChangeRequestWritable } from "./authorization";
import { createCorporateChangeRequestSchema } from "./create-input";
import { corporateChangeListTeamScope } from "./read";
import type { CorporateChangeRequestRepository } from "./repository";

export async function createCorporateChangeRequestForActor(
  actor: AuthenticatedActor,
  input: unknown,
  dependencies: {
    repository: Pick<CorporateChangeRequestRepository, "getCompanyTeamId" | "createRequest">;
  },
) {
  const data = createCorporateChangeRequestSchema.parse(input);
  corporateChangeListTeamScope(actor);
  if (!actor.userId) throw new Error("Forbidden: a staff database identity is required.");
  const teamId = await dependencies.repository.getCompanyTeamId(data.companyId);
  assertCorporateChangeRequestWritable(actor, { assignedTeamId: teamId });
  return dependencies.repository.createRequest({ ...data, actorId: actor.userId });
}
