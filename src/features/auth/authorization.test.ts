import { describe, expect, it } from "vitest";
import {
  assertClientCompanyAccess,
  assertStaffAccess,
  type ClientCompanyMembership,
} from "./authorization";
import type { AuthenticatedActor } from "./types";
import { requireActor, type NeonSessionAdapter } from "./neon-auth-server";
import type { SqlClient } from "@/server/db/client";

const staff: AuthenticatedActor = {
  authUserId: "auth-staff-1",
  userId: "20000000-0000-0000-0000-000000000003",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

const client: AuthenticatedActor = {
  authUserId: "auth-client-1",
  userId: null,
  role: "Client",
  teamId: null,
  active: true,
};

const membership: ClientCompanyMembership = {
  companyId: "30000000-0000-0000-0000-000000000001",
  active: true,
};

describe("authorization policies", () => {
  it("denies an anonymous request before database lookup", async () => {
    const auth: NeonSessionAdapter = {
      getSession: async () => null,
      signOut: async () => new Response(null, { status: 204 }),
    };
    const sql = (() => {
      throw new Error("database should not be queried");
    }) as unknown as SqlClient;

    await expect(
      requireActor(new Request("https://example.test/protected"), { auth, sql }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("denies an inactive staff actor", () => {
    expect(() => assertStaffAccess({ ...staff, active: false })).toThrow(/inactive/i);
  });

  it("denies a verified user without staff or client provisioning", async () => {
    const auth: NeonSessionAdapter = {
      getSession: async () => ({
        user: { id: "auth-unprovisioned", email: "new@example.test" },
      }),
      signOut: async () => new Response(null, { status: 204 }),
    };
    const sql = (async () => []) as unknown as SqlClient;

    await expect(
      requireActor(new Request("https://example.test/protected"), { auth, sql }),
    ).rejects.toThrow(/forbidden|provisioned|membership/i);
  });

  it("denies a client actor at a staff-only boundary", () => {
    expect(() => assertStaffAccess(client)).toThrow(/staff access/i);
  });

  it("denies a client without company membership", () => {
    expect(() => assertClientCompanyAccess(client, membership.companyId, [])).toThrow(
      /not found|forbidden/i,
    );
  });

  it("denies inactive membership and membership for another company", () => {
    expect(() =>
      assertClientCompanyAccess(client, membership.companyId, [
        { ...membership, active: false },
        { companyId: "30000000-0000-0000-0000-000000000002", active: true },
      ]),
    ).toThrow(/not found|forbidden/i);
  });

  it("allows active staff and matching active client membership", () => {
    expect(assertStaffAccess(staff)).toEqual(staff);
    expect(assertClientCompanyAccess(client, membership.companyId, [membership])).toEqual(client);
  });
});
