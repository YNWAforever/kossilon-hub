import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertCorporateChangeRequestCreatable, assertCorporateChangeRequestWritable } from "./authorization";

const TEAM_A = "10000000-0000-0000-0000-000000000001";
const TEAM_B = "10000000-0000-0000-0000-000000000002";

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth-1",
    userId: "user-1",
    role: "Staff",
    teamId: TEAM_A,
    active: true,
    ...overrides,
  };
}

describe("assertCorporateChangeRequestWritable", () => {
  it("allows Staff on the same team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor(), { assignedTeamId: TEAM_A }),
    ).not.toThrow();
  });

  it("rejects Staff on a different team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor(), { assignedTeamId: TEAM_B }),
    ).toThrow(/Forbidden/);
  });

  it("rejects an inactive actor", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ active: false }), { assignedTeamId: TEAM_A }),
    ).toThrow(/Forbidden/);
  });

  it("rejects a Client actor", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ role: "Client" }), { assignedTeamId: TEAM_A }),
    ).toThrow(/Forbidden/);
  });

  it("allows Admin regardless of team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ role: "Admin", teamId: null }), {
        assignedTeamId: TEAM_B,
      }),
    ).not.toThrow();
  });

  it("rejects a Manager reaching into another team", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ role: "Manager" }), { assignedTeamId: TEAM_B }),
    ).toThrow(/Forbidden/);
  });

  it("rejects a staff actor with no team rather than defaulting open", () => {
    expect(() =>
      assertCorporateChangeRequestWritable(actor({ teamId: null }), { assignedTeamId: TEAM_A }),
    ).toThrow(/Forbidden:.*no assigned team/);
  });
});

describe("assertCorporateChangeRequestCreatable", () => {
  it("allows Staff creating into their own team", () => {
    expect(() =>
      assertCorporateChangeRequestCreatable(actor(), { teamId: TEAM_A }),
    ).not.toThrow();
  });

  it("rejects Staff creating into another team", () => {
    expect(() =>
      assertCorporateChangeRequestCreatable(actor(), { teamId: TEAM_B }),
    ).toThrow(/Forbidden/);
  });
});
