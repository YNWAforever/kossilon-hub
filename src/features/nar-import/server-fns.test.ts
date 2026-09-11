import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  getNarImportBatchReviewForActor,
  mapNarImportCompanyForActor,
  stageNarImportForActor,
} from "./server-fns";

/**
 * Who may import, and who may read what an import staged.
 *
 * There was no test file here at all, which is how a Manager kept an authority
 * the module's own comment argued against: `getNarImportBatchReview` applies no
 * team scope, and every staged row carries `raw` -- the spreadsheet cells
 * verbatim -- for every company in the workbook, other teams' included. The
 * refusal is now pinned rather than assumed.
 */

function actor(role: AuthenticatedActor["role"]): AuthenticatedActor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    authUserId: "auth-user",
    email: "someone@example.test",
    name: "Someone",
    role,
    teamId: "22222222-2222-4222-8222-222222222222",
    active: true,
  } as AuthenticatedActor;
}

function repository() {
  return {
    createBatch: vi.fn(async () => ({ id: "batch-1" })),
    listBatches: vi.fn(async () => []),
    getBatchReview: vi.fn(async () => null),
    mapCompany: vi.fn(async () => ({ mapped: 0 })),
    close: vi.fn(async () => {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deps = () => ({ repository: repository() }) as any;

describe("import authority", () => {
  /**
   * Importing rewrites how a whole month of cases is understood and reaches
   * across every company at once -- the same reasoning that makes
   * cleanupExpiredUploads Admin-only. The code said so in a comment and then
   * admitted Managers anyway.
   */
  it("refuses a Manager, whose reach is a team and not the whole book", async () => {
    const manager = actor("Manager");

    await expect(
      stageNarImportForActor(
        manager,
        { fileName: "m.xlsx", bodyBase64: "", returnYear: 2026 },
        deps(),
      ),
    ).rejects.toThrow(/Forbidden: Admin access is required/);

    // The read matters as much as the write: this is the one that returns raw
    // spreadsheet cells for every company in the batch.
    await expect(
      getNarImportBatchReviewForActor(manager, { batchId: "batch-1" }, deps()),
    ).rejects.toThrow(/Forbidden: Admin access is required/);

    await expect(
      mapNarImportCompanyForActor(
        manager,
        { externalClientId: "CL-001", companyId: "33333333-3333-4333-8333-333333333333" },
        deps(),
      ),
    ).rejects.toThrow(/Forbidden: Admin access is required/);
  });

  it("refuses ordinary staff", async () => {
    await expect(
      getNarImportBatchReviewForActor(actor("Staff"), { batchId: "batch-1" }, deps()),
    ).rejects.toThrow(/Forbidden/);
  });
});
