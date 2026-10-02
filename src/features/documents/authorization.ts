import type { AuthenticatedActor } from "@/features/auth/types";

/**
 * The authoritative scope of one document, upload intent or prospective upload,
 * loaded server-side from `companies` and `annual_return_cases`.
 *
 * Never assembled from client input. `documentFiltersForActor` narrows *list*
 * reads to the actor's team, but every by-ID operation went through
 * `authorizeCompany`, which for a non-Client actor was exactly
 * `assertStaffAccess` -- "is this an active staff account", with no notion of
 * which company. A Staff actor who could not see another team's documents on the
 * archive could still download, review and drive the scan lifecycle of any of
 * them by passing the id.
 *
 * `annual-return/permissions.ts` had the same hole and already fixed it the same
 * way: `caseFiltersForActor` (the list narrowing) paired with
 * `isAnnualReturnCaseVisibleToActor` (its single-row counterpart). This is that
 * counterpart for documents.
 */
export type DocumentAccessSubject = {
  companyId: string;
  companyTeamId: string | null;
  caseId: string | null;
  caseOwnerId: string | null;
  caseReviewerId: string | null;
};

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export type StaffDocumentScope = { teamId?: string; assignedUserId?: string };

/** Shared list/by-ID preconditions; no-team assignments remain closed. */
export function documentScopeForStaffActor(
  actor: AuthenticatedActor,
  purpose: "list" | "access" = "list",
): StaffDocumentScope {
  if (!actor.active) throw forbidden(`inactive users cannot ${purpose} documents.`);
  if (actor.role === "Client" || !actor.userId) throw forbidden("staff access is required.");
  if (actor.role === "Admin") return {};
  if (!actor.teamId) throw forbidden("staff actor has no assigned team.");
  return { teamId: actor.teamId, assignedUserId: actor.userId };
}

/**
 * Whether a staff actor may reach one document.
 *
 * Client actors are always false here and are decided by
 * `requireClientCompanyAccess` against `client_company_memberships` instead --
 * membership is a database fact this pure function has no access to, and
 * conflating the two would make one of them silently weaker.
 */
export function isDocumentVisibleToStaffActor(
  actor: AuthenticatedActor,
  subject: DocumentAccessSubject,
): boolean {
  // Checked before the Admin shortcut, matching caseFiltersForActor: an inactive
  // admin may not act, so they may not read either.
  try {
    documentScopeForStaffActor(actor, "access");
  } catch {
    return false;
  }

  if (actor.role === "Admin") return true;

  // Two unknowns are not a match. A staff actor with no team and a company with
  // no assigned team would otherwise compare null === null and open every
  // unassigned company to every unassigned actor.
  if (actor.teamId && subject.companyTeamId && subject.companyTeamId === actor.teamId) {
    return true;
  }

  // getAnnualReturnActionPermission lets an owner or reviewer act on a case
  // whatever team it belongs to, so scoping reads to the team alone would
  // produce a case whose documents an actor may mutate but may no longer open --
  // the exact bug isAnnualReturnCaseVisibleToActor records in its own comment.
  // Whoever may act on a case may read its evidence.
  //
  // Gated on caseId so a case-less document cannot inherit an assignment from
  // nowhere; for those the company-team rule above is the whole policy.
  if (subject.caseId !== null) {
    if (subject.caseOwnerId === actor.userId) return true;
    if (subject.caseReviewerId === actor.userId) return true;
  }

  return false;
}

/**
 * The throwing form. Error messages distinguish *why* access failed, because
 * "inactive" and "wrong team" need different operator responses, and reuse the
 * exact strings `documentFiltersForActor` already throws so the by-ID and list
 * paths cannot drift apart.
 */
export function assertStaffDocumentAccess(
  actor: AuthenticatedActor,
  subject: DocumentAccessSubject,
): AuthenticatedActor {
  documentScopeForStaffActor(actor, "access");

  if (!isDocumentVisibleToStaffActor(actor, subject)) {
    throw forbidden("this document is outside your scope.");
  }

  return actor;
}
