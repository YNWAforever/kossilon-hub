import { describe, expect, it, vi } from "vitest";
import { drainNarImportStageJobs } from "./stage-worker";
import { XlsxFormatError } from "./xlsx/workbook";

const actor = {
  authUserId: "auth-admin",
  userId: "11111111-1111-4111-8111-111111111111",
  role: "Admin" as const,
  teamId: null,
  active: true as const,
};

async function fixture() {
  const bytes = new TextEncoder().encode("synthetic workbook bytes");
  const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = [...hashBytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  const job = {
    id: crypto.randomUUID(),
    sourceFileName: "fixture.xlsx",
    sourceSha256: checksum,
    sourceSizeBytes: bytes.byteLength,
    objectKey: `nar-import/staging/${crypto.randomUUID()}`,
    sheetName: null,
    returnYear: 2026,
    createdBy: actor.userId,
    state: "processing" as const,
    attempts: 1,
    leaseToken: crypto.randomUUID(),
    leaseExpiresAt: "2026-09-28T01:00:00Z",
    result: null,
    errorCode: null,
    objectDeletedAt: null,
  };
  const jobs = {
    failExhausted: vi.fn(async () => 0),
    claimOne: vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null),
    activeAdminActor: vi.fn(async () => actor),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    listCleanupCandidates: vi.fn(async () => [job]),
    markObjectDeleted: vi.fn(async () => true),
  };
  const storage = {
    get: vi.fn(async () => ({
      objectKey: job.objectKey,
      checksum,
      sizeBytes: bytes.byteLength,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: bytes.buffer,
    })),
    delete: vi.fn(async () => undefined),
  };
  return { bytes, job, jobs, storage };
}

describe("T27 background workbook parser", () => {
  it("t27_scenario_2 verifies private bytes, stages with the original Admin identity and cleans terminal storage", async () => {
    const fx = await fixture();
    const stage = vi.fn(async () => ({
      batch: { id: crypto.randomUUID() },
      reused: false,
      skippedRowNumbers: [],
      sheetIssues: [],
    }));
    const result = await drainNarImportStageJobs("2026-09-28T00:00:00Z", {
      jobs: fx.jobs as never,
      storage: fx.storage as never,
      stage,
    });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, cleaned: 1 });
    expect(stage).toHaveBeenCalledWith(actor, {
      fileName: fx.job.sourceFileName,
      bytes: fx.bytes,
      sheetName: undefined,
      returnYear: fx.job.returnYear,
    });
    expect(fx.jobs.complete).toHaveBeenCalledWith(
      fx.job.id,
      fx.job.leaseToken,
      expect.objectContaining({ batchId: expect.any(String) }),
    );
    expect(fx.storage.delete).toHaveBeenCalledWith(fx.job.objectKey);
  });

  it("t27_scenario_2 rejects altered private bytes before workbook parsing", async () => {
    const fx = await fixture();
    const changed = new TextEncoder().encode("altered workbook bytes");
    fx.storage.get.mockResolvedValueOnce({
      objectKey: fx.job.objectKey,
      checksum: fx.job.sourceSha256,
      sizeBytes: fx.job.sourceSizeBytes,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: changed.buffer,
    });
    const stage = vi.fn();
    const result = await drainNarImportStageJobs("2026-09-28T00:00:00Z", {
      jobs: fx.jobs as never,
      storage: fx.storage as never,
      stage,
    });
    expect(result.failed).toBe(1);
    expect(stage).not.toHaveBeenCalled();
    expect(fx.jobs.fail).toHaveBeenCalledWith(
      fx.job.id,
      fx.job.leaseToken,
      "source_checksum_invalid",
      true,
    );
  });

  it("retains a parser-owned refusal for the Admin without retrying invalid bytes", async () => {
    const fx = await fixture();
    const stage = vi.fn(async () => {
      throw new XlsxFormatError(
        "This workbook contains macros. Save it as a plain .xlsx and try again.",
      );
    });
    const result = await drainNarImportStageJobs("2026-09-28T00:00:00Z", {
      jobs: fx.jobs as never,
      storage: fx.storage as never,
      stage,
    });
    expect(result).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    expect(fx.jobs.fail).toHaveBeenCalledWith(
      fx.job.id,
      fx.job.leaseToken,
      "invalid_workbook",
      true,
      "This workbook contains macros. Save it as a plain .xlsx and try again.",
    );
  });

  it("t27_scenario_2 refuses parsing after the uploader loses Admin authority", async () => {
    const fx = await fixture();
    fx.jobs.activeAdminActor.mockResolvedValueOnce(null as never);
    const stage = vi.fn();
    const result = await drainNarImportStageJobs("2026-09-28T00:00:00Z", {
      jobs: fx.jobs as never,
      storage: fx.storage as never,
      stage,
    });
    expect(result.failed).toBe(1);
    expect(stage).not.toHaveBeenCalled();
    expect(fx.jobs.fail).toHaveBeenCalledWith(
      fx.job.id,
      fx.job.leaseToken,
      "creator_not_admin",
      true,
    );
  });
});
