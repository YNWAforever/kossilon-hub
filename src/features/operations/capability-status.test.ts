import { describe, expect, it, vi } from "vitest";
import { buildOperationsHealth, buildSafeOperationsHealth } from "./server-fns";
import { deriveCapabilityStatuses, presentCapabilityBindingNames } from "./capability-status";
import { deploymentRefFromRuntime, schedulerOwnerFromRuntime } from "./deployment-identity";
import { EXPECTED_MIGRATIONS } from "./schema-health";
import type { MaintenanceRunRecord } from "./health";

const NOW = "2026-09-27T02:00:00.000Z";
const emptyDepth = () => ({
  pending: 0,
  processing: 0,
  retrying: 0,
  failed: 0,
  dueNow: 0,
  oldestPendingAt: null,
});
function repository(runs: MaintenanceRunRecord[] = []) {
  return {
    schemaLedger: vi.fn(async () => ({ present: true, applied: [...EXPECTED_MIGRATIONS] })),
    listRecentRuns: vi.fn(async () => runs),
    listRecentScheduledRuns: vi.fn(async () =>
      runs.filter((run) => run.triggerSource === "scheduled"),
    ),
    lastScheduledSuccessAt: vi.fn(
      async () => runs.find((run) => run.outcome === "succeeded")?.finishedAt ?? null,
    ),
    queueDepths: vi.fn(async () => ({
      documentScans: emptyDepth(),
      documentAnalysis: emptyDepth(),
      notifications: emptyDepth(),
      handoffsAwaitingTransmission: 0,
    })),
    textLayerObserved: vi.fn(async () => false),
  };
}
function capability(view: Awaited<ReturnType<typeof buildOperationsHealth>>, id: string) {
  return view.capabilities.find((item) => item.id === id);
}

