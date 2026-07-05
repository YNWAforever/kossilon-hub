import { describe, expect, it } from "vitest";
import {
  assertAnnualReturnActionAllowed,
  getAnnualReturnActionPermission,
  type AnnualReturnActionActor,
  type AnnualReturnActionCase,
} from "./permissions";

const TEAM_ALPHA_ID = "10000000-0000-0000-0000-000000000001";
const TEAM_BRAVO_ID = "10000000-0000-0000-0000-000000000002";
const OWNER_ID = "20000000-0000-0000-0000-000000000001";
const REVIEWER_ID = "20000000-0000-0000-0000-000000000002";
const OTHER_STAFF_ID = "20000000-0000-0000-0000-000000000003";

const case_: AnnualReturnActionCase = {
  id: "40000000-0000-0000-0000-000000000001",
  companyName: "Harbour Trading Ltd",
  companyTeamId: TEAM_ALPHA_ID,
  ownerId: OWNER_ID,
  reviewerId: REVIEWER_ID,
};

function actor(overrides: Partial<AnnualReturnActionActor> = {}): AnnualReturnActionActor {
  return {
    id: OWNER_ID,
    role: "Staff",
    teamId: TEAM_ALPHA_ID,
    active: true,
    ...overrides,
  };
}

describe("annual return action permissions", () => {
  it("denies inactive users before role checks", () => {
    const result = getAnnualReturnActionPermission(
      actor({ active: false }),
      case_,
      "record_reminder",
    );

    expect(result).toEqual({
      allowed: false,
      reason: "Inactive users cannot update annual return cases.",
    });
  });

  it("allows admins to mutate and complete cases across teams", () => {
    const admin = actor({ id: OTHER_STAFF_ID, role: "Admin", teamId: TEAM_BRAVO_ID });

    expect(getAnnualReturnActionPermission(admin, case_, "update_payment").allowed).toBe(true);
    expect(getAnnualReturnActionPermission(admin, case_, "complete").allowed).toBe(true);
  });

  it("allows managers to mutate and complete cases assigned to their team", () => {
    const manager = actor({ id: OTHER_STAFF_ID, role: "Manager", teamId: TEAM_ALPHA_ID });

    expect(getAnnualReturnActionPermission(manager, case_, "update_checklist").allowed).toBe(true);
    expect(getAnnualReturnActionPermission(manager, case_, "complete").allowed).toBe(true);
  });

  it("denies managers from another team", () => {
    const manager = actor({ id: OTHER_STAFF_ID, role: "Manager", teamId: TEAM_BRAVO_ID });

    expect(getAnnualReturnActionPermission(manager, case_, "update_filing_proof")).toEqual({
      allowed: false,
      reason: "Only assigned staff, reviewers, team managers, or admins can update this case.",
    });
  });

  it("allows assigned staff to perform operational updates", () => {
    const owner = actor({ id: OWNER_ID, role: "Staff", teamId: TEAM_BRAVO_ID });
    const reviewer = actor({ id: REVIEWER_ID, role: "Staff", teamId: TEAM_BRAVO_ID });

    expect(getAnnualReturnActionPermission(owner, case_, "record_reminder").allowed).toBe(true);
    expect(getAnnualReturnActionPermission(reviewer, case_, "update_payment").allowed).toBe(true);
  });

  it("limits completion to admins, same-team managers, and assigned reviewers", () => {
    const owner = actor({ id: OWNER_ID, role: "Staff" });
    const reviewer = actor({ id: REVIEWER_ID, role: "Staff", teamId: TEAM_BRAVO_ID });

    expect(getAnnualReturnActionPermission(owner, case_, "complete")).toEqual({
      allowed: false,
      reason: "Only admins, team managers, or assigned reviewers can complete annual return cases.",
    });
    expect(getAnnualReturnActionPermission(reviewer, case_, "complete").allowed).toBe(true);
  });

  it("throws a useful error when an action is denied", () => {
    expect(() =>
      assertAnnualReturnActionAllowed(
        actor({ id: OTHER_STAFF_ID, teamId: TEAM_BRAVO_ID }),
        case_,
        "update_payment",
      ),
    ).toThrow(/Only assigned staff/);
  });
});
