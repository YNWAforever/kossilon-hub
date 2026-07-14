import type { AuthenticatedActor } from "./types";

export type ClientCompanyMembership = {
  companyId: string;
  active: boolean;
};

function forbidden(message: string): Error {
  return new Error(`Forbidden: ${message}`);
}

export function assertStaffAccess(actor: AuthenticatedActor): AuthenticatedActor {
  if (!actor.active) {
    throw forbidden("staff account is inactive.");
  }

  if (actor.role === "Client" || !actor.userId) {
    throw forbidden("staff access is required.");
  }

  return actor;
}

export function assertClientCompanyAccess(
  actor: AuthenticatedActor,
  companyId: string,
  memberships: readonly ClientCompanyMembership[],
): AuthenticatedActor {
  if (!actor.active) {
    throw forbidden("client account is inactive.");
  }

  if (actor.role !== "Client") {
    throw forbidden("client access is required.");
  }

  const hasAccess = memberships.some(
    (membership) => membership.active && membership.companyId === companyId,
  );

  if (!hasAccess) {
    throw forbidden("company membership was not found.");
  }

  return actor;
}
