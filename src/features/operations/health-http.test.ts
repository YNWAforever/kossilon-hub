import { describe, expect, it } from "vitest";

import { createHealthHttpHandler, schedulerCandidateFreshness } from "./health-http";
import type { MaintenanceRunRecord } from "./health";

const NOW = "2026-11-09T03:00:00.000Z";

function run(overrides: Partial<MaintenanceRunRecord> = {}): MaintenanceRunRecord {
  return {
    id: "run-1",
    scheduledFor: "2026-11-09T02:58:00.000Z",
    startedAt: "2026-11-09T02:58:01.000Z",
    finishedAt: "2026-11-09T02:58:04.000Z",
    durationMs: 3000,
    outcome: "succeeded",
    failedPasses: [],
    dispatch: null,
    triggerSource: "scheduled",
    ...overrides,
  };
}

function handler(
  options: {
    runs?: MaintenanceRunRecord[];
    candidateRuns?: MaintenanceRunRecord[];
    lastScheduledSuccessAt?: string | null;
  } = {},
) {
  const runs = options.runs ?? [run({ platformTriggerVerified: true })];
  return createHealthHttpHandler({
    now: () => new Date(NOW),
    readMaintenance: async () => ({
      runs,
      candidateRuns: options.candidateRuns ?? runs,
      lastScheduledSuccessAt: options.lastScheduledSuccessAt ?? null,
      database: { database: "neondb", branchId: "br-muddy-mountain-aov8bbku" },
    }),
  });
}

describe("/api/health", () => {
  it("returns 200 for a recent clean tick and reports the database identity", async () => {
    const response = await handler()(new Request("https://app.test/api/health"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.maintenance.state).toBe("healthy");
    expect(body.scheduler).toMatchObject({
      running: true,
      failing: false,
      evidence: "platform-verified",
    });
    expect(body.database).toEqual({ database: "neondb", branchId: "br-muddy-mountain-aov8bbku" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("treats a live but unverified HTTP candidate schedule as running, and says so", async () => {
    // This is the production shape: strict platform-verified runs are months
    // old while authenticated cron candidates arrive every five minutes.
    const response = await handler({
      runs: [run({ finishedAt: "2026-09-30T01:55:21.103Z", platformTriggerVerified: true })],
      candidateRuns: [run({ platformTriggerVerified: false })],
    })(new Request("https://app.test/api/health"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.scheduler.running).toBe(true);
    expect(body.scheduler.evidence).toBe("http-candidate");
    expect(body.maintenance.state).toBe("stale");
  });

  it("returns 503 when the scheduler has never run", async () => {
    const response = await handler({ runs: [], candidateRuns: [] })(
      new Request("https://app.test/api/health"),
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.scheduler.running).toBe(false);
    expect(body.maintenance.state).toBe("never-observed");
  });

  it("returns 503 when the newest candidate went stale", async () => {
    const stale = run({ finishedAt: "2026-11-09T02:40:00.000Z" });
    const response = await handler({ runs: [], candidateRuns: [stale] })(
      new Request("https://app.test/api/health"),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).scheduler.running).toBe(false);
  });

  it("returns 503 when the newest candidate failed", async () => {
    const failed = run({ outcome: "failed" });
    const response = await handler({ runs: [failed], candidateRuns: [failed] })(
      new Request("https://app.test/api/health"),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).scheduler).toMatchObject({ running: true, failing: true });
  });

  it("returns 503 without leaking the failure when the read throws", async () => {
    const response = await createHealthHttpHandler({
      now: () => new Date(NOW),
      readMaintenance: async () => {
        throw new Error("postgres://user:secret@host/db is unreachable");
      },
    })(new Request("https://app.test/api/health"));

    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("secret");
  });

  it("only answers GET", async () => {
    const response = await handler()(
      new Request("https://app.test/api/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });
});

describe("schedulerCandidateFreshness", () => {
  it("uses the newest finished run, ignoring trigger and verification for liveness", () => {
    const freshness = schedulerCandidateFreshness({
      runs: [
        run({ id: "older", finishedAt: "2026-11-09T02:50:00.000Z" }),
        run({
          id: "newer",
          finishedAt: "2026-11-09T02:59:00.000Z",
          platformTriggerVerified: false,
        }),
      ],
      nowIso: NOW,
      toleranceSeconds: 600,
    });

    expect(freshness.state).toBe("fresh");
    expect(freshness.lastRunAt).toBe("2026-11-09T02:59:00.000Z");
    expect(freshness.unverified).toBe(true);
  });
});
