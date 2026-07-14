import { describe, expect, expectTypeOf, it, vi } from "vitest";

const { begin } = vi.hoisted(() => ({
  begin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/server/db/client", () => ({
  createSqlClient: () =>
    Object.assign(() => [], {
      begin,
      end: vi.fn().mockResolvedValue(undefined),
    }),
}));

import {
  buildAnnualReturnSeedFixtures,
  seedAnnualReturn,
  type SeedAnnualReturnOptions,
} from "./db-seed-annual-return";

describe("annual return seed fixtures", () => {
  it("preserves the default synthetic staff and client identities", () => {
    expect(buildAnnualReturnSeedFixtures()).toEqual({
      staffProfiles: [
        {
          id: "90000000-0000-0000-0000-000000000001",
          userId: "20000000-0000-0000-0000-000000000001",
          authUserId: "neon-auth-staff-amy.chan@kossilon.hk",
          role: "Admin",
          teamId: "10000000-0000-0000-0000-000000000001",
          capacityPoints: 100,
        },
        {
          id: "90000000-0000-0000-0000-000000000002",
          userId: "20000000-0000-0000-0000-000000000002",
          authUserId: "neon-auth-staff-ken.wong@kossilon.hk",
          role: "Manager",
          teamId: "10000000-0000-0000-0000-000000000001",
          capacityPoints: 100,
        },
        {
          id: "90000000-0000-0000-0000-000000000003",
          userId: "20000000-0000-0000-0000-000000000003",
          authUserId: "neon-auth-staff-mei.lam@kossilon.hk",
          role: "Staff",
          teamId: "10000000-0000-0000-0000-000000000001",
          capacityPoints: 80,
        },
        {
          id: "90000000-0000-0000-0000-000000000004",
          userId: "20000000-0000-0000-0000-000000000004",
          authUserId: "neon-auth-staff-priya.singh@kossilon.hk",
          role: "Manager",
          teamId: "10000000-0000-0000-0000-000000000002",
          capacityPoints: 100,
        },
      ],
      clientAuthIdentity: {
        authUserId: "neon-auth-client-harbour",
        email: "client.harbour@example.test",
      },
      clientCompanyMemberships: [
        {
          id: "92000000-0000-0000-0000-000000000001",
          authUserId: "neon-auth-client-harbour",
          companyId: "30000000-0000-0000-0000-000000000001",
          invitedBy: "20000000-0000-0000-0000-000000000001",
          acceptedAt: "2026-06-01T09:00:00.000Z",
        },
      ],
    });
  });

  it("replaces only Amy Chan's Admin auth identity", () => {
    const defaultFixtures = buildAnnualReturnSeedFixtures();
    const overriddenFixtures = buildAnnualReturnSeedFixtures({
      adminAuthUserId: "  demo-admin-auth-user  ",
    });

    expect(overriddenFixtures.staffProfiles).toEqual([
      { ...defaultFixtures.staffProfiles[0], authUserId: "demo-admin-auth-user" },
      ...defaultFixtures.staffProfiles.slice(1),
    ]);
    expect(overriddenFixtures.clientAuthIdentity).toEqual(defaultFixtures.clientAuthIdentity);
    expect(overriddenFixtures.clientCompanyMemberships).toEqual(
      defaultFixtures.clientCompanyMemberships,
    );
  });

  it("rejects an empty Admin auth identity override", () => {
    expect(() => buildAnnualReturnSeedFixtures({ adminAuthUserId: "" })).toThrow(
      "adminAuthUserId must be a non-empty string.",
    );
    expect(() => buildAnnualReturnSeedFixtures({ adminAuthUserId: "   " })).toThrow(
      "adminAuthUserId must be a non-empty string.",
    );
  });

  it("validates an override before starting the seed transaction", async () => {
    begin.mockClear();

    await expect(
      seedAnnualReturn({ begin } as never, { adminAuthUserId: "   " }),
    ).rejects.toThrow("adminAuthUserId must be a non-empty string.");
    expect(begin).not.toHaveBeenCalled();
  });

  it("accepts no password-like configuration or generated seed rows", () => {
    type PasswordLikeConfigurationKey = Extract<
      keyof SeedAnnualReturnOptions,
      `${string}${"password" | "secret" | "token"}${string}`
    >;
    expectTypeOf<PasswordLikeConfigurationKey>().toEqualTypeOf<never>();

    const fixtures = buildAnnualReturnSeedFixtures();
    for (const row of [...fixtures.staffProfiles, ...fixtures.clientCompanyMemberships]) {
      expect(Object.keys(row)).not.toContain("password");
      expect(Object.keys(row)).not.toContain("passwordHash");
    }
  });

  it("does not start the seed transaction when the module is imported", () => {
    expect(begin).not.toHaveBeenCalled();
  });
});