describe("T08 dynamic capability status", () => {
  it("t08_scenario_1 keeps configured without success unverified and old success with recent failure degraded", async () => {
    const configured = await buildOperationsHealth(
      { now: NOW, bindingNames: ["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_API_KEY"] },
      { repository: repository() },
    );
    expect(capability(configured, "malware-scanner-provider")).toMatchObject({
      implemented: true,
      configured: true,
      reachable: "unknown",
      state: "unverified",
      lastSuccessAt: null,
      evidenceRef: null,
    });
    const failed: MaintenanceRunRecord = {
      id: "scheduled-failure",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 1,
      outcome: "partial",
      failedPasses: ["evaluateEscalations"],
      dispatch: null,
      triggerSource: "scheduled",
      deploymentRef: "abcdef1234567",
    };
    const priorSuccess: MaintenanceRunRecord = {
      ...failed,
      id: "scheduled-prior-success",
      scheduledFor: "2026-09-27T01:55:00.000Z",
      startedAt: "2026-09-27T01:55:00.000Z",
      finishedAt: "2026-09-27T01:55:00.000Z",
      outcome: "succeeded",
      failedPasses: [],
    };
    const degradedRepo = repository([failed, priorSuccess]);
    degradedRepo.lastScheduledSuccessAt.mockResolvedValue(priorSuccess.finishedAt);
    const degraded = await buildOperationsHealth(
      {
        now: NOW,
        bindingNames: ["MAINTENANCE_SCHEDULER_OWNER", "CRON_SECRET"],
        schedulerOwner: "vercel",
        deploymentRef: "abcdef1234567",
      },
      { repository: degradedRepo },
    );
    expect(capability(degraded, "deployment-runtime")).toMatchObject({
      state: "degraded",
      lastSuccessAt: "2026-09-27T01:55:00.000Z",
      evidenceRef: "maintenance_runs:scheduled-failure",
    });
  });

  it("t08_scenario_2 reports the implemented AI adapter and keeps unrelated reads available without scanner", async () => {
    const view = await buildOperationsHealth(
      { now: NOW, bindingNames: [] },
      { repository: repository() },
    );
    expect(view.schema.state).toBe("current");
    expect(view.queues?.documentScans.pending).toBe(0);
    expect(capability(view, "ai-provider")).toMatchObject({ implemented: true, configured: false });
    expect(capability(view, "malware-scanner-provider")?.state).toBe("unconfigured");
  });

  it("requires a fresh same-deployment probe before marking a configured provider healthy", () => {
    const bindings = presentCapabilityBindingNames({
      DOCUMENT_SCANNER_URL: "https://scanner.example.test/signed?token=private",
      DOCUMENT_SCANNER_API_KEY: "secret-api-key",
    });
    expect(bindings).toEqual(["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_API_KEY"]);
    expect(JSON.stringify(bindings)).not.toContain("secret-api-key");
    const probe = {
      reachable: "yes" as const,
      lastSuccessAt: "2026-09-27T01:59:00.000Z",
      evidenceRef: "probe:scanner-1",
      deploymentRef: "sha-old",
      checkedAt: NOW,
    };
    const base = { now: NOW, bindingNames: bindings, maintenance: null, recentRuns: null };
    const status = (deploymentRef: string, checkedAt = NOW) =>
      deriveCapabilityStatuses({
        ...base,
        deploymentRef,
        probes: { "malware-scanner-provider": { ...probe, checkedAt } },
      }).find((item) => item.id === "malware-scanner-provider");
    expect(status("sha-new")?.state).toBe("unverified");
    expect(status("sha-old")?.state).toBe("healthy");
    expect(status("sha-old", "2026-09-27T01:30:00.000Z")?.state).toBe("unverified");
  });

  it("does not mark a fresh probe healthy using stale or future provider success", () => {
    const base = {
      now: NOW,
      bindingNames: ["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_API_KEY"],
      maintenance: null,
      recentRuns: null,
      deploymentRef: "abcdef1234567",
    };
    const status = (lastSuccessAt: string, reachable: "yes" | "no" = "yes") =>
      deriveCapabilityStatuses({
        ...base,
        probes: {
          "malware-scanner-provider": {
            reachable,
            lastSuccessAt,
            evidenceRef: "probe:scanner-1",
            deploymentRef: "abcdef1234567",
            checkedAt: NOW,
          },
        },
      }).find((item) => item.id === "malware-scanner-provider");
    expect(status("2026-09-27T01:30:00.000Z")?.state).toBe("unverified");
    expect(status("2026-09-27T02:01:00.000Z")).toMatchObject({
      state: "unverified",
      lastSuccessAt: null,
    });
    expect(status("2026-09-27T01:30:00.000Z", "no")?.state).toBe("degraded");
    expect(status("2026-09-27T02:01:00.000Z", "no")?.state).toBe("blocked");
  });

  it("only trusts scheduler success from the active deployment and a valid owner", async () => {
    const run: MaintenanceRunRecord = {
      id: "scheduled-success",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 1,
      outcome: "succeeded",
      failedPasses: [],
      dispatch: null,
      triggerSource: "scheduled",
      deploymentRef: "abcdef1234567",
    };
    const base = {
      now: NOW,
      bindingNames: ["MAINTENANCE_SCHEDULER_OWNER", "CRON_SECRET"],
      schedulerOwner: "vercel" as const,
    };
    const foreign = await buildOperationsHealth(
      { ...base, deploymentRef: "deadbeef1234567" },
      { repository: repository([run]) },
    );
    expect(capability(foreign, "deployment-runtime")?.state).toBe("unverified");
    const current = await buildOperationsHealth(
      { ...base, deploymentRef: "abcdef1234567" },
      { repository: repository([run]) },
    );
    expect(capability(current, "deployment-runtime")).toMatchObject({
      state: "healthy",
      evidenceRef: "maintenance_runs:scheduled-success",
    });
    const ownerMissing = await buildOperationsHealth(
      { ...base, schedulerOwner: null, deploymentRef: "abcdef1234567" },
      { repository: repository([run]) },
    );
    expect(capability(ownerMissing, "deployment-runtime")).toMatchObject({
      state: "unconfigured",
      reachable: "unknown",
      lastSuccessAt: null,
      evidenceRef: null,
    });
    expect(deploymentRefFromRuntime({ DEPLOYMENT_SHA: "private-token.example" })).toBeNull();
    expect(deploymentRefFromRuntime({ VERCEL_GIT_COMMIT_SHA: "ABCDEF1234567" })).toBe(
      "abcdef1234567",
    );
    expect(schedulerOwnerFromRuntime({ MAINTENANCE_SCHEDULER_OWNER: "both" })).toBeNull();
  });

  it("uses scheduled history when manual runs fill the general recent-run window", async () => {
    const scheduled: MaintenanceRunRecord = {
      id: "scheduled-current",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 1,
      outcome: "succeeded",
      failedPasses: [],
      dispatch: null,
      triggerSource: "scheduled",
      deploymentRef: "abcdef1234567",
    };
    const repo = repository([scheduled]);
    repo.listRecentRuns.mockResolvedValue([
      { ...scheduled, id: "manual-only", triggerSource: "manual" },
    ]);
    const view = await buildOperationsHealth(
      {
        now: NOW,
        bindingNames: ["MAINTENANCE_SCHEDULER_OWNER", "CRON_SECRET"],
        schedulerOwner: "vercel",
        deploymentRef: "abcdef1234567",
      },
      { repository: repo },
    );
    expect(view.maintenance?.state).toBe("healthy");
    expect(capability(view, "deployment-runtime")).toMatchObject({
      state: "healthy",
      evidenceRef: "maintenance_runs:scheduled-current",
    });
  });

  it("does not attribute a foreign deployment scheduler failure to the active deployment", () => {
    const foreign: MaintenanceRunRecord = {
      id: "scheduled-foreign-failure",
      scheduledFor: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 1,
      outcome: "partial",
      failedPasses: ["evaluateEscalations"],
      dispatch: null,
      triggerSource: "scheduled",
      deploymentRef: "deadbeef1234567",
    };
    const status = deriveCapabilityStatuses({
      now: NOW,
      bindingNames: ["MAINTENANCE_SCHEDULER_OWNER", "CRON_SECRET"],
      schedulerOwner: "vercel",
      deploymentRef: "abcdef1234567",
      maintenance: {
        state: "degraded",
        lastRunAt: NOW,
        lastSuccessAt: "2026-09-27T01:55:00.000Z",
        lagSeconds: 0,
        toleranceSeconds: 900,
        failedPasses: ["evaluateEscalations"],
        summary: "foreign deployment failure",
      },
      recentRuns: [foreign],
    }).find((item) => item.id === "deployment-runtime");
    expect(status).toMatchObject({
      state: "unverified",
      reachable: "unknown",
      lastSuccessAt: null,
      evidenceRef: null,
    });
  });

  it("t08_scenario_3 never exposes provider tokens, signed URLs, or DB hosts in response or logs", async () => {
    const secret = "api-token-A1_signed-url-db-host-private.example";
    const repo = repository();
    repo.schemaLedger.mockResolvedValue({ present: false, applied: [] });
    repo.queueDepths.mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const view = await buildOperationsHealth(
        { now: NOW, bindingNames: ["DOCUMENT_AI_URL", "DOCUMENT_AI_API_KEY"] },
        { repository: repo },
      );
      expect(view.queues).toBeNull();
      expect(JSON.stringify(view)).not.toContain(secret);
      const logged = log.mock.calls
        .flat()
        .map((value) => {
          if (value && typeof value === "object" && "error" in value) return String(value.error);
          return String(value);
        })
        .join(" ");
      expect(logged).not.toContain(secret);
      const currentRepo = repository();
      currentRepo.queueDepths.mockRejectedValue(new Error(secret));
      await expect(
        buildSafeOperationsHealth({ now: NOW }, { repository: currentRepo }),
      ).rejects.toThrow("系統運作狀態暫時無法讀取");
      expect(log.mock.calls.flat().map(String).join(" ")).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });
});
