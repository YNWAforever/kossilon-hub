import { afterAll, describe, expect, it, vi } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createMaintenanceJobRepository } from "@/features/operations/maintenance-job-repository";
import {
  authorizeMaintenanceRequest,
  createMaintenanceTrigger,
  type MaintenanceJobKind,
  type MaintenanceJobStore,
} from "./maintenance-trigger";

const slot = "2026-09-27T01:00:00.000Z";
const jobs: MaintenanceJobKind[] = ["evaluateEscalations", "settleNotificationAttempts"];

function memoryStore(): MaintenanceJobStore {
  const rows = new Map<
    string,
    { token: string; state: "claimed" | "started" | "succeeded" | "failed"; expires: string }
  >();
  return {
    claim: vi.fn(async ({ trigger, scheduledAt, job, now, leaseExpiresAt }) => {
      const key = trigger === "scheduled" ? `${scheduledAt}:${job}` : crypto.randomUUID();
      const prior = rows.get(key);
      if (prior && !(prior.state === "claimed" && prior.expires <= now)) return null;
      const token = crypto.randomUUID();
      rows.set(key, { token, state: "claimed", expires: leaseExpiresAt });
      return { token };
    }),
    stateOf: vi.fn(async (scheduledAt, job) => rows.get(`${scheduledAt}:${job}`)?.state ?? null),
    begin: vi.fn(async (_scheduledAt, _job, token) => {
      const row = [...rows.values()].find((candidate) => candidate.token === token);
      if (!row || row.token !== token || row.state !== "claimed") return false;
      row.state = "started";
      return true;
    }),
    finish: vi.fn(async (_scheduledAt, _job, token, outcome) => {
      const row = [...rows.values()].find((candidate) => candidate.token === token);
      if (!row || row.token !== token || row.state !== "started") return false;
      row.state = outcome;
      return true;
    }),
    close: vi.fn(async () => undefined),
  };
}

