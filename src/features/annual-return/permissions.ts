export type AnnualReturnAction =
  | "assign_owner"
  | "add_note"
  | "record_reminder"
  | "update_checklist"
  | "update_payment"
  | "update_filing_proof"
  | "change_status"
  | "complete";

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
