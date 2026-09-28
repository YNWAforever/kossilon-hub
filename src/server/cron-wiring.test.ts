import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it, vi } from "vitest";

const serverEntry = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const wranglerTemplate = parse(
  readFileSync(new URL("../../wrangler.template.jsonc", import.meta.url), "utf8"),
) as { triggers?: { crons?: string[] } };

/**
 * `runScheduledMaintenance` was pure, tested, and completely unreachable: the
 * template declared a 5-minute cron while the Worker exported only `fetch`, so
 * nothing ever invoked it. Testing the pure function proved nothing about
 * whether it runs. These tests check the wiring instead.
 */
describe("T19 media scheduler gate", () => {
  it("schedules inbound download only after the scoped token, host and tenant ID mapping proof", async () => {
    const { scheduledJobsForRuntime } = await import("./maintenance-trigger-runtime");
    const valid = {
      WOZTELL_OPEN_API_TOKEN: "scoped-test-token",
      WOZTELL_MEDIA_ALLOWED_HOSTS: "media.example.test",
      WOZTELL_MEDIA_FILE_ID_MAPPING_VERIFIED: "true",
    };
    expect(scheduledJobsForRuntime({})).not.toContain("drainInboundMediaDownloads");
    expect(
      scheduledJobsForRuntime({ ...valid, WOZTELL_MEDIA_FILE_ID_MAPPING_VERIFIED: "false" }),
    ).not.toContain("drainInboundMediaDownloads");
    expect(
      scheduledJobsForRuntime({ ...valid, WOZTELL_MEDIA_ALLOWED_HOSTS: "localhost" }),
    ).not.toContain("drainInboundMediaDownloads");
    expect(scheduledJobsForRuntime(valid)).toContain("drainInboundMediaDownloads");
  });
});

describe("scheduled maintenance wiring", () => {
  it("declares one Vercel HTTP cron with a server-secret gate", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
    ) as { crons?: { path: string; schedule: string }[] };
    expect(config.crons).toEqual([{ path: "/api/cron/maintenance", schedule: "*/5 * * * *" }]);
    expect(serverEntry).toContain('pathname === "/api/cron/maintenance"');
    expect(serverEntry).toContain("authorizeMaintenanceRequest(request, process.env.CRON_SECRET)");
  });

  it("declares a cron trigger", () => {
    expect(wranglerTemplate.triggers?.crons ?? []).not.toHaveLength(0);
  });

  /**
   * src/server.ts is the TanStack Start server entry, NOT the Worker entry. Nitro
   * generates the Worker, and its `scheduled` does nothing but fire the
   * `cloudflare:scheduled` hook — so a `scheduled` export here is never invoked.
   * An earlier version of this work added one and it was dead on arrival.
   */
  it("registers the cloudflare:scheduled hook from a nitro plugin", () => {
    const plugin = readFileSync(new URL("./nitro-scheduled.ts", import.meta.url), "utf8");

    expect(plugin).toContain("definePlugin");
    expect(plugin).toContain('hooks.hook("cloudflare:scheduled"');
    expect(plugin).toContain("runScheduledMaintenanceForWorker");
  });

  // The plugin only runs if nitro is told about it.
  it("registers that plugin with nitro", () => {
    const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

    expect(viteConfig).toContain("./src/server/nitro-scheduled.ts");
  });

  it("does not rely on a scheduled export nitro would never call", () => {
    expect(serverEntry).not.toMatch(/async scheduled\(/);
  });

  it("routes the hook to the real maintenance entrypoint", () => {
    expect(serverEntry).toContain("runScheduledMaintenanceForWorker");
    expect(serverEntry).toContain('import("./server/maintenance-trigger-runtime")');
    expect(serverEntry).toContain("runMaintenanceTickOnServer(");
    expect(readFileSync(new URL("./nitro-scheduled.ts", import.meta.url), "utf8")).toContain(
      'MAINTENANCE_SCHEDULER_OWNER !== "cloudflare"',
    );
  });
});

describe("runScheduledMaintenanceForWorker", () => {
  // Injected, never executed for real. runFirmMaintenance dispatches
  // notifications, deletes R2 objects and rewrites outbox rows against whatever
  // DATABASE_URL is in scope; an earlier version of this test called it and
  // relied on the connection failing to keep that harmless.
  it("converts the scheduled time into the maintenance clock", async () => {
    const { runScheduledMaintenanceForWorker } = await import("../server.ts");
    const run = vi.fn(async () => ({ ok: true }));

    await runScheduledMaintenanceForWorker(Date.parse("2026-08-05T02:35:00.000Z"), run);

    expect(run).toHaveBeenCalledWith({
      now: "2026-08-05T02:35:00.000Z",
      // Only the cron hook may claim this. `maintenanceHealthOf` counts
      // scheduled runs alone when deciding whether the schedule is alive, so a
      // manual invocation cannot silence a dead cron -- and a row written from
      // here is the first real evidence the deployed runtime fires at all.
      triggerSource: "scheduled",
    });
  });

  it("rethrows so a failed run is visible to the platform", async () => {
    const { runScheduledMaintenanceForWorker } = await import("../server.ts");
    const run = vi.fn(async () => {
      throw new Error("escalation pass failed");
    });

    await expect(runScheduledMaintenanceForWorker(Date.now(), run)).rejects.toThrow(
      "escalation pass failed",
    );
  });

  it("reports partial scheduled jobs as a platform failure", async () => {
    const { runScheduledMaintenanceForWorker } = await import("../server.ts");
    const run = vi.fn(async () => ({
      outcome: "partial",
      jobs: [{ job: "evaluateEscalations", state: "failed" }],
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(runScheduledMaintenanceForWorker(Date.now(), run)).rejects.toThrow(
        "Scheduled maintenance completed with failed or unknown jobs.",
      );
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("defaults to the real maintenance entrypoint", async () => {
    const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

    expect(source).toContain('import("./server/maintenance-trigger-runtime")');
    expect(source).toContain("runMaintenanceTickOnServer({");
  });

  /**
   * `createMaintenanceRunRecorder` is optional on FirmMaintenanceDependencies so
   * the existing tests of runFirmMaintenanceWithDependencies need no stub
   * database. That optionality must never reach production: a deployment that
   * inherited the default would go on leaving no trace of the tick, which is the
   * exact fault Phase F exists to fix, and nothing else in a build would notice.
   *
   * Asserted by source text rather than by calling it, for the same reason the
   * test above injects a runner: runFirmMaintenance opens five Postgres
   * connections against whatever DATABASE_URL is in scope.
   */
  it("gives the production wiring somewhere to record the run", () => {
    const source = readFileSync(new URL("./maintenance.ts", import.meta.url), "utf8");
    const productionWiring = source.slice(
      source.indexOf("export async function runFirmMaintenance("),
    );

    expect(productionWiring).toContain("createMaintenanceRunRecorder:");
    expect(productionWiring).toContain("createMaintenanceRunRepository()");
  });
});