describe("T07 maintenance trigger", () => {
  it.each(["claim", "begin"] as const)(
    "records partial evidence when %s throws and does not execute that job",
    async (method) => {
      const store = memoryStore();
      if (method === "claim") {
        const claim = store.claim.bind(store);
        store.claim = async (input) => {
          if (input.job === "runNarImportStageJobs") throw new Error("private DB failure");
          return claim(input);
        };
      } else {
        const begin = store.begin.bind(store);
        store.begin = async (at, job, token) => {
          if (job === "runNarImportStageJobs") throw new Error("private DB failure");
          return begin(at, job, token);
        };
      }
      const executed: MaintenanceJobKind[] = [];
      const recorded: unknown[] = [];
      const result = await createMaintenanceTrigger({
        store,
        runJob: async (job) => {
          executed.push(job);
        },
        recordRun: async (run) => {
          recorded.push(run);
        },
      }).runMaintenanceTick({
        trigger: "scheduled",
        scheduledAt: slot,
        runId: "claim-failure-regression",
        allowedJobs: ["evaluateEscalations", "runNarImportStageJobs", "redactNotifications"],
      });
      expect(result.outcome).toBe("partial");
      expect(result.jobs).toEqual([
        { job: "evaluateEscalations", state: "succeeded" },
        { job: "runNarImportStageJobs", state: "unknown" },
        { job: "redactNotifications", state: "succeeded" },
      ]);
      expect(executed).toEqual(["evaluateEscalations", "redactNotifications"]);
      expect(recorded).toEqual([result]);
      expect(JSON.stringify(recorded)).not.toContain("private");
    },
  );

  it("t07_scenario_1 deduplicates a scheduled slot and recovers an unstarted expired lease", async () => {
    const store = memoryStore();
    const runJob = vi.fn(async () => ({ processed: 1 }));
    const trigger = createMaintenanceTrigger({ store, runJob });
    const input = {
      trigger: "scheduled" as const,
      scheduledAt: slot,
      runId: "run-a",
      allowedJobs: jobs,
    };
    const first = await trigger.runMaintenanceTick(input);
    const duplicate = await trigger.runMaintenanceTick({ ...input, runId: "run-b" });
    expect(first.outcome).toBe("succeeded");
    expect(duplicate.outcome).toBe("skipped");
    expect(runJob).toHaveBeenCalledTimes(2);

    const later = "2026-09-27T01:20:00.000Z";
    const strandedSlot = "2026-09-27T01:05:00.000Z";
    await store.claim({
      trigger: "scheduled",
      scheduledAt: strandedSlot,
      job: jobs[0],
      runId: "crashed",
      now: slot,
      leaseExpiresAt: "2026-09-27T01:15:00.000Z",
    });
    const resumed = await createMaintenanceTrigger({
      store,
      runJob,
      clock: () => new Date(later),
    }).runMaintenanceTick({
      trigger: "scheduled",
      scheduledAt: strandedSlot,
      runId: "recovered",
      allowedJobs: [jobs[0]],
    });
    expect(resumed.outcome).toBe("succeeded");
    expect(runJob).toHaveBeenCalledTimes(3);
  });

  it("t07_scenario_2 rejects unsigned HTTP and keeps manual runs out of scheduled success", async () => {
    const secret = "a-long-test-secret-value";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const wrong = new Request("https://example.test/api/cron/maintenance", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(authorizeMaintenanceRequest(wrong, secret)).toBe(false);
    expect(
      authorizeMaintenanceRequest(
        new Request(wrong.url, { headers: { authorization: `Bearer ${secret}` } }),
        secret,
      ),
    ).toBe(true);
    expect(log.mock.calls.flat().join(" ")).not.toContain(secret);
    log.mockRestore();

    const ownerBefore = process.env.MAINTENANCE_SCHEDULER_OWNER;
    const secretBefore = process.env.CRON_SECRET;
    try {
      process.env.MAINTENANCE_SCHEDULER_OWNER = "vercel";
      process.env.CRON_SECRET = secret;
      const { default: server } = await import("../server");
      const response = await server.fetch(
        new Request(wrong.url, {
          headers: { authorization: "Bearer wrong", cookie: "session=admin" },
        }),
        {},
        {},
      );
      expect(response.status).toBe(401);
      process.env.MAINTENANCE_SCHEDULER_OWNER = "cloudflare";
      const wrongOwner = await server.fetch(
        new Request(wrong.url, { headers: { authorization: `Bearer ${secret}` } }),
        {},
        {},
      );
      expect(wrongOwner.status).toBe(503);
    } finally {
      if (ownerBefore === undefined) delete process.env.MAINTENANCE_SCHEDULER_OWNER;
      else process.env.MAINTENANCE_SCHEDULER_OWNER = ownerBefore;
      if (secretBefore === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secretBefore;
    }

    const store = memoryStore();
    const runJob = vi.fn(async () => ({ processed: 1 }));
    const trigger = createMaintenanceTrigger({ store, runJob });
    const manual = await trigger.runMaintenanceTick({
      trigger: "manual",
      scheduledAt: slot,
      runId: "manual-1",
      allowedJobs: jobs,
    });
    expect(manual.trigger).toBe("manual");
    expect(manual.outcome).toBe("succeeded");
    expect(
      await trigger.runMaintenanceTick({
        trigger: "scheduled",
        scheduledAt: slot,
        runId: "scheduled-1",
        allowedJobs: jobs,
      }),
    ).toMatchObject({ trigger: "scheduled", outcome: "succeeded" });
  });

  it("t07_scenario_3 records one failed job independently and retries on the next tick", async () => {
    const store = memoryStore();
    const runJob = vi.fn(async (job: MaintenanceJobKind) => {
      if (job === jobs[0] && runJob.mock.calls.length === 1)
        throw new Error("injected job failure");
      return { processed: 1 };
    });
    const trigger = createMaintenanceTrigger({ store, runJob });
    const first = await trigger.runMaintenanceTick({
      trigger: "scheduled",
      scheduledAt: slot,
      runId: "run-1",
      allowedJobs: jobs,
    });
    expect(first.outcome).toBe("partial");
    expect(first.jobs).toMatchObject([
      { job: jobs[0], state: "failed" },
      { job: jobs[1], state: "succeeded" },
    ]);
    const next = await trigger.runMaintenanceTick({
      trigger: "scheduled",
      scheduledAt: "2026-09-27T01:05:00.000Z",
      runId: "run-2",
      allowedJobs: jobs,
    });
    expect(next.outcome).toBe("succeeded");
    expect(runJob).toHaveBeenCalledTimes(4);

    const interruptedStore = memoryStore();
    const interruptedAt = "2026-09-27T01:10:00.000Z";
    const prior = await interruptedStore.claim({
      trigger: "scheduled",
      scheduledAt: interruptedAt,
      job: jobs[0],
      runId: "prior",
      now: slot,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(await interruptedStore.begin(interruptedAt, jobs[0], prior!.token)).toBe(true);
    expect(await interruptedStore.finish(interruptedAt, jobs[0], prior!.token, "failed")).toBe(
      true,
    );
    const resumedPartial = await createMaintenanceTrigger({
      store: interruptedStore,
      runJob: async () => ({ processed: 1 }),
    }).runMaintenanceTick({
      trigger: "scheduled",
      scheduledAt: interruptedAt,
      runId: "resume-after-partial",
      allowedJobs: jobs,
    });
    expect(resumedPartial.outcome).toBe("partial");
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 3 }) : null;

describe.skipIf(!databaseUrl)("T07 lease SQL against disposable Postgres", () => {
  it("accepts every currently enabled scheduled job kind in the migrated database", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const { scheduledJobsForRuntime } = await import("./maintenance-trigger-runtime");
    const allowedJobs = [
      ...scheduledJobsForRuntime({ VITE_PROVIDER_MODE: "live" }),
      "drainInboundMediaDownloads",
    ] as MaintenanceJobKind[];
    const scheduledAt = new Date(
      Date.now() + 900000 + Math.floor(Math.random() * 100000),
    ).toISOString();
    const repository = createMaintenanceJobRepository({ sql });
    try {
      for (const job of allowedJobs) {
        const claim = await repository.claim({
          trigger: "scheduled",
          scheduledAt,
          job,
          runId: "all-runtime-jobs",
          now: scheduledAt,
          leaseExpiresAt: new Date(Date.parse(scheduledAt) + 900000).toISOString(),
        });
        expect(claim, job).not.toBeNull();
        expect(await repository.begin(scheduledAt, job, claim!.token), job).toBe(true);
        expect(await repository.finish(scheduledAt, job, claim!.token, "succeeded"), job).toBe(
          true,
        );
      }
      const rows = await sql<{ job_kind: string; state: string }[]>`
        select job_kind, state from maintenance_job_runs where scheduled_for = ${scheduledAt}
      `;
      expect(rows).toHaveLength(7);
      expect(rows.find((row) => row.job_kind === "runNarImportStageJobs")?.state).toBe("succeeded");
    } finally {
      await sql`delete from maintenance_job_runs where scheduled_for = ${scheduledAt}`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("records real manual and scheduled runs separately without a provider send", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const { runMaintenanceTickOnServer } = await import("./maintenance-trigger-runtime");
    const scheduledAt = new Date(
      Date.now() + 123456 + Math.floor(Math.random() * 100000),
    ).toISOString();
    const allowedJobs: MaintenanceJobKind[] = ["escalateStalledQuarantine"];
    const priorDeployment = process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567";
    try {
      const manual = await runMaintenanceTickOnServer({
        trigger: "manual",
        scheduledAt,
        runId: "t07-manual",
        allowedJobs,
      });
      const scheduled = await runMaintenanceTickOnServer({
        trigger: "scheduled",
        scheduledAt,
        runId: "t07-scheduled",
        allowedJobs,
      });
      expect(manual.outcome).toBe("succeeded");
      expect(scheduled.outcome).toBe("succeeded");
      const runs = await sql<{ trigger_source: string; outcome: string }[]>`
        select trigger_source, outcome from maintenance_runs
        where scheduled_for = ${scheduledAt} order by trigger_source
      `;
      expect(runs).toMatchObject([
        { trigger_source: "manual", outcome: "succeeded" },
        { trigger_source: "scheduled", outcome: "succeeded" },
      ]);
      const { createMaintenanceRunRepository } = await import("@/features/operations/repository");
      const runRepository = createMaintenanceRunRepository(databaseUrl);
      try {
        const persisted = (await runRepository.listRecentRuns(20)).filter(
          (run) => run.scheduledFor === scheduledAt,
        );
        expect(persisted).toHaveLength(2);
        expect(persisted.map((run) => run.deploymentRef)).toEqual([
          "abcdef1234567",
          "abcdef1234567",
        ]);
      } finally {
        await runRepository.close();
      }
      const jobs = await sql<{ trigger_source: string; state: string }[]>`
        select trigger_source, state from maintenance_job_runs
        where scheduled_for = ${scheduledAt} order by trigger_source
      `;
      expect(jobs).toMatchObject([
        { trigger_source: "manual", state: "succeeded" },
        { trigger_source: "scheduled", state: "succeeded" },
      ]);
    } finally {
      if (priorDeployment === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = priorDeployment;
      await sql`delete from maintenance_job_runs where scheduled_for = ${scheduledAt}`;
      await sql`delete from maintenance_runs where scheduled_for = ${scheduledAt}`;
    }
  });

  it("persists a resumed same-slot failure as partial instead of success", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const { runMaintenanceTickOnServer } = await import("./maintenance-trigger-runtime");
    const scheduledAt = new Date(
      Date.now() + 400000 + Math.floor(Math.random() * 100000),
    ).toISOString();
    const repository = createMaintenanceJobRepository({ sql });
    try {
      const claim = await repository.claim({
        trigger: "scheduled",
        scheduledAt,
        job: "evaluateEscalations",
        runId: "interrupted-after-failure",
        now: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 900000).toISOString(),
      });
      expect(claim).not.toBeNull();
      expect(await repository.begin(scheduledAt, "evaluateEscalations", claim!.token)).toBe(true);
      expect(
        await repository.finish(scheduledAt, "evaluateEscalations", claim!.token, "failed"),
      ).toBe(true);
      const result = await runMaintenanceTickOnServer({
        trigger: "scheduled",
        scheduledAt,
        runId: "resume-after-failure",
        allowedJobs: ["evaluateEscalations", "escalateStalledQuarantine"],
      });
      expect(result.outcome).toBe("partial");
      expect(result.jobs[0]).toMatchObject({ state: "skipped", priorState: "failed" });
      const runs = await sql<{ outcome: string; failed_passes: string[] }[]>`
        select outcome, failed_passes from maintenance_runs
        where scheduled_for = ${scheduledAt} and trigger_source = 'scheduled'
      `;
      expect(runs).toMatchObject([
        {
          outcome: "partial",
          failed_passes: ["evaluateEscalations"],
        },
      ]);
    } finally {
      await sql`delete from maintenance_job_runs where scheduled_for = ${scheduledAt}`;
      await sql`delete from maintenance_runs where scheduled_for = ${scheduledAt}`;
    }
  });

  it("serializes concurrent claims and only recovers an unstarted expired claim", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const start = new Date();
    const scheduledAt = new Date(
      start.getTime() + Math.floor(Math.random() * 100000),
    ).toISOString();
    const secondAt = new Date(
      start.getTime() + 300000 + Math.floor(Math.random() * 100000),
    ).toISOString();
    const repo = createMaintenanceJobRepository({ sql });
    const claimInput = {
      trigger: "scheduled" as const,
      scheduledAt,
      job: "evaluateEscalations" as const,
      runId: "concurrent-a",
      now: start.toISOString(),
      leaseExpiresAt: new Date(start.getTime() + 15 * 60000).toISOString(),
    };
    try {
      const [a, b] = await Promise.all([
        repo.claim(claimInput),
        repo.claim({ ...claimInput, runId: "concurrent-b" }),
      ]);
      const winner = a ?? b;
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(winner).not.toBeNull();
      expect(await repo.begin(scheduledAt, claimInput.job, winner!.token)).toBe(true);
      expect(
        await repo.claim({
          ...claimInput,
          now: new Date(start.getTime() + 3600000).toISOString(),
          leaseExpiresAt: new Date(start.getTime() + 4500000).toISOString(),
        }),
      ).toBeNull();
      expect(await repo.finish(scheduledAt, claimInput.job, winner!.token, "succeeded")).toBe(true);

      const beforeBegin = await repo.claim({
        ...claimInput,
        scheduledAt: secondAt,
        leaseExpiresAt: new Date(start.getTime() - 1000).toISOString(),
      });
      const recovered = await repo.claim({
        ...claimInput,
        scheduledAt: secondAt,
        runId: "recovered",
      });
      expect(recovered?.token).not.toBe(beforeBegin?.token);
      expect(await repo.begin(secondAt, claimInput.job, beforeBegin!.token)).toBe(false);
      expect(await repo.begin(secondAt, claimInput.job, recovered!.token)).toBe(true);

      const manual = await repo.claim({ ...claimInput, trigger: "manual", runId: "manual" });
      expect(manual).not.toBeNull();
      const rows = await sql<{ trigger_source: string; state: string }[]>`
        select trigger_source, state from maintenance_job_runs
        where scheduled_for = ${scheduledAt} order by trigger_source
      `;
      expect(rows).toMatchObject([
        { trigger_source: "manual", state: "claimed" },
        { trigger_source: "scheduled", state: "succeeded" },
      ]);
    } finally {
      await sql`delete from maintenance_job_runs where scheduled_for in (${scheduledAt}, ${secondAt})`;
    }
  });
});
