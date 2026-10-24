import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MaintenanceJobKind,
  MaintenanceJobStore,
  MaintenanceTickInput,
  PersistedJobState,
} from "./maintenance-trigger";
import type { MaintenanceRunDraft } from "@/features/operations/repository";

const fixture = vi.hoisted(() => ({
  store: undefined as unknown as MaintenanceJobStore,
  drafts: [] as MaintenanceRunDraft[],
  effects: [] as string[],
  loseSummary: false,
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
  createMaintenanceJobRepository: () => fixture.store,
}));
vi.mock("@/features/operations/repository", () => ({
  createMaintenanceRunRepository: () => ({
    async recordRun(draft: MaintenanceRunDraft) {
      if (fixture.loseSummary) {
        fixture.loseSummary = false;
        throw new Error("summary write unavailable");
      }
      fixture.drafts.push(structuredClone(draft));
      return { id: `receipt-${fixture.drafts.length}` };
    },
    async close() {},
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
