import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertStaffDocumentAccess,
  isDocumentVisibleToStaffActor,
  type DocumentAccessSubject,
} from "./authorization";

const TEAM_A = "11111111-1111-4111-8111-111111111111";
const TEAM_B = "22222222-2222-4222-8222-222222222222";
const AMY = "33333333-3333-4333-8333-333333333333";
const PRIYA = "44444444-4444-4444-8444-444444444444";
const COMPANY = "55555555-5555-4555-8555-555555555555";
const CASE = "66666666-6666-4666-8666-666666666666";

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth-user",
    userId: AMY,
    role: "Staff",
    teamId: TEAM_A,
    active: true,
    ...overrides,
  };
}

function subject(overrides: Partial<DocumentAccessSubject> = {}): DocumentAccessSubject {
  return {
    companyId: COMPANY,
    companyTeamId: TEAM_A,
    caseId: null,
    caseOwnerId: null,
    caseReviewerId: null,
    ...overrides,
  };
}

describe("isDocumentVisibleToStaffActor", () => {
  it("allows a staff actor on the company's own team", () => {
    expect(isDocumentVisibleToStaffActor(actor(), subject())).toBe(true);
  });

  it("refuses a staff actor whose team does not own the company", () => {
    expect(isDocumentVisibleToStaffActor(actor(), subject({ companyTeamId: TEAM_B }))).toBe(false);
  });

  it("allows an admin regardless of team, matching documentFiltersForActor's empty scope", () => {
    expect(
      isDocumentVisibleToStaffActor(
        actor({ role: "Admin", teamId: null }),
        subject({ companyTeamId: TEAM_B }),
      ),
    ).toBe(true);
  });

  it("refuses an inactive admin", () => {
    expect(isDocumentVisibleToStaffActor(actor({ role: "Admin", active: false }), subject())).toBe(
      false,
    );
  });

  // The escape hatch isAnnualReturnCaseVisibleToActor already documents: whoever
  // may act on a case may read it, or an assignment across teams produces a case
  // an actor can mutate but cannot open.
  it("allows the assigned owner of a case on another team", () => {
    expect(
      isDocumentVisibleToStaffActor(
        actor({ userId: PRIYA }),
        subject({ companyTeamId: TEAM_B, caseId: CASE, caseOwnerId: PRIYA }),
      ),
    ).toBe(true);
  });

  it("allows the assigned reviewer of a case on another team", () => {
    expect(
      isDocumentVisibleToStaffActor(
        actor({ userId: PRIYA }),
        subject({ companyTeamId: TEAM_B, caseId: CASE, caseReviewerId: PRIYA }),
      ),
    ).toBe(true);
  });

  it("does not let an unrelated staff actor in through a case on another team", () => {
    expect(
      isDocumentVisibleToStaffActor(
        actor({ userId: AMY }),
        subject({ companyTeamId: TEAM_B, caseId: CASE, caseOwnerId: PRIYA, caseReviewerId: null }),
      ),
    ).toBe(false);
  });

  // A case-less document has nothing to inherit an assignment from, so the
  // company-team rule is the whole policy for it.
  it("falls back to the company team for a case-less document", () => {
    expect(
      isDocumentVisibleToStaffActor(actor(), subject({ caseId: null, caseOwnerId: PRIYA })),
    ).toBe(true);
  });

  it("refuses a case-less document belonging to another team", () => {
    expect(
      isDocumentVisibleToStaffActor(actor(), subject({ companyTeamId: TEAM_B, caseId: null })),
    ).toBe(false);
  });

  // A null companyTeamId must never match a null actor teamId into an accidental
  // allow: both are "unknown", and unknown is not a scope.
  it("refuses a staff actor with no team even when the company has none either", () => {
    expect(
      isDocumentVisibleToStaffActor(actor({ teamId: null }), subject({ companyTeamId: null })),
    ).toBe(false);
  });

  it("refuses a Client actor, which is decided by membership elsewhere", () => {
    expect(isDocumentVisibleToStaffActor(actor({ role: "Client" }), subject())).toBe(false);
  });

  it("refuses a staff actor with no database identity", () => {
    expect(isDocumentVisibleToStaffActor(actor({ userId: null }), subject())).toBe(false);
  });
  it("keeps no-team assignment access as strict as the throwing policy", () => {
    const noTeam = actor({ teamId: null });
    const assigned = subject({ caseId: CASE, companyTeamId: TEAM_B, caseOwnerId: noTeam.userId });
    expect(isDocumentVisibleToStaffActor(noTeam, assigned)).toBe(false);
    expect(() => assertStaffDocumentAccess(noTeam, assigned)).toThrow(/no assigned team/);
  });
});

describe("assertStaffDocumentAccess", () => {
  it("returns the actor when access is allowed", () => {
    const allowed = actor();
    expect(assertStaffDocumentAccess(allowed, subject())).toBe(allowed);
  });

  it("throws with this repository's Forbidden prefix", () => {
    expect(() => assertStaffDocumentAccess(actor(), subject({ companyTeamId: TEAM_B }))).toThrow(
      /^Forbidden: /,
    );
  });

  it("names inactivity rather than scope when the account is inactive", () => {
    expect(() => assertStaffDocumentAccess(actor({ active: false }), subject())).toThrow(
      "Forbidden: inactive users cannot access documents.",
    );
  });

  it("names the missing team, matching documentFiltersForActor's wording", () => {
    expect(() => assertStaffDocumentAccess(actor({ teamId: null }), subject())).toThrow(
      "Forbidden: staff actor has no assigned team.",
    );
  });

  it("refuses a Client with the staff-access message", () => {
    expect(() => assertStaffDocumentAccess(actor({ role: "Client" }), subject())).toThrow(
      "Forbidden: staff access is required.",
    );
  });

  it("reports an out-of-scope document as out of scope", () => {
    expect(() => assertStaffDocumentAccess(actor(), subject({ companyTeamId: TEAM_B }))).toThrow(
      "Forbidden: this document is outside your scope.",
    );
  });
});
