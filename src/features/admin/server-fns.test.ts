import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { updateStaffForActor, listStaffForActor } from "./server-fns";
const admin: AuthenticatedActor = {
  authUserId: "verified-admin",
  userId: crypto.randomUUID(),
  role: "Admin",
  teamId: null,
  active: true,
};
const input = {
  userId: crypto.randomUUID(),
  expectedVersion: 1,
  role: "Staff" as const,
  teamId: crypto.randomUUID(),
  active: false,
};
describe("Admin command authorization", () => {
  it.each(["Manager", "Staff", "Client"] as const)(
    "denies %s before any staff read/write",
    async (role) => {
      const repository = { updateStaff: vi.fn(), listStaff: vi.fn() };
      const actor = { ...admin, role };
      await expect(updateStaffForActor(actor, input, repository)).rejects.toThrow(
        /Admin|Forbidden/,
      );
      await expect(listStaffForActor(actor, {}, repository)).rejects.toThrow(/Admin|Forbidden/);
      expect(repository.updateStaff).not.toHaveBeenCalled();
      expect(repository.listStaff).not.toHaveBeenCalled();
    },
  );
  it("rejects inactive Admin and client-supplied actor/auth identity", async () => {
    const repository = { updateStaff: vi.fn(), listStaff: vi.fn() };
    await expect(
      updateStaffForActor({ ...admin, active: false }, input, repository),
    ).rejects.toThrow();
    await expect(
      updateStaffForActor(admin, { ...input, actorId: "forged" } as typeof input, repository),
    ).rejects.toThrow();
    expect(repository.updateStaff).not.toHaveBeenCalled();
  });
});
