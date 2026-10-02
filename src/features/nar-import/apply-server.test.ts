import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { previewNarApplyForActor, executeNarApplyForActor } from "./server-fns";
const actor: AuthenticatedActor = {
  userId: crypto.randomUUID(),
  authUserId: "synthetic-nar-admin",
  role: "Admin",
  active: true,
  teamId: null,
};
describe("NAR approved RPC contracts", () => {
  for (const role of ["Manager", "Staff", "Client"] as const)
    it(`denies ${role} before persistence`, async () => {
      const repo = { preview: vi.fn(), execute: vi.fn() };
      await expect(previewNarApplyForActor({ ...actor, role }, {}, repo)).rejects.toThrow(
        /Forbidden/,
      );
      expect(repo.preview).not.toHaveBeenCalled();
    });
  it("refuses forged actor, revision, paid dates and unknown fields", async () => {
    const repo = { preview: vi.fn(), execute: vi.fn() };
    await expect(
      previewNarApplyForActor(
        actor,
        {
          batchId: crypto.randomUUID(),
          rowIds: [crypto.randomUUID()],
          actorId: actor.userId,
          paid: true,
        },
        repo,
      ),
    ).rejects.toThrow();
    await expect(
      executeNarApplyForActor(
        actor,
        { previewId: crypto.randomUUID(), idempotencyKey: "x", version: "forged" },
        repo,
      ),
    ).rejects.toThrow();
    expect(repo.preview).not.toHaveBeenCalled();
    expect(repo.execute).not.toHaveBeenCalled();
  });
});
