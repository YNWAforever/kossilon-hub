export type AnnualReturnAction =
  | "assign_owner"
  | "add_note"
  | "record_reminder"
  | "update_checklist"
  | "update_payment"
  | "update_filing_proof"
  | "change_status"
  | "complete"
  | "create_case";

export type AnnualReturnActorRole = "Admin" | "Manager" | "Staff";

export type AnnualReturnActionActor = {
  id: string;
  role: AnnualReturnActorRole;
  teamId: string | null;
  active: boolean;
};

export type AnnualReturnActionCase = {
  id: string;
  companyName: string;
  companyTeamId: string;
  ownerId: string;
  reviewerId: string | null;
};

export type AnnualReturnActionPermission =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
    };

const OPERATIONAL_DENIAL_REASON =
  "Only assigned staff, reviewers, team managers, or admins can update this case.";
const COMPLETION_DENIAL_REASON =
  "Only admins, team managers, or assigned reviewers can complete annual return cases.";

function actorOwnsOrReviewsCase(
  actor: AnnualReturnActionActor,
  case_: AnnualReturnActionCase,
): boolean {
  return actor.id === case_.ownerId || actor.id === case_.reviewerId;
}

function actorManagesCaseTeam(
  actor: AnnualReturnActionActor,
  case_: AnnualReturnActionCase,
): boolean {
  return actor.role === "Manager" && actor.teamId === case_.companyTeamId;
}

export function getAnnualReturnActionPermission(
  actor: AnnualReturnActionActor,
  case_: AnnualReturnActionCase,
  action: AnnualReturnAction,
): AnnualReturnActionPermission {
  if (!actor.active) {
    return {
      allowed: false,
      reason: "Inactive users cannot update annual return cases.",
    };
  }

  if (actor.role === "Admin") {
    return { allowed: true };
  }

  if (action === "complete") {
    if (actorManagesCaseTeam(actor, case_) || actor.id === case_.reviewerId) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: COMPLETION_DENIAL_REASON,
    };
  }

  if (actorManagesCaseTeam(actor, case_) || actorOwnsOrReviewsCase(actor, case_)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: OPERATIONAL_DENIAL_REASON,
  };
}

export function assertAnnualReturnActionAllowed(
  actor: AnnualReturnActionActor,
  case_: AnnualReturnActionCase,
  action: AnnualReturnAction,
): void {
  const permission = getAnnualReturnActionPermission(actor, case_, action);

  if (!permission.allowed) {
    throw new Error(permission.reason);
  }
}

/**
 * Creation has no existing case row to compare against, so the check is on the
 * company's own team — a case has no team_id of its own; every read derives it
 * live from companies.assigned_team_id (see annual-return/repository.ts's
 * selectCaseRows/getCase), so the company's team is the only team there is.
 */
export function assertAnnualReturnCaseCreatable(
  actor: AnnualReturnActionActor,
  input: { teamId: string },
): void {
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot create annual return cases.");
  }

  if (actor.role === "Admin") {
    return;
  }

  if (actor.teamId !== input.teamId) {
    throw new Error("Forbidden: this company belongs to another team.");
  }
}

/**
 * The board actor. Structurally satisfied by AuthenticatedActor
 * (src/features/auth/types.ts) with `userId` passed as `id`, so this module keeps
 * its zero imports and stays usable from anywhere.
 */
export type AnnualReturnBoardActor = {
  id: string | null;
  role: AnnualReturnActorRole | "Client";
  teamId: string | null;
  active: boolean;
};

/**
 * The narrowing a list read must apply so a board shows exactly the cases whose
 * detail screens will accept actions. Mirrors queueFiltersForActor
 * (src/features/work-items/server-fns.ts), including its throws.
 */
export type AnnualReturnCaseScope = {
  teamId?: string;
  visibleToUserId?: string;
};

/**
 * The single-case counterpart to caseFiltersForActor, expressed against the same
 * scope so a detail read can never return a case the list would have hidden.
 *
 * Detail reads used to apply no scope at all: `getAnnualReturnCase`,
 * `listAnnualReturnCaseNotes` and `buildAnnualReturnReminderDraft` were staff-only
 * and nothing more, so a Staff actor who could not see another team's cases on the
 * board could still read any of them in full by passing the case id.
 */
export function isAnnualReturnCaseVisibleToActor(
  actor: AnnualReturnBoardActor,
  case_: Pick<AnnualReturnActionCase, "companyTeamId" | "ownerId" | "reviewerId">,
): boolean {
  const scope = caseFiltersForActor(actor);

  const withinBoardScope =
    (scope.teamId === undefined || case_.companyTeamId === scope.teamId) &&
    (scope.visibleToUserId === undefined ||
      case_.ownerId === scope.visibleToUserId ||
      case_.reviewerId === scope.visibleToUserId);

  if (withinBoardScope) return true;

  // The board narrows by team AND by owner/reviewer, but getAnnualReturnActionPermission
  // lets an owner or reviewer act on a case whatever team it belongs to. Deriving
  // visibility from the board scope alone therefore produced a case an actor could
  // mutate but could no longer open — assignOwner across teams is all it takes.
  // Whoever may act on a case may read it.
  return actor.id !== null && (case_.ownerId === actor.id || case_.reviewerId === actor.id);
}

export function assertAnnualReturnCaseVisible(
  actor: AnnualReturnBoardActor,
  case_: Pick<AnnualReturnActionCase, "companyTeamId" | "ownerId" | "reviewerId">,
): void {
  if (!isAnnualReturnCaseVisibleToActor(actor, case_)) {
    throw new Error("Forbidden: this annual return case is outside your scope.");
  }
}

export function caseFiltersForActor(actor: AnnualReturnBoardActor): AnnualReturnCaseScope {
  // Checked before the Admin shortcut, matching getAnnualReturnActionPermission:
  // an inactive admin cannot act on a case, so they are shown none.
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot list annual return cases.");
  }

  if (actor.role === "Admin") {
    return {};
  }

  // Role first: a Client is refused for being a Client, not incidentally for
  // having no staff row.
  if (actor.role !== "Manager" && actor.role !== "Staff") {
    throw new Error("Forbidden: staff access is required.");
  }

  if (!actor.id) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  if (!actor.teamId) {
    throw new Error("Forbidden: staff actor has no assigned team.");
  }

  if (actor.role === "Manager") {
    return { teamId: actor.teamId };
  }

  return { teamId: actor.teamId, visibleToUserId: actor.id };
}
