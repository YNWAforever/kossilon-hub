import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertIncorporationCaseReadable, incorporationReadScope } from "./authorization";

const staff: AuthenticatedActor = {
  authUserId: "auth-a",
  userId: "user-a",
  role: "Staff",
  teamId: "team-a",
  active: true,
};

describe("incorporation read authorization", () => {
  it.each(["Staff", "Manager"] as const)("keeps %s reads within the assigned team", (role) => {
    const actor = { ...staff, role };
    expect(incorporationReadScope(actor)).toEqual({ kind: "team", teamId: "team-a" });
    expect(() => assertIncorporationCaseReadable(actor, { teamId: "team-a" })).not.toThrow();
    expect(() => assertIncorporationCaseReadable(actor, { teamId: "team-b" })).toThrow(
      /^Forbidden:/,
    );
    expect(() => incorporationReadScope(actor, "team-b")).toThrow(/^Forbidden:/);
  });

  it("allows an active Admin to explicitly read all teams or narrow to one", () => {
    const admin = { ...staff, role: "Admin" as const, teamId: null };
    expect(incorporationReadScope(admin)).toEqual({ kind: "all" });
    expect(incorporationReadScope(admin, "team-b")).toEqual({ kind: "team", teamId: "team-b" });
    expect(() => assertIncorporationCaseReadable(admin, { teamId: "team-b" })).not.toThrow();
  });

  it.each([
    { role: "Staff", teamId: null },
    { role: "Manager", teamId: null },
    { role: "Client" },
    { role: "Staff", active: false },
    { role: "Manager", active: false },
    { role: "Admin", active: false },
  ] satisfies Partial<AuthenticatedActor>[])(
    "denies invalid actor %j before reading",
    (overrides) => {
      const actor = { ...staff, ...overrides };
      expect(() => incorporationReadScope(actor)).toThrow(/^Forbidden:/);
      expect(() => assertIncorporationCaseReadable(actor, { teamId: "team-a" })).toThrow(
        /^Forbidden:/,
      );
    },
  );
});
