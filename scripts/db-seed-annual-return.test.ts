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

type SeedRow = Record<string, unknown>;
const passwordLikeKeyNames = new Set([
  "password",
  "passwordhash",
  "secret",
  "secretkey",
  "token",
  "tokenhash",
]);

function createSeedSqlCapture() {
  const capturedInsertRows: SeedRow[] = [];
  const capturedInsertQueries: string[] = [];
  const tx = vi.fn((first: unknown, ...args: unknown[]) => {
    if (Array.isArray(first) && !Object.hasOwn(first, "raw")) {
      if (
        first.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))
      ) {
        capturedInsertRows.push(...(first as SeedRow[]));
      }
      return first;
    }

    const query = Array.isArray(first) ? first.join(" ") : "";
    if (/insert into/i.test(query)) capturedInsertQueries.push(query);
    const rows = args.find(
      (value): value is SeedRow[] =>
        Array.isArray(value) &&
        value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row)),
    );

    if (!rows) return undefined;
    if (query.includes("annual_return_cases")) {
      return rows.map((row) => ({ company_id: row.company_id, id: row.id }));
    }
    if (query.includes("staff_profiles")) {
      return rows.map((row) => ({ user_id: row.user_id, id: row.id }));
    }
    if (query.includes("business_calendars")) {
      return rows.map((row) => ({
        name: row.name,
        version: row.version,
        id: row.id,
        timezone: row.timezone,
        weekly_schedule: row.weekly_schedule,
        effective_from: row.effective_from,
        created_by: row.created_by,
      }));
    }
    if (query.includes("sla_policies")) {
      return rows.map((row) => ({
        policy_key: row.policy_key,
        version: row.version,
        id: row.id,
        name: row.name,
        work_type: row.work_type,
        business_calendar_id: row.business_calendar_id,
        warning_minutes: row.warning_minutes,
        due_minutes: row.due_minutes,
        escalation_targets: row.escalation_targets,
        priority_modifier: row.priority_modifier,
        effective_from: row.effective_from,
        created_by: row.created_by,
      }));
    }
    if (query.includes("payments")) {
      return rows.map((row) => ({ case_id: row.case_id, id: row.id }));
    }
    return undefined;
  });

  Object.assign(tx, { json: (value: unknown) => value });

  return {
    capturedInsertRows,
    capturedInsertQueries,
    sql: {
      begin: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
}

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

  it("excludes password-like keys from every generated insert row", async () => {
    const { capturedInsertRows, capturedInsertQueries, sql } = createSeedSqlCapture();

    await seedAnnualReturn(sql as never);

    const generatedInsertKeys = [
      ...capturedInsertRows.flatMap((row) => Object.keys(row)),
      ...capturedInsertQueries.flatMap((query) => query.match(/[a-z_]+/g) ?? []),
    ];
    const passwordLikeKeys = generatedInsertKeys.filter((key) =>
      passwordLikeKeyNames.has(key.replaceAll("_", "").toLowerCase()),
    );

    expect(capturedInsertRows.length).toBeGreaterThan(0);
    expect(capturedInsertQueries.length).toBeGreaterThan(0);
    expect(passwordLikeKeys).toEqual([]);
  });

  it("does not start the seed transaction when the module is imported", () => {
    expect(begin).not.toHaveBeenCalled();
  });
});
