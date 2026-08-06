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

  it("exports a scheduled handler for that trigger to invoke", () => {
    expect(serverEntry).toMatch(/async scheduled\(/);
  });

  it("routes the scheduled handler to the real maintenance entrypoint", () => {
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
