import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildOperationsHealth } from "./server-fns";
import type { MaintenanceRunRecord } from "./health";
import type { QueueDepths } from "./repository";
import { EXPECTED_MIGRATIONS, type SchemaLedger } from "./schema-health";

const NOW = "2026-09-11T10:00:00.000Z";

function emptyDepth() {
  return { pending: 0, processing: 0, retrying: 0, failed: 0, dueNow: 0, oldestPendingAt: null };
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

function repository(
  runs: MaintenanceRunRecord[],
  depths: QueueDepths = queues(),
  lastSuccess: string | null = null,
  // Defaults to a fully migrated database, because that is the assumption every
  // test written before the schema check existed was silently making.
  ledger: SchemaLedger = { present: true, applied: [...EXPECTED_MIGRATIONS] },
) {
  return {
    listRecentRuns: vi.fn(async (_limit?: number) => runs),
    listRecentScheduledRuns: vi.fn(async (_limit?: number) =>
      runs.filter((run) => run.triggerSource === "scheduled"),
    ),
    lastScheduledSuccessAt: vi.fn(async () => lastSuccess),
    queueDepths: vi.fn(async (_now: string) => depths),
    schemaLedger: vi.fn(async () => ledger),
    textLayerObserved: vi.fn(async () => false),
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

    expect(view.maintenance?.state).toBe("never-observed");
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
    expect(view.maintenance?.failedPasses).toEqual([]);
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
      dispatch: null,
      triggerSource: "manual",
    };

    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([manual]) });

    expect(view.recentRuns).toHaveLength(1);
    expect(view.maintenance?.state).toBe("never-observed");
  });

  /**
   * The case the whole schema check exists for.
   *
   * Every other read on this screen queries a table one of the migrations
   * creates, so against a database that is behind they all throw
   * `relation ... does not exist`. Without this, /operations would be the one
   * screen that cannot load precisely when it is the one screen worth loading,
   * and the operator would get a stack trace instead of "you are 11 migrations
   * behind".
   */
  it("still reports when the schema is behind and every other read fails", async () => {
    const repo = repository([]);
    repo.schemaLedger.mockResolvedValue({ present: false, applied: [] });
    const boom = new Error('relation "maintenance_runs" does not exist');
    repo.queueDepths.mockRejectedValue(boom);
    repo.listRecentRuns.mockRejectedValue(boom);
    repo.listRecentScheduledRuns.mockRejectedValue(boom);

    const view = await buildOperationsHealth({ now: NOW }, { repository: repo });

    expect(view.schema.state).toBe("no-ledger");
    // Null, not an empty stand-in. A queue nobody could read is not an idle one.
    expect(view.maintenance).toBeNull();
    expect(view.queues).toBeNull();
    expect(view.recentRuns).toBeNull();
  });

  it("names how far behind it is when the ledger exists but is short", async () => {
    const repo = repository([]);
    repo.schemaLedger.mockResolvedValue({
      present: true,
      applied: EXPECTED_MIGRATIONS.filter((id) => id < "0023"),
    });
    repo.queueDepths.mockRejectedValue(new Error('relation "document_scan_jobs" does not exist'));

    const view = await buildOperationsHealth({ now: NOW }, { repository: repo });

    expect(view.schema.state).toBe("behind");
    expect(view.schema.missing[0]).toBe("0023_document_scan_jobs_and_quarantine_retention.sql");
  });

  /**
   * The other half, and the one that keeps this from becoming a blanket
   * try/catch. A failure on a fully migrated database is a real fault; reporting
   * it as a migration problem would send whoever is on call after the wrong
   * thing entirely.
   */
  it("rethrows a read failure the schema does not account for", async () => {
    const repo = repository([]);
    const boom = new Error("connection terminated unexpectedly");
    repo.queueDepths.mockRejectedValue(boom);

    await expect(buildOperationsHealth({ now: NOW }, { repository: repo })).rejects.toThrow(boom);
  });

  it("flags nothing while no scheduled run has been recorded", async () => {
    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([]) });

    expect(view.staleBlockers).toEqual([]);
  });

  it("flags the blocker once a scheduled run has been recorded", async () => {
    const scheduled: MaintenanceRunRecord = {
      id: "scheduled-1",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 10,
      outcome: "succeeded",
      failedPasses: [],
      triggerSource: "scheduled",
      dispatch: null,
    };

    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([scheduled]) });

    expect(view.staleBlockers).toEqual(["deployment-runtime"]);
  });

  /**
   * An operator invoking the entrypoint by hand must not be able to make the
   * blocker look cleared. `maintenanceHealthOf` filters manual runs for exactly
   * this reason, and this pins that the filtering survives the whole path.
   */
  it("does not flag it for a run somebody triggered by hand", async () => {
    const manual: MaintenanceRunRecord = {
      id: "manual-2",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 10,
      outcome: "succeeded",
      failedPasses: [],
      triggerSource: "manual",
      dispatch: null,
    };

    const view = await buildOperationsHealth({ now: NOW }, { repository: repository([manual]) });

    expect(view.staleBlockers).toEqual([]);
  });

  /**
   * Null maintenance means the reads failed and the state is unknown -- which is
   * not evidence that a schedule ran. Guessing here would be the exact false
   * reassurance this codebase refuses everywhere else.
   */
  it("flags nothing when the maintenance state could not be read at all", async () => {
    const repo = repository([]);
    repo.schemaLedger.mockResolvedValue({ present: false, applied: [] });
    repo.queueDepths.mockRejectedValue(new Error('relation "maintenance_runs" does not exist'));

    const view = await buildOperationsHealth({ now: NOW }, { repository: repo });

    expect(view.maintenance).toBeNull();
    expect(view.staleBlockers).toEqual([]);
  });

  it("flags text extraction once a text-layer row exists", async () => {
    const repo = repository([]);
    repo.textLayerObserved.mockResolvedValue(true);

    const view = await buildOperationsHealth({ now: NOW }, { repository: repo });

    expect(view.staleBlockers).toContain("document-text-extraction");
  });
});

