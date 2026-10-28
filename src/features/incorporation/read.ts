import type { AuthenticatedActor } from "@/features/auth/types";
import { assertIncorporationCaseReadable, incorporationReadScope } from "./authorization";
import type { IncorporationListQuery, IncorporationRepository } from "./repository";
import type { IncorporationCase, IncorporationCaseSummary } from "./types";
import { INCORPORATION_STATUSES } from "./types";
import { prepareCaseListQuery, type CaseListQuery } from "./case-list-query";

export type IncorporationListInput = IncorporationListQuery & { teamId?: string };

export async function listIncorporationCasePageForActor(
  actor: AuthenticatedActor,
  input: CaseListQuery,
  dependencies: { repository: Pick<IncorporationRepository, "listCasePage"> },
) {
  const scope = incorporationReadScope(actor, input.teamId);
  const query = prepareCaseListQuery(actor, "incorporation", input);
  if (query.status && !(INCORPORATION_STATUSES as readonly string[]).includes(query.status))
    throw new Error("Invalid incorporation status.");
  if (query.changeType) throw new Error("Invalid incorporation filter.");
  return dependencies.repository.listCasePage(scope, query);
}

/** Shared read boundary for list/search/page and any future snapshot entry. */
export async function listIncorporationCasesForActor(
  actor: AuthenticatedActor,
  input: IncorporationListInput,
  dependencies: { repository: Pick<IncorporationRepository, "listCases"> },
): Promise<IncorporationCaseSummary[]> {
  const { teamId, ...query } = input;
  return dependencies.repository.listCases(incorporationReadScope(actor, teamId), query);
}

export async function getIncorporationCaseForActor(
  actor: AuthenticatedActor,
  caseId: string,
  dependencies: {
    repository: Pick<IncorporationRepository, "getCaseTeamId" | "getCase">;
  },
): Promise<IncorporationCase | null> {
  const scope = incorporationReadScope(actor);
  const teamId = await dependencies.repository.getCaseTeamId(caseId);
  if (!teamId) return null;
  assertIncorporationCaseReadable(actor, { teamId });

  // Scope the hydration too: reassignment after the lookup must not disclose
  // another team's case or checklist. Recheck returned identity defensively.
  const result = await dependencies.repository.getCase(caseId, scope);
  if (result) assertIncorporationCaseReadable(actor, result);
  return result;
}
