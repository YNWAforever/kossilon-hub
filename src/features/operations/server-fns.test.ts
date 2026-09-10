import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildOperationsHealth } from "./server-fns";
import type { MaintenanceRunRecord } from "./health";
import type { QueueDepths } from "./repository";

const NOW = "2026-09-11T10:00:00.000Z";

function emptyDepth() {
  return { pending: 0, processing: 0, failed: 0, dueNow: 0, oldestPendingAt: null };
}

function queues(overrides: Partial<QueueDepths> = {}): QueueDepths {
  return {
    documentScans: emptyDepth(),
    documentAnalysis: emptyDepth(),
    notifications: emptyDepth(),
    handoffsAwaitingTransmission: 0,
    ...overrides,
  };
}

function repository(runs: MaintenanceRunRecord[], depths: QueueDepths = queues()) {
  return {
    listRecentRuns: vi.fn(async (_limit?: number) => runs),
    queueDepths: vi.fn(async (_now: string) => depths),
  };
}

describe("buildOperationsHealth", () => {
  /**
   * The state this deployment is actually in, carried all the way to the view.
   * A screen assembled from an empty table must not be able to render as
   * reassurance.
   */
  it("reports never-observed when the table is empty", async () => {
    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([]) });

    expect(view.maintenance.state).toBe("never-observed");
    expect(view.recentRuns).toEqual([]);
  });

  it("asks the queues for their depth as of the same clock", async () => {
    const repo = repository([]);
    await buildOperationsHealth({ now: NOW }, { repository: repo });

    expect(repo.queueDepths).toHaveBeenCalledWith(NOW);
  });

  /**
   * The blocked integrations ride along with the health rather than being folded
   * into it. Two passes report `not-configured` on every tick, permanently; a
   * screen that counted those as faults would be red forever and would stop
   * meaning anything on the day something actually broke.
   */
  it("carries the disabled capabilities beside the health, not inside it", async () => {
    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([]) });

    expect(view.blockedIntegrations.length).toBeGreaterThan(0);
    expect(view.maintenance.failedPasses).toEqual([]);
    expect(view.blockedIntegrations.map((entry) => entry.id)).toContain("deployment-runtime");
  });

  it("passes manual runs through to the list while the health ignores them", async () => {
    const manual: MaintenanceRunRecord = {
      id: "manual-1",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 10,
      outcome: "succeeded",
      failedPasses: [],
      triggerSource: "manual",
    };

    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([manual]) });

    expect(view.recentRuns).toHaveLength(1);
    expect(view.maintenance.state).toBe("never-observed");
  });
});

describe("getOperationsHealth", () => {
  /**
   * Asserted by source text rather than by calling it: the handler resolves a
   * database client from whatever DATABASE_URL is in scope.
   */
  it("derives the actor from the request and gates before opening a repository", () => {
    const source = readFileSync(new URL("./server-fns.ts", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("export const getOperationsHealth"));

    expect(handler).toContain("requireStaffActor(getRequest())");
    // Order matters: the gate must run before the connection, not after it.
    expect(handler.indexOf("requireStaffActor(getRequest())")).toBeLessThan(
      handler.indexOf("createMaintenanceRunRepository()"),
    );
    // Never from client input.
    expect(handler).not.toMatch(/data\.(actor|userId|role)/);
    expect(handler).toContain("repository.close()");
  });
});
