import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { previewBulkForActor, executeBulkForActor } from "./server-fns";
const manager: AuthenticatedActor = {
  authUserId: "synthetic",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Manager",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};
describe("bulk RPC contracts", () => {
  for (const actor of [
    { ...manager, role: "Staff" as const },
    { ...manager, role: "Client" as const },
    { ...manager, active: false },
    { ...manager, teamId: null },
  ])
    it(`rejects ${actor.role}/${actor.active}/${actor.teamId} before a read or write`, async () => {
      const preview = vi.fn(),
        execute = vi.fn();
      await expect(previewBulkForActor(actor, {}, { preview })).rejects.toThrow(/Forbidden/);
      await expect(executeBulkForActor(actor, {}, { execute })).rejects.toThrow(/Forbidden/);
      expect(preview).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });
  it("rejects forged actor, scope totals and version input before persistence", async () => {
    const preview = vi.fn();
    await expect(
      previewBulkForActor(
        manager,
        {
          resource: "annual_return_case",
          selection: { mode: "explicit_ids", ids: [], count: 1240 },
          assignment: { target: "owner", assigneeId: manager.userId },
          actorId: manager.userId,
        },
        { preview },
      ),
    ).rejects.toThrow();
    expect(preview).not.toHaveBeenCalled();
  });
});
