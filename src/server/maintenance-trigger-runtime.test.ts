import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MaintenanceJobKind,
  MaintenanceJobStore,
  MaintenanceTickInput,
  PersistedJobState,
} from "./maintenance-trigger";
import type { MaintenanceRunDraft } from "@/features/operations/repository";
import { EXPECTED_MIGRATIONS, type SchemaLedger } from "@/features/operations/schema-health";

const fixture = vi.hoisted(() => ({
  store: undefined as unknown as MaintenanceJobStore,
  drafts: [] as MaintenanceRunDraft[],
  effects: [] as string[],
  loseSummary: false,
  ledger: undefined as unknown as SchemaLedger,
  facts: [] as {
    key: string;
    present: boolean | null;
    expected: string;
    observed: string | null;
  }[],
  readFailure: false,
  jobRepositories: 0,
  readCloses: 0,
}));
vi.mock("@/server/db/client", () => ({
  getSqlClient: () => {
    throw new Error("Real DB client forbidden in runtime unit regression");
  },
  createSqlClient: () => {
    throw new Error("Real DB client forbidden in runtime unit regression");
  },
}));
vi.mock("@/features/operations/maintenance-job-repository", () => ({
  createMaintenanceJobRepository: () => {
    fixture.jobRepositories++;
    return fixture.store;
  },
}));
vi.mock("@/features/operations/repository", () => ({
  createMaintenanceRunRepository: () => ({
    async schemaLedger() {
      if (fixture.readFailure) throw new Error("private database identity must not escape");
      return fixture.ledger;
    },
    async schemaCatalog() {
      if (fixture.readFailure) throw new Error("private database identity must not escape");
      return { ledger: fixture.ledger, facts: fixture.facts, applicationPresent: true };
    },
    async recordRun(draft: MaintenanceRunDraft) {
      if (fixture.loseSummary) {
        fixture.loseSummary = false;
        throw new Error("summary write unavailable");
      }
      fixture.drafts.push(structuredClone(draft));
      return { id: `receipt-${fixture.drafts.length}` };
    },
    async close() {
      fixture.readCloses++;
    },
  }),
}));
vi.mock("@/features/work-items/repository", () => ({
  createWorkItemRepository: () => ({
    async evaluateEscalations() {
      fixture.effects.push("evaluateEscalations");
      return { warnings: 1, breaches: 0 };
    },
    async close() {},
  }),
}));
vi.mock("@/features/notifications/outbox", () => ({
  createNotificationOutboxRepository: () => ({
    async failStranded() {
      fixture.effects.push("settleNotificationAttempts");
      return { failed: 0 };
    },
    async redactExpired() {
      fixture.effects.push("redactNotifications");
      return { redacted: 1 };
    },
    async close() {},
  }),
}));
vi.mock("@/features/documents/repository", () => ({
  createDocumentRepository: () => ({
    async listStalledQuarantine() {
      fixture.effects.push("escalateStalledQuarantine");
      return [];
    },
    async close() {},
  }),
}));
vi.mock("@/features/bulk-operations/repository", () => ({
  createBulkOperationsRepository: () => ({}),
}));
vi.mock("@/features/bulk-operations/worker", () => ({
  async runScheduledBulkAssignments() {
    fixture.effects.push("runBulkAssignments");
    return { jobs: 0, processed: 0 };
  },
}));

import { runRuntimeMaintenanceTick } from "./maintenance-trigger-runtime";
import { createMaintenanceHttpHandler } from "./maintenance-http";
const slot = "2026-10-23T00:00:00.000Z";
const safeJobs: MaintenanceJobKind[] = [
  "evaluateEscalations",
  "settleNotificationAttempts",
  "redactNotifications",
  "escalateStalledQuarantine",
  "runBulkAssignments",
];
function input(runId: string): MaintenanceTickInput {
  return {
    trigger: "scheduled",
    triggerEvidence: "native-hook",
    scheduledAt: slot,
    runId,
    allowedJobs: [...safeJobs],
  };
}
beforeEach(() => {
  fixture.drafts = [];
  fixture.effects = [];
  fixture.loseSummary = false;
  fixture.ledger = { present: true, applied: [...EXPECTED_MIGRATIONS] };
  fixture.facts = [
    {
      key: "notification_outbox.dispatch_started_attempt",
      present: true,
      expected: "integer",
      observed: "integer",
    },
    {
      key: "notification_outbox_dispatch_marker_idx",
      present: true,
      expected: "index",
      observed: "index",
    },
  ];
  fixture.readFailure = false;
  fixture.jobRepositories = 0;
  fixture.readCloses = 0;
  const states = new Map<string, PersistedJobState>();
  fixture.store = {
    async claim(data) {
      const key = `${data.scheduledAt}:${data.job}`;
      if (states.has(key)) return null;
      states.set(key, "claimed");
      return { token: key };
    },
    async stateOf(at, job) {
      return states.get(`${at}:${job}`) ?? null;
    },
    async begin(at, job) {
      states.set(`${at}:${job}`, "started");
      return true;
    },
    async finish(at, job, _token, outcome) {
      states.set(`${at}:${job}`, outcome);
      return true;
    },
    async close() {},
  };
});

