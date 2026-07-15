import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildAnnualReturnSeedFixtures } from "../../../scripts/db-seed-annual-return";
import { requireActor, type NeonSessionAdapter } from "./neon-auth-server";
import type { SqlClient } from "@/server/db/client";

const seedFixtures = buildAnnualReturnSeedFixtures({ adminAuthUserId: randomUUID() });
const seededAdminProfile =
  seedFixtures.staffProfiles.find((profile) => profile.role === "Admin") ??
  (() => {
    throw new Error("Annual return fixtures must include an Admin profile.");
  })();

function fakeSession(authUserId: string): NeonSessionAdapter {
  return {
    getSession: async () => ({
      user: { id: authUserId, email: "admin@example.test" },
    }),
    signOut: async () => new Response(null, { status: 204 }),
  };
}

function fakeSql(staffRows: unknown[]): SqlClient {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.join("").includes("staff_profiles") &&
    values.length === 1 &&
    values[0] === seededAdminProfile.authUserId
      ? staffRows
      : []) as unknown as SqlClient;
}

describe("Neon Auth server mapping", () => {
  it("maps the seeded Neon Auth admin identity to an active Admin actor", async () => {
    const actor = await requireActor(new Request("https://example.test/protected"), {
      auth: fakeSession(seededAdminProfile.authUserId),
      sql: fakeSql([
        {
          user_id: seededAdminProfile.userId,
          role: seededAdminProfile.role,
          team_id: seededAdminProfile.teamId,
          active: true,
        },
      ]),
    });

    expect(actor).toEqual({
      authUserId: seededAdminProfile.authUserId,
      userId: seededAdminProfile.userId,
      role: "Admin",
      teamId: seededAdminProfile.teamId,
      active: true,
    });
  });

  it("forbids an unknown identity when only the seeded Admin has a staff profile", async () => {
    const unknownAuthUserId = randomUUID();

    await expect(
      requireActor(new Request("https://example.test/protected"), {
        auth: fakeSession(unknownAuthUserId),
        sql: fakeSql([
          {
            user_id: seededAdminProfile.userId,
            role: seededAdminProfile.role,
            team_id: seededAdminProfile.teamId,
            active: true,
          },
        ]),
      }),
    ).rejects.toThrow(/forbidden/i);
  });
});
