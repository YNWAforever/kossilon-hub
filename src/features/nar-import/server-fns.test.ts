import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  applyNarImportForActor,
  approveNarImportForActor,
  getNarImportBatchReviewForActor,
  mapNarImportCompanyForActor,
  stageNarImportForActor,
  queueNarImportStageForActor,
  getNarImportStageJobForActor,
  searchImportCompaniesForActor,
  revalidateNarImportForActor,
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

  it("keeps company search and preview behind import authority", async () => {
    const repository = {
      searchCompanies: vi.fn(async () => ({ items: [], nextCursor: null })),
      revalidate: vi.fn(async () => ({ id: "preview-1" })),
    };
    const dependencies = { repository } as unknown as Parameters<
      typeof searchImportCompaniesForActor
    >[2];
    await expect(
      searchImportCompaniesForActor(
        actor("Manager"),
        { q: "", cursor: null, limit: 20 },
        dependencies,
      ),
    ).rejects.toThrow(/Admin access/);
    await expect(
      revalidateNarImportForActor(
        actor("Staff"),
        { batchId: "33333333-3333-4333-8333-333333333333", expectedRevision: 1 },
        dependencies,
      ),
    ).rejects.toThrow(/Admin access/);
    expect(repository.searchCompanies).not.toHaveBeenCalled();
    expect(repository.revalidate).not.toHaveBeenCalled();
    await searchImportCompaniesForActor(
      actor("Admin"),
      { q: "", cursor: null, limit: 20 },
      dependencies,
    );
    expect(repository.searchCompanies).toHaveBeenCalledTimes(1);
  });

  it("keeps T11 approval and apply behind Admin authority before repository access", async () => {
    const approvalRepository = { approve: vi.fn(async () => ({ id: "approval" })) };
    const bulkRepository = { commitImportApproval: vi.fn(async () => ({ id: "operation" })) };
    await expect(
      approveNarImportForActor(
        actor("Manager"),
        { previewId: "11111111-1111-4111-8111-111111111111", previewHash: "a".repeat(64) },
        approvalRepository as unknown as Parameters<typeof approveNarImportForActor>[2],
      ),
    ).rejects.toThrow(/Admin access/);
    await expect(
      applyNarImportForActor(
        actor("Staff"),
        { approvalId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "T11-test-key" },
        bulkRepository as unknown as Parameters<typeof applyNarImportForActor>[2],
      ),
    ).rejects.toThrow(/Admin access/);
    expect(approvalRepository.approve).not.toHaveBeenCalled();
    expect(bulkRepository.commitImportApproval).not.toHaveBeenCalled();
    await approveNarImportForActor(
      actor("Admin"),
      { previewId: "11111111-1111-4111-8111-111111111111", previewHash: "a".repeat(64) },
      approvalRepository as unknown as Parameters<typeof approveNarImportForActor>[2],
    );
    expect(approvalRepository.approve).toHaveBeenCalledTimes(1);
  });

  it("t27_scenario_2 queues private bytes only for Admin and scopes job status to its creator", async () => {
    const storage = { put: vi.fn(async () => ({})), delete: vi.fn(async () => undefined) };
    const job = {
      id: "33333333-3333-4333-8333-333333333333",
      state: "queued",
      attempts: 0,
      result: null,
      errorCode: null,
    };
    const jobs = {
      enqueue: vi.fn(async () => ({ job, reused: false })),
      getForActor: vi.fn(async (_id: string, userId: string) =>
        userId === actor("Admin").userId ? job : null,
      ),
    };
    const dependencies = { jobs, storage } as unknown as Parameters<
      typeof queueNarImportStageForActor
    >[2];
    const input = {
      fileName: "synthetic.xlsx",
      bodyBase64: btoa("synthetic workbook"),
      returnYear: 2026,
    };
    await expect(
      queueNarImportStageForActor(actor("Manager"), input, dependencies),
    ).rejects.toThrow(/Admin access/);
    expect(storage.put).not.toHaveBeenCalled();
    const queued = await queueNarImportStageForActor(actor("Admin"), input, dependencies);
    expect(queued).toMatchObject({ id: job.id, state: "queued" });
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringMatching(/^nar-import\/staging\//),
        sizeBytes: 18,
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: actor("Admin").userId,
        returnYear: 2026,
      }),
    );
    expect(await getNarImportStageJobForActor(actor("Admin"), job.id, jobs as never)).toMatchObject(
      { id: job.id, state: "queued" },
    );
    await expect(
      getNarImportStageJobForActor(actor("Staff"), job.id, jobs as never),
    ).rejects.toThrow(/Admin access/);
  });

  it("refuses ordinary staff", async () => {
    await expect(
      getNarImportBatchReviewForActor(actor("Staff"), { batchId: "batch-1" }, deps()),
    ).rejects.toThrow(/Forbidden/);
  });
});
