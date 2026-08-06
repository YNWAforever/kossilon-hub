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
describe("scheduled maintenance wiring", () => {
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
    expect(serverEntry).toContain('import("./server/maintenance")');
    expect(serverEntry).toContain("runFirmMaintenance(");
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

    expect(run).toHaveBeenCalledWith({ now: "2026-08-05T02:35:00.000Z" });
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

  it("defaults to the real maintenance entrypoint", async () => {
    const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

    expect(source).toContain('import("./server/maintenance")');
    expect(source).toContain("runFirmMaintenance(input)");
  });
});
