import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assertClientCompanyAccess, assertStaffAccess } from "./authorization";
import type { AuthenticatedActor } from "./types";
import { assertStaffDocumentAccess } from "@/features/documents/authorization";
import {
  cancelBulkOperationForActor,
  getBulkOperationForActor,
} from "@/features/bulk-operations/server-fns";
import { listWorkViewForActor } from "@/features/annual-return/server-fns";

const teamA = "10000000-0000-4000-8000-000000000001";
const teamB = "10000000-0000-4000-8000-000000000002";
const companyA = "20000000-0000-4000-8000-000000000001";
const companyB = "20000000-0000-4000-8000-000000000002";
const operationId = "30000000-0000-4000-8000-000000000001";

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth-staff",
    userId: "40000000-0000-4000-8000-000000000001",
    role: "Staff",
    teamId: teamA,
    active: true,
    ...overrides,
  };
}

const document = {
  companyId: companyA,
  companyTeamId: teamA,
  caseId: null,
  caseOwnerId: null,
  caseReviewerId: null,
};

describe("T29 operations role matrix", () => {
  it("t29_scenario_3 verifies the built scheduler for the deployed Vercel target", () => {
    const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).toMatch(/NITRO_PRESET:\s*vercel/);
    expect(ci).toContain("npm run verify:built-scheduler");
    expect(ci).not.toContain("grep -q 'hooks.hook");
  });

  it("t29_scenario_1 accepts only current staff roles and active own-company Client membership", () => {
    for (const role of ["Admin", "Manager", "Staff"] as const) {
      expect(assertStaffAccess(actor({ role }))).toMatchObject({ role });
    }
    for (const denied of [
      actor({ role: "Client", userId: null }),
      actor({ active: false }),
      actor({ role: "Admin", userId: null, authUserId: "" }),
      actor({ role: "LegacyAdmin" as never }),
    ]) {
      expect(() => assertStaffAccess(denied)).toThrow(/Forbidden/);
    }
    const client = actor({
      authUserId: "auth-client",
      userId: null,
      role: "Client",
      teamId: null,
    });
    const memberships = [
      { companyId: companyA, active: true },
      { companyId: companyB, active: false },
    ];
    expect(assertClientCompanyAccess(client, companyA, memberships)).toBe(client);
    expect(() => assertClientCompanyAccess(client, companyB, memberships)).toThrow(/membership/);
    expect(() =>
      assertClientCompanyAccess(client, companyA, [{ companyId: companyA, active: false }]),
    ).toThrow(/membership/);
    expect(() => assertClientCompanyAccess(actor(), companyA, memberships)).toThrow(
      /client access/,
    );
  });

  it("t29_scenario_1 scopes document by-ID access for staff and rejects unknown roles", () => {
    expect(assertStaffDocumentAccess(actor(), document).role).toBe("Staff");
    expect(assertStaffDocumentAccess(actor({ role: "Manager" }), document).role).toBe("Manager");
    expect(assertStaffDocumentAccess(actor({ role: "Admin", teamId: teamB }), document).role).toBe(
      "Admin",
    );
    for (const denied of [
      actor({ role: "Manager", teamId: teamB }),
      actor({ role: "Client", userId: null }),
      actor({ active: false }),
      actor({ role: "LegacyAdmin" as never }),
    ]) {
      expect(() => assertStaffDocumentAccess(denied, document)).toThrow(/Forbidden/);
    }
  });

  it("t29_scenario_1 denies direct bulk read and cancel before calling the repository", async () => {
    const get = vi.fn(async () => ({}));
    const cancel = vi.fn(async () => ({}));
    const repository = { get, cancel } as never;
    for (const denied of [
      actor({ role: "Client", userId: null }),
      actor({ active: false }),
      actor({ role: "Admin", userId: null, authUserId: "" }),
    ]) {
      await expect(getBulkOperationForActor(denied, operationId, repository)).rejects.toThrow(
        /Forbidden/,
      );
      await expect(cancelBulkOperationForActor(denied, operationId, repository)).rejects.toThrow(
        /Forbidden/,
      );
    }
    expect(get).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("t29_scenario_1 denies a direct work-view read without a staff DB identity", async () => {
    const listWorkViewPage = vi.fn(async () => ({}));
    const dependencies = { repository: { listWorkViewPage } } as never;
    await expect(
      listWorkViewForActor(
        actor({ role: "Admin", userId: null, authUserId: "" }),
        { view: "chaseToday" },
        dependencies,
      ),
    ).rejects.toThrow(/staff database identity|staff access/i);
    expect(listWorkViewPage).not.toHaveBeenCalled();
    for (const denied of [actor({ role: "Client", userId: null }), actor({ active: false })]) {
      await expect(
        listWorkViewForActor(denied, { view: "chaseToday" }, dependencies),
      ).rejects.toThrow(/Forbidden/);
    }
    expect(listWorkViewPage).not.toHaveBeenCalled();
  });
});