describe("UC189 scheduler refuses incompatible schema before any durable write", () => {
  const marker = "0034_notification_outbox_dispatch_marker.sql";
  const unknown = "9999_uc189_unknown_d69e7b0e.sql";
  it.each([
    ["no-ledger", { present: false, applied: [] }],
    ["empty", { present: true, applied: [] }],
    ["missing", { present: true, applied: EXPECTED_MIGRATIONS.filter((id) => id !== marker) }],
    ["unknown", { present: true, applied: [...EXPECTED_MIGRATIONS, unknown] }],
    [
      "same-count-diverged",
      { present: true, applied: [...EXPECTED_MIGRATIONS.filter((id) => id !== marker), unknown] },
    ],
  ] satisfies [string, SchemaLedger][])(
    "blocks %s and repeated attempts without a success receipt",
    async (_name, ledger) => {
      fixture.ledger = ledger;
      for (const runId of ["refused", "retry"]) {
        await expect(runRuntimeMaintenanceTick(input(runId))).rejects.toThrow(/schema/i);
      }
      expect(fixture.jobRepositories).toBe(0);
      expect(fixture.effects).toEqual([]);
      expect(fixture.drafts).toEqual([]);
      expect(fixture.readCloses).toBe(2);
    },
  );

  it.each([false, null])(
    "blocks a %s physical contract even with all ledger IDs",
    async (present) => {
      fixture.facts[0].present = present;
      await expect(runRuntimeMaintenanceTick(input("physical"))).rejects.toThrow(/schema/i);
      expect(fixture.jobRepositories).toBe(0);
      expect(fixture.effects).toEqual([]);
      expect(fixture.drafts).toEqual([]);
    },
  );

  it("does not treat an empty catalog as verified", async () => {
    fixture.facts = [];
    await expect(runRuntimeMaintenanceTick(input("empty-catalog"))).rejects.toThrow(/schema/i);
    expect(fixture.jobRepositories).toBe(0);
    expect(fixture.drafts).toEqual([]);
  });

  it("sanitizes failed schema reads and closes the reader without writing failure ticks", async () => {
    fixture.readFailure = true;
    const error: unknown = await runRuntimeMaintenanceTick(input("unavailable")).catch(
      (error) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/schema/i);
    expect(String(error)).not.toContain("private database identity");
    expect(fixture.jobRepositories).toBe(0);
    expect(fixture.drafts).toEqual([]);
    expect(fixture.readCloses).toBe(1);
  });

  it("recovers on a fresh read after refusal and keeps the scheduled-slot replay guard", async () => {
    fixture.ledger = { present: true, applied: [] };
    await expect(runRuntimeMaintenanceTick(input("before-repair"))).rejects.toThrow(/schema/i);
    fixture.ledger = { present: true, applied: [...EXPECTED_MIGRATIONS] };
    const first = await runRuntimeMaintenanceTick(input("after-repair"));
    const replay = await runRuntimeMaintenanceTick(input("after-repair-retry"));
    expect(first.counts.completed).toBe(5);
    expect(replay.outcome).toBe("skipped");
    expect(fixture.effects).toEqual(safeJobs);
    expect(fixture.drafts).toHaveLength(2);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("safe runtime invocation evidence (in-memory repositories only)", () => {
  it("persists a non-success replay heartbeat without inventing failed jobs or successful execution", async () => {
    fixture.loseSummary = true;
    await expect(runRuntimeMaintenanceTick(input("original"))).rejects.toThrow(
      "summary write unavailable",
    );
    const replay = await runRuntimeMaintenanceTick(input("replay"));
    expect(fixture.effects).toEqual(safeJobs);
    expect(replay.outcome).toBe("skipped");
    expect(fixture.drafts).toHaveLength(1);
    const draft = fixture.drafts[0];
    expect(draft.outcome).toBe("failed");
    expect(draft.failedPasses).toEqual([]);
    expect(draft.failureSummary).toMatch(/skipped/i);
    expect(draft.passes).toMatchObject({
      outcome: "skipped",
      runId: "replay",
      executionScope: "safe-maintenance-only",
      counts: { completed: 0, failed: 0, skipped: 5 },
    });
  });

  it("labels an authenticated HTTP cron candidate unverified and performs only the five safe jobs", async () => {
    const handler = createMaintenanceHttpHandler({
      env: {
        MAINTENANCE_SCHEDULER_OWNER: "vercel",
        CRON_SECRET: "unit-only-candidate-secret-length",
      },
      run: runRuntimeMaintenanceTick,
      clock: () => new Date(slot),
    });
    const response = await handler(
      new Request("https://local.invalid/api/cron/maintenance", {
        headers: {
          authorization: "Bearer unit-only-candidate-secret-length",
          "user-agent": "vercel-cron/1.0",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      executionScope: "safe-maintenance-only",
      providerTriggerVerified: false,
    });
    expect(fixture.effects).toEqual(safeJobs);
    expect(fixture.drafts[0].passes).toMatchObject({
      executionScope: "safe-maintenance-only",
      triggerEvidence: "http-candidate",
      platformTriggerVerified: false,
      runId: expect.any(String),
    });
    expect(fixture.effects).not.toContain("dispatchDue");
    expect(fixture.effects).not.toContain("documentScans");
    expect(fixture.effects).not.toContain("documentAnalysis");
  });

  it.each([undefined, "http-candidate", "manual"] as const)(
    "does not mark %s input as a verified platform trigger",
    async (triggerEvidence) => {
      await runRuntimeMaintenanceTick({ ...input("unverified"), triggerEvidence });
      expect(fixture.drafts[0].passes).toMatchObject({ platformTriggerVerified: false });
    },
  );

  it("retains unknown finish acknowledgement and refuses to re-execute its durable started jobs", async () => {
    fixture.store.finish = async () => {
      throw new Error("private finish uncertainty");
    };
    const first = await runRuntimeMaintenanceTick(input("unknown-finish"));
    expect(first.counts.unknown).toBe(5);
    const replay = await runRuntimeMaintenanceTick(input("unknown-replay"));
    expect(fixture.effects).toEqual(safeJobs);
    expect(replay).toMatchObject({
      outcome: "skipped",
      counts: { completed: 0, unknown: 5, skipped: 5 },
    });
    expect(JSON.stringify(fixture.drafts)).not.toContain("private finish uncertainty");
  });

  it("rejects out-of-scope provider work before constructing job or receipt repositories", async () => {
    await expect(
      runRuntimeMaintenanceTick({
        ...input("unapproved"),
        allowedJobs: ["dispatchDue" as MaintenanceJobKind],
      }),
    ).rejects.toThrow("Unapproved scheduled job");
    expect(fixture.effects).toEqual([]);
    expect(fixture.drafts).toEqual([]);
  });

  it.each(["paused", "cloudflare", "invalid-owner"])(
    "does not execute the HTTP candidate when scheduler owner is %s",
    async (owner) => {
      const handler = createMaintenanceHttpHandler({
        env: {
          MAINTENANCE_SCHEDULER_OWNER: owner,
          CRON_SECRET: "unit-only-candidate-secret-length",
        },
        run: runRuntimeMaintenanceTick,
      });
      const response = await handler(
        new Request("https://local.invalid/api/cron/maintenance", {
          headers: {
            authorization: "Bearer unit-only-candidate-secret-length",
            "user-agent": "vercel-cron/1.0",
          },
        }),
      );
      expect(response.status).toBe(503);
      expect(fixture.effects).toEqual([]);
      expect(fixture.drafts).toEqual([]);
    },
  );

  it("cannot promote a manual trigger to native evidence by supplying native-hook text", async () => {
    await runRuntimeMaintenanceTick({ ...input("manual-native-label"), trigger: "manual" });
    expect(fixture.drafts[0].triggerSource).toBe("manual");
    expect(fixture.drafts[0].passes).toMatchObject({
      platformTriggerVerified: false,
      executionScope: "safe-maintenance-only",
    });
  });
});
