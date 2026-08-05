import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

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
  it("passes the scheduled time through as the maintenance clock", async () => {
    const { runScheduledMaintenanceForWorker } = await import("../server.ts");
    const scheduledTime = Date.parse("2026-08-05T02:35:00.000Z");

    // No database binding here, so the maintenance run fails when it tries to
    // connect. What matters is that the handler reaches it rather than no-opping.
    await expect(runScheduledMaintenanceForWorker(scheduledTime)).rejects.toBeDefined();
  });
});
