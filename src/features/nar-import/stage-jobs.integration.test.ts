import { afterAll, describe, expect, it, vi } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createNarImportStageJobRepository } from "./stage-jobs";
import { createNarImportRepository } from "./repository";
import { stageNarImportBytesForActor } from "./server-fns";
import { drainNarImportStageJobs } from "./stage-worker";
import { syntheticNarWorkbook } from "./xlsx/test-workbook";
import { readXlsxWorkbook } from "./xlsx/workbook";
import { readNarSheet } from "./mapping";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 2 }) : null;
const hash = () => crypto.randomUUID().replaceAll("-", "").repeat(2);

describe.skipIf(!databaseUrl)("T27 durable import staging", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it("t27_scenario_2 reuses an upload and resumes a leased parse without double staging", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const [admin] = await sql<{ user_id: string }[]>`
      select sp.user_id from staff_profiles sp join users u on u.id=sp.user_id and u.active
      where sp.role='Admin' and sp.active limit 1`;
    if (!admin) throw new Error("Seeded Admin is required");
    const jobs = createNarImportStageJobRepository({ sql });
    const sourceSha256 = hash();
    const firstInput = {
      sourceFileName: "t27.xlsx",
      sourceSha256,
      sourceSizeBytes: 100,
      objectKey: `nar-import/staging/${crypto.randomUUID()}`,
      sheetName: null,
      returnYear: 2026,
      createdBy: admin.user_id,
    };
    try {
      const first = await jobs.enqueue(firstInput);
      expect(first.reused).toBe(false);
      const replay = await jobs.enqueue({
        ...firstInput,
        objectKey: `nar-import/staging/${crypto.randomUUID()}`,
      });
      expect(replay.reused).toBe(true);
      expect(replay.job.id).toBe(first.job.id);
      const at = "2026-09-28T00:00:00.000Z";
      const claimed = await jobs.claimOne(at);
      expect(claimed?.id).toBe(first.job.id);
      expect(claimed?.attempts).toBe(1);
      const reclaimed = await jobs.claimOne("2026-09-28T00:11:00.000Z");
      expect(reclaimed?.id).toBe(first.job.id);
      expect(reclaimed?.attempts).toBe(2);
      expect(reclaimed?.leaseToken).not.toBe(claimed?.leaseToken);
      const result = {
        batchId: crypto.randomUUID(),
        reused: false,
        skippedRowNumbers: [],
        sheetIssues: [],
      };
      expect(await jobs.complete(first.job.id, claimed!.leaseToken!, result)).toBe(false);
      expect(await jobs.complete(first.job.id, reclaimed!.leaseToken!, result)).toBe(true);
      expect((await jobs.getForActor(first.job.id, admin.user_id))?.state).toBe("succeeded");
      expect(await jobs.getForActor(first.job.id, crypto.randomUUID())).toBeNull();
      const cleanup = await jobs.listCleanupCandidates(10);
      expect(cleanup.some((candidate) => candidate.id === first.job.id)).toBe(true);
      expect(await jobs.markObjectDeleted(first.job.id)).toBe(true);
      expect(
        (await jobs.listCleanupCandidates(10)).some((candidate) => candidate.id === first.job.id),
      ).toBe(false);
    } finally {
      await sql`delete from nar_import_stage_jobs where source_sha256=${sourceSha256}`;
      await jobs.close();
    }
  });
  it("t27_scenario_2 delays transient retry and permits a new upload after terminal failure", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const [admin] = await sql<{ user_id: string }[]>`
      select sp.user_id from staff_profiles sp join users u on u.id=sp.user_id and u.active
      where sp.role='Admin' and sp.active limit 1`;
    if (!admin) throw new Error("Seeded Admin is required");
    const jobs = createNarImportStageJobRepository({ sql });
    const sourceSha256 = hash();
    const input = {
      sourceFileName: "retry.xlsx",
      sourceSha256,
      sourceSizeBytes: 100,
      objectKey: `nar-import/staging/${crypto.randomUUID()}`,
      sheetName: null,
      returnYear: 2026,
      createdBy: admin.user_id,
    };
    try {
      const first = await jobs.enqueue(input);
      const now = new Date().toISOString();
      const claimed = await jobs.claimOne(now);
      expect(claimed?.id).toBe(first.job.id);
      expect(
        await jobs.fail(first.job.id, claimed!.leaseToken!, "parse_or_stage_failed", false),
      ).toBe(true);
      const deferred = await jobs.getForActor(first.job.id, admin.user_id);
      expect(deferred?.state).toBe("queued");
      expect(Date.parse(deferred!.leaseExpiresAt!)).toBeGreaterThan(Date.parse(now));
      const immediatelyClaimed = await jobs.claimOne(now);
      expect(immediatelyClaimed?.id).not.toBe(first.job.id);
      const later = new Date(Date.now() + 7 * 60_000).toISOString();
      const retry = await jobs.claimOne(later);
      expect(retry?.id).toBe(first.job.id);
      expect(retry?.attempts).toBe(2);
      expect(await jobs.fail(first.job.id, retry!.leaseToken!, "invalid_workbook", true)).toBe(
        true,
      );
      const replacement = await jobs.enqueue({
        ...input,
        objectKey: `nar-import/staging/${crypto.randomUUID()}`,
      });
      expect(replacement.reused).toBe(false);
      expect(replacement.job.id).not.toBe(first.job.id);
    } finally {
      await sql`delete from nar_import_stage_jobs where source_sha256=${sourceSha256}`;
      await jobs.close();
    }
  });
  it.skipIf(process.env.RUN_T27_IMPORT_SCALE !== "1")(
    "t27_scenario_2 background parses and atomically stages a real synthetic 10k-row XLSX",
    async () => {
      if (!sql) throw new Error("TEST_DATABASE_URL is required");
      const [admin] = await sql<{ user_id: string }[]>`
        select sp.user_id from staff_profiles sp join users u on u.id=sp.user_id and u.active
        where sp.role='Admin' and sp.active limit 1`;
      if (!admin) throw new Error("Seeded Admin is required");
      const bytes = syntheticNarWorkbook(10_000);
      const workbook = await readXlsxWorkbook(bytes);
      expect(readNarSheet(workbook.sheets[0], workbook.date1904).rows).toHaveLength(10_000);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
      );
      const sourceSha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
      const objectKey = `nar-import/staging/${crypto.randomUUID()}`;
      const jobs = createNarImportStageJobRepository({ sql });
      const imports = createNarImportRepository({ sql });
      const stored = new Map([[objectKey, bytes]]);
      const storage = {
        get: vi.fn(async (key: string) => {
          const body = stored.get(key);
          return body
            ? {
                objectKey: key,
                checksum: sourceSha256,
                sizeBytes: body.byteLength,
                contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                body: body.buffer,
              }
            : null;
        }),
        delete: vi.fn(async (key: string) => {
          stored.delete(key);
        }),
      };
      try {
        const queued = await jobs.enqueue({
          sourceFileName: "synthetic-10k.xlsx",
          sourceSha256,
          sourceSizeBytes: bytes.byteLength,
          objectKey,
          sheetName: null,
          returnYear: 2026,
          createdBy: admin.user_id,
        });
        const summary = await drainNarImportStageJobs(
          new Date().toISOString(),
          {
            jobs,
            storage: storage as never,
            stage: (actor, input) =>
              stageNarImportBytesForActor(actor, input, { repository: imports }),
          },
          1,
        );
        expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, cleaned: 1 });
        const result = await jobs.getForActor(queued.job.id, admin.user_id);
        expect(result?.state).toBe("succeeded");
        expect(stored.size).toBe(0);
        const [count] = await sql<{ count: string }[]>`
          select count(*) from nar_import_rows where batch_id=${result!.result!.batchId}`;
        expect(Number(count.count)).toBe(10_000);
        const replay = await jobs.enqueue({
          sourceFileName: "synthetic-10k.xlsx",
          sourceSha256,
          sourceSizeBytes: bytes.byteLength,
          objectKey: `nar-import/staging/${crypto.randomUUID()}`,
          sheetName: null,
          returnYear: 2026,
          createdBy: admin.user_id,
        });
        expect(replay.reused).toBe(true);
        expect(replay.job.id).toBe(queued.job.id);
      } finally {
        await sql`delete from nar_import_stage_jobs where source_sha256=${sourceSha256}`;
        await sql`delete from nar_import_batches where source_sha256=${sourceSha256}`;
        await imports.close();
        await jobs.close();
      }
    },
    180_000,
  );
  it("t27_scenario_2 resumes after staging committed but job acknowledgement crashed", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const [admin] = await sql<{ user_id: string }[]>`
      select sp.user_id from staff_profiles sp join users u on u.id=sp.user_id and u.active
      where sp.role='Admin' and sp.active limit 1`;
    if (!admin) throw new Error("Seeded Admin is required");
    const bytes = syntheticNarWorkbook(1);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
    );
    const sourceSha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
    const objectKey = `nar-import/staging/${crypto.randomUUID()}`;
    const jobs = createNarImportStageJobRepository({ sql });
    const imports = createNarImportRepository({ sql });
    const storage = {
      get: vi.fn(async () => ({
        objectKey,
        checksum: sourceSha256,
        sizeBytes: bytes.byteLength,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: bytes.buffer,
      })),
      delete: vi.fn(async () => undefined),
    };
    let crash = true;
    const stage = async (
      actor: Parameters<typeof stageNarImportBytesForActor>[0],
      input: Parameters<typeof stageNarImportBytesForActor>[1],
    ) => {
      const result = await stageNarImportBytesForActor(actor, input, { repository: imports });
      if (crash) {
        crash = false;
        throw new Error("Synthetic acknowledgement crash");
      }
      return result;
    };
    try {
      const queued = await jobs.enqueue({
        sourceFileName: "resume.xlsx",
        sourceSha256,
        sourceSizeBytes: bytes.byteLength,
        objectKey,
        sheetName: null,
        returnYear: 2026,
        createdBy: admin.user_id,
      });
      const first = await drainNarImportStageJobs(
        new Date().toISOString(),
        {
          jobs,
          storage: storage as never,
          stage,
        },
        1,
      );
      expect(first).toMatchObject({ claimed: 1, retried: 1, succeeded: 0 });
      expect((await jobs.getForActor(queued.job.id, admin.user_id))?.state).toBe("queued");
      const retryAt = new Date(Date.now() + 7 * 60_000).toISOString();
      const second = await drainNarImportStageJobs(
        retryAt,
        {
          jobs,
          storage: storage as never,
          stage,
        },
        1,
      );
      expect(second).toMatchObject({ claimed: 1, retried: 0, succeeded: 1, cleaned: 1 });
      const [batches] = await sql<{ count: string }[]>`
        select count(*) from nar_import_batches where source_sha256=${sourceSha256}`;
      expect(Number(batches.count)).toBe(1);
      expect((await jobs.getForActor(queued.job.id, admin.user_id))?.result?.reused).toBe(true);
    } finally {
      await sql`delete from nar_import_stage_jobs where source_sha256=${sourceSha256}`;
      await sql`delete from nar_import_batches where source_sha256=${sourceSha256}`;
      await imports.close();
      await jobs.close();
    }
  });
});
