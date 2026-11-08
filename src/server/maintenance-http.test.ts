import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { SCHEDULED_MAINTENANCE_CRON } from "@/features/operations/health";

import {
  classifyMaintenanceRequest,
  createMaintenanceHttpHandler,
  schedulerOwner,
} from "./maintenance-http";
import type { MaintenanceTickInput } from "./maintenance-trigger";

const secret = "test-only-cron-secret-sufficient-length";
const cronHeaders = {
  authorization: `Bearer ${secret}`,
  "x-vercel-cron-schedule": SCHEDULED_MAINTENANCE_CRON,
};

describe("single scheduler owner HTTP boundary", () => {
  it("fails closed on missing, invalid or paused owner", () => {
    expect(schedulerOwner({})).toBe("paused");
    expect(schedulerOwner({ MAINTENANCE_SCHEDULER_OWNER: "other" })).toBe("paused");
  });

  it("rejects unauthenticated requests before creating runtime jobs", async () => {
    const run = vi.fn();
    const handler = createMaintenanceHttpHandler({
      env: { MAINTENANCE_SCHEDULER_OWNER: "vercel", CRON_SECRET: secret },
      run,
    });
    expect((await handler(new Request("https://local.test/api/cron/maintenance"))).status).toBe(
      401,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("does not run when Cloudflare owns the slot", async () => {
    const run = vi.fn();
    const handler = createMaintenanceHttpHandler({
      env: { MAINTENANCE_SCHEDULER_OWNER: "cloudflare", CRON_SECRET: secret },
      run,
    });
    expect(
      (
        await handler(
          new Request("https://local.test/api/cron/maintenance", {
            headers: { authorization: `Bearer ${secret}` },
          }),
        )
      ).status,
    ).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses a five-minute slot and server correlation id, never caller timestamps", async () => {
    const run = vi.fn(async (_input: MaintenanceTickInput) => ({
      outcome: "succeeded",
      runId: "server-generated",
    }));
    const handler = createMaintenanceHttpHandler({
      env: { MAINTENANCE_SCHEDULER_OWNER: "vercel", CRON_SECRET: secret },
      run,
      clock: () => new Date("2026-10-01T05:02:00Z"),
    });
    const response = await handler(
      new Request("https://local.test/api/cron/maintenance?trigger=manual&scheduledAt=2099-01-01", {
        headers: { authorization: `Bearer ${secret}`, "user-agent": "vercel-cron/1.0" },
      }),
    );
    expect(response.status).toBe(200);
    expect(run.mock.calls[0][0]).toMatchObject({
      trigger: "scheduled",
      scheduledAt: "2026-10-01T05:00:00.000Z",
      triggerEvidence: "http-candidate",
    });
    expect(run.mock.calls[0][0].allowedJobs).toContain("runBulkAssignments");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("treats the Vercel cron schedule header plus the bearer secret as verified", async () => {
    const run = vi.fn(async (_input: MaintenanceTickInput) => ({}));
    const handler = createMaintenanceHttpHandler({
      env: { MAINTENANCE_SCHEDULER_OWNER: "vercel", CRON_SECRET: secret },
      run,
    });
    const response = await handler(
      new Request("https://local.test/api/cron/maintenance", { headers: cronHeaders }),
    );

    expect(response.status).toBe(200);
    expect(run.mock.calls[0][0]).toMatchObject({
      trigger: "scheduled",
      triggerEvidence: "platform-header",
    });
    expect(await response.json()).toMatchObject({ providerTriggerVerified: true });
  });

  it("does not verify a mismatched schedule header", () => {
    const classification = classifyMaintenanceRequest(
      new Request("https://local.test/api/cron/maintenance", {
        headers: { "x-vercel-cron-schedule": "0 3 * * *" },
      }),
    );

    expect(classification).toEqual({
      trigger: "manual",
      evidence: "manual",
      verified: false,
    });
  });

  it("records a valid manual GET as manual even if query parameters claim scheduled", async () => {
    const run = vi.fn(async (_input: MaintenanceTickInput) => ({}));
    const handler = createMaintenanceHttpHandler({
      env: { MAINTENANCE_SCHEDULER_OWNER: "vercel", CRON_SECRET: secret },
      run,
    });
    const response = await handler(
      new Request("https://local.test/api/cron/maintenance?trigger=scheduled", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(run.mock.calls[0][0].trigger).toBe("manual");
    expect(await response.json()).toMatchObject({ providerTriggerVerified: false });
  });

  it("does not authorise a cron user agent without the bearer secret", async () => {
    const run = vi.fn();
    const handler = createMaintenanceHttpHandler({
      env: { MAINTENANCE_SCHEDULER_OWNER: "vercel", CRON_SECRET: secret },
      run,
    });
    expect(
      (
        await handler(
          new Request("https://local.test/api/cron/maintenance", {
            headers: { "user-agent": "vercel-cron/1.0" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the declared schedule in one place", () => {
    const schedule = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
    expect(schedule).toContain(`"/api/cron/maintenance"`);
    expect(schedule).toContain(`"${SCHEDULED_MAINTENANCE_CRON}"`);
  });
});
