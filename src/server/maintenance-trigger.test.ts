import { describe, expect, it, vi } from "vitest";
import {
  authorizeMaintenanceRequest,
  createMaintenanceTrigger,
  type MaintenanceJobStore,
} from "./maintenance-trigger";

const slot = "2026-10-01T05:00:00.000Z";
const jobs = ["evaluateEscalations", "redactNotifications"] as const;
function store() {
  return {
    claim: vi.fn<MaintenanceJobStore["claim"]>(async () => ({ token: "lease" })),
    begin: vi.fn(async () => true),
    finish: vi.fn(async () => true),
    stateOf: vi.fn<MaintenanceJobStore["stateOf"]>(async () => null),
    close: vi.fn(async () => {}),
  } satisfies MaintenanceJobStore;
}
describe("durable scheduler boundary", () => {
  it("rejects session/user-agent credentials and wrong method before any job", () => {
    const secret = "local-test-secret-with-enough-length";
    expect(
      authorizeMaintenanceRequest(
        new Request("https://local.test/api/cron/maintenance", {
          headers: { cookie: "admin=true", "user-agent": "vercel-cron/1.0" },
        }),
        secret,
      ),
    ).toBe(false);
    expect(
      authorizeMaintenanceRequest(
        new Request("https://local.test/api/cron/maintenance", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
        }),
        secret,
      ),
    ).toBe(false);
    expect(
      authorizeMaintenanceRequest(
        new Request("https://local.test/api/cron/maintenance", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        secret,
      ),
    ).toBe(true);
  });
  it("preserves the other pass after a failure, with a correlation id and sanitized results", async () => {
    const repository = store();
    const recordRun = vi.fn(async () => {});
    const runJob = vi.fn(async (job: string) => {
      if (job === jobs[0]) throw new Error("private provider payload");
      return { redacted: 2 };
    });
    const result = await createMaintenanceTrigger({
      store: repository,
      runJob,
      recordRun,
    }).runMaintenanceTick({
      trigger: "scheduled",
      scheduledAt: slot,
      runId: "correlation-1",
      allowedJobs: [...jobs],
    });
    expect(result.outcome).toBe("partial");
    expect(result.jobs.map((job) => job.state)).toEqual(["failed", "succeeded"]);
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(recordRun).toHaveBeenCalledWith(result);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.runId).toBe("correlation-1");
  });
  it("never executes after an uncertain claim acknowledgement", async () => {
    const repository = store();
    repository.claim.mockRejectedValue(new Error("private DB URL"));
    const runJob = vi.fn();
    const result = await createMaintenanceTrigger({ store: repository, runJob }).runMaintenanceTick(
      { trigger: "scheduled", scheduledAt: slot, runId: "correlation-2", allowedJobs: [jobs[0]] },
    );
    expect(result.jobs[0].state).toBe("unknown");
    expect(runJob).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("keeps a completed job unknown if its completion write failed", async () => {
    const repository = store();
    repository.finish.mockRejectedValue(new Error("write failed"));
    const runJob = vi.fn(async () => ({ redacted: 1 }));
    const result = await createMaintenanceTrigger({ store: repository, runJob }).runMaintenanceTick(
      { trigger: "scheduled", scheduledAt: slot, runId: "correlation-3", allowedJobs: [jobs[0]] },
    );
    expect(result.jobs[0].state).toBe("unknown");
    expect(runJob).toHaveBeenCalledOnce();
  });
  it("does not turn manual runs into scheduled evidence", async () => {
    const repository = store();
    const result = await createMaintenanceTrigger({
      store: repository,
      runJob: async () => ({}),
    }).runMaintenanceTick({
      trigger: "manual",
      scheduledAt: slot,
      runId: "operator-1",
      allowedJobs: [jobs[0]],
    });
    expect(result.trigger).toBe("manual");
    expect(repository.claim.mock.calls[0][0].trigger).toBe("manual");
  });
  it("retains an existing unknown result in the summary without replay", async () => {
    const repository = store();
    repository.claim.mockResolvedValueOnce(null);
    repository.stateOf.mockResolvedValueOnce("unknown");
    const runJob = vi.fn(async () => ({}));
    const result = await createMaintenanceTrigger({ store: repository, runJob }).runMaintenanceTick(
      {
        trigger: "scheduled",
        scheduledAt: slot,
        runId: "prior-unknown",
        allowedJobs: [...jobs],
      },
    );
    expect(result.outcome).toBe("partial");
    expect(result.counts.unknown).toBe(1);
    expect(runJob).toHaveBeenCalledOnce();
  });
});
