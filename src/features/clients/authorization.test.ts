import { describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "@/features/auth/types";
import { assertClientCompanyCreatable, assertClientCompanyWritable } from "./authorization";

const TEAM = "10000000-0000-4000-8000-000000000001";
const OTHER_TEAM = "10000000-0000-4000-8000-000000000002";

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth-user",
    userId: "20000000-0000-4000-8000-000000000009",
    role: "Staff",
    teamId: TEAM,
    active: true,
    ...overrides,
  };
}

/**
 * The client register enforced only "is some active staff member with a database
 * identity", while every other feature scopes by team. A Staff user who could not
 * see another team's cases could still rename that team's client and reassign its
 * owner and team outright.
 */
describe("assertClientCompanyWritable", () => {
  it("allows a staff member to change their own team's client", () => {
    expect(() => assertClientCompanyWritable(actor(), { assignedTeamId: TEAM })).not.toThrow();
  });

  it("refuses a staff member reaching into another team", () => {
    expect(() => assertClientCompanyWritable(actor(), { assignedTeamId: OTHER_TEAM })).toThrow(
      /^Forbidden:.*another team/,
    );
  });

  it("refuses a manager reaching into another team", () => {
    expect(() =>
      assertClientCompanyWritable(actor({ role: "Manager" }), { assignedTeamId: OTHER_TEAM }),
    ).toThrow(/^Forbidden:/);
  });

  it("does not restrict an admin", () => {
    expect(() =>
      assertClientCompanyWritable(actor({ role: "Admin", teamId: null }), {
        assignedTeamId: OTHER_TEAM,
      }),
    ).not.toThrow();
  });

  it("refuses an inactive actor even on their own team", () => {
    expect(() =>
      assertClientCompanyWritable(actor({ active: false }), { assignedTeamId: TEAM }),
    ).toThrow(/^Forbidden:/);
  });

  it("refuses a client actor outright", () => {
    expect(() =>
      assertClientCompanyWritable(actor({ role: "Client", userId: null, teamId: null }), {
        assignedTeamId: TEAM,
      }),
    ).toThrow(/^Forbidden:.*staff access/);
  });

  it("refuses a staff actor with no team rather than defaulting open", () => {
    expect(() =>
      assertClientCompanyWritable(actor({ teamId: null }), { assignedTeamId: TEAM }),
    ).toThrow(/^Forbidden:.*no assigned team/);
  });
});

describe("assertClientCompanyCreatable", () => {
  it("lets staff onboard a client into their own team", () => {
    expect(() => assertClientCompanyCreatable(actor(), { teamId: TEAM })).not.toThrow();
  });

  // Creation is the one path with no existing row to compare against, so the
  // caller-supplied teamId is what has to be checked.
  it("refuses creating a company into another team", () => {
    expect(() => assertClientCompanyCreatable(actor(), { teamId: OTHER_TEAM })).toThrow(
      /^Forbidden:/,
    );
  });

  it("lets an admin create into any team", () => {
    expect(() =>
      assertClientCompanyCreatable(actor({ role: "Admin", teamId: null }), { teamId: OTHER_TEAM }),
    ).not.toThrow();
  });
});