describe("history-scoped facts", () => {
  /**
   * The window answers "is it running now". It cannot answer "when did it last
   * work", and deriving the second from the first meant an hour of partial ticks
   * pushed the last success out of view -- so the screen told an operator the
   * schedule had never once succeeded while the row proving otherwise sat just
   * outside the twelve it looked at.
   */
  it("reports a last success older than the run window rather than claiming none", async () => {
    const partial = (id: string, at: string): MaintenanceRunRecord => ({
      id,
      scheduledFor: at,
      startedAt: at,
      finishedAt: at,
      durationMs: 10,
      outcome: "partial",
      failedPasses: ["dispatchDue"],
      dispatch: null,
      triggerSource: "scheduled",
    });
    const window = Array.from({ length: 12 }, (_, i) =>
      partial(`p${i}`, `2026-09-11T09:${String(59 - i).padStart(2, "0")}:00.000Z`),
    );

    const view = await buildOperationsHealth(
      { now: NOW },
      { repository: repository(window, queues(), "2026-09-11T08:55:00.000Z") },
    );

    expect(view.maintenance?.state).toBe("degraded");
    // The fact the window could not see.
    expect(view.maintenance?.lastSuccessAt).toBe("2026-09-11T08:55:00.000Z");
  });

  /**
   * And the converse still holds: a genuine "no scheduled run has ever
   * succeeded" must stay distinguishable from "the last one is just old".
   */
  it("still reports no success when history really holds none", async () => {
    const view = await buildOperationsHealth(
      { now: NOW },
      { repository: repository([], queues(), null) },
    );

    expect(view.maintenance?.state).toBe("never-observed");
    expect(view.maintenance?.lastSuccessAt).toBeNull();
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
