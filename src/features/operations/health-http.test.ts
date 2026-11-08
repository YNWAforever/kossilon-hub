import { describe, expect, it } from "vitest";

import { createHealthHttpHandler } from "./health-http";
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

function handler(runs: MaintenanceRunRecord[], lastScheduledSuccessAt: string | null = null) {
  return createHealthHttpHandler({
    now: () => new Date(NOW),
    readMaintenance: async () => ({ runs, lastScheduledSuccessAt }),
  });
}

describe("/api/health", () => {
  it("returns 200 for a recent clean scheduled tick", async () => {
    const response = await handler([run()])(new Request("https://app.test/api/health"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.maintenance.state).toBe("healthy");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 when the scheduler has never run", async () => {
    const response = await handler([])(new Request("https://app.test/api/health"));

    expect(response.status).toBe(503);
    expect((await response.json()).maintenance.state).toBe("never-observed");
  });

  it("returns 503 when the scheduler went stale or failed", async () => {
    const stale = await handler([run({ finishedAt: "2026-11-09T02:40:00.000Z" })])(
      new Request("https://app.test/api/health"),
    );
    expect(stale.status).toBe(503);

    const failed = await handler([run({ outcome: "failed" })])(
      new Request("https://app.test/api/health"),
    );
    expect(failed.status).toBe(503);
  });

  it("returns 200 for a degraded but alive schedule", async () => {
    const response = await handler([run({ outcome: "partial", failedPasses: ["dispatch"] })])(
      new Request("https://app.test/api/health"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).maintenance.state).toBe("degraded");
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
    const response = await handler([run()])(
      new Request("https://app.test/api/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
  });
});
