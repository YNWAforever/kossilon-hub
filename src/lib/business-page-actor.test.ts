import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { listIncorporationPageForActor } from "@/features/incorporation/server-fns";
import { listCorporateChangePageForActor } from "@/features/corporate-changes/server-fns";
const userId = "11111111-1111-4111-8111-111111111111",
  teamId = "22222222-2222-4222-8222-222222222222";
describe("R20 verified actor page boundary", () => {
  for (const role of ["Admin", "Manager", "Staff"] as const)
    it(role + " owned positive control and exact scope", async () => {
      const actor: AuthenticatedActor = {
        userId,
        teamId,
        role,
        active: true,
        authUserId: "synthetic-contract-only",
      };
      const read = vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        nextCursor: null,
        observedAt: "2026-10-12T00:00:00Z",
      });
      await listIncorporationPageForActor(actor, { listCasePage: read }, { view: "mine" });
      expect(read).toHaveBeenCalledWith(
        role === "Admin" ? { kind: "all" } : { kind: "team", teamId },
        expect.objectContaining({ view: "mine", limit: 50 }),
        userId,
      );
      read.mockClear();
      await listCorporateChangePageForActor(actor, { listRequestPage: read }, {});
      expect(read).toHaveBeenCalledWith(
        role === "Admin" ? { kind: "all" } : { kind: "team", teamId },
        expect.objectContaining({ limit: 50 }),
        userId,
      );
    });
  it("denies missing team, Client, inactive Admin and forged authority before any repository read", async () => {
    const actor: AuthenticatedActor = {
      userId,
      teamId,
      role: "Staff",
      active: true,
      authUserId: "synthetic-contract-only",
    };
    const read = vi.fn();
    for (const denied of [
      { ...actor, teamId: null },
      { ...actor, role: "Client" as const },
      { ...actor, role: "Admin" as const, active: false },
      { ...actor, authUserId: "" },
    ]) {
      await expect(
        listIncorporationPageForActor(denied, { listCasePage: read }, {}),
      ).rejects.toThrow(/Forbidden/);
      await expect(
        listCorporateChangePageForActor(denied, { listRequestPage: read }, {}),
      ).rejects.toThrow(/Forbidden/);
    }
    await expect(
      listIncorporationPageForActor(actor, { listCasePage: read }, { limit: 51 }),
    ).rejects.toThrow();
    await expect(
      listCorporateChangePageForActor(actor, { listRequestPage: read }, {
        teamId: "forged",
      } as never),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
