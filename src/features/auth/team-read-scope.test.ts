import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "./types";
import { requireTeamReadScope } from "./team-read-scope";

const actor: AuthenticatedActor = {
  authUserId: "verified",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};
describe("R14 team read policy", () => {
  it.each(["Staff", "Manager"] as const)("restricts active %s to their team", (role) => {
    expect(requireTeamReadScope({ ...actor, role })).toEqual({
      kind: "team",
      teamId: actor.teamId,
    });
  });
  it("allows active Admin with staff identity to read all teams", () => {
    expect(requireTeamReadScope({ ...actor, role: "Admin", teamId: null })).toEqual({
      kind: "all",
    });
  });
  it.each([
    { ...actor, active: false },
    { ...actor, role: "Client" as const },
    { ...actor, teamId: null },
    { ...actor, teamId: "" },
    { ...actor, userId: null },
    { ...actor, role: "Admin" as const, userId: null },
    { ...actor, role: "Admin" as const, active: false },
  ])("rejects invalid staff identity or team before repository reads: %j", (invalid) => {
    expect(() => requireTeamReadScope(invalid)).toThrow(/Forbidden/);
  });
  it("re-evaluates a revoked actor on the next resolution", () => {
    expect(requireTeamReadScope(actor)).toEqual({ kind: "team", teamId: actor.teamId });
    expect(() => requireTeamReadScope({ ...actor, active: false })).toThrow(/Forbidden/);
    expect(
      requireTeamReadScope({ ...actor, teamId: "10000000-0000-0000-0000-000000000002" }),
    ).toEqual({ kind: "team", teamId: "10000000-0000-0000-0000-000000000002" });
  });
});
