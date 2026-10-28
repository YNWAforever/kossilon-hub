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
  it("accepts a 500-row preview with historical/non-activated defaults and rejects 501 before persistence", async () => {
    const rowIds = Array.from(
      { length: 501 },
      (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const batchId = "30000000-0000-4000-8000-000000001000";
    const repo = { preview: vi.fn(), execute: vi.fn() };
    await previewNarApplyForActor(actor, { batchId, rowIds: rowIds.slice(0, 500) }, repo);
    expect(repo.preview).toHaveBeenCalledExactlyOnceWith(actor, {
      batchId,
      rowIds: rowIds.slice(0, 500),
      inputs: {},
      dataOrigin: "historical",
      activateCurrentYear: false,
    });
    await expect(previewNarApplyForActor(actor, { batchId, rowIds }, repo)).rejects.toThrow();
    expect(repo.preview).toHaveBeenCalledTimes(1);
    expect(repo.execute).not.toHaveBeenCalled();
  });
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
