import { describe, expect, it, vi } from "vitest";
import { runScheduledMaintenance } from "./cron";

describe("scheduled maintenance", () => {
  it("evaluates escalations, dispatches a bounded batch, and cleans expired uploads", async () => {
    const calls: string[] = [];
    const result = await runScheduledMaintenance(
      "2026-07-12T00:00:00.000Z",
      {
        evaluateEscalations: vi.fn(async () => {
          calls.push("escalations");
          return { warnings: 1, breaches: 2 };
        }),
        dispatchDue: vi.fn(async (_now, limit) => {
          calls.push(`dispatch:${limit}`);
          return { claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0 };
        }),
        cleanupExpiredUploads: vi.fn(async () => {
          calls.push("uploads");
          return { expired: 3 };
        }),
      },
      { dispatchLimit: 7 },
    );
    expect(result).toMatchObject({
      escalations: { warnings: 1, breaches: 2 },
      dispatch: { sent: 1 },
      uploads: { expired: 3 },
    });
    expect(calls).toEqual(["escalations", "dispatch:7", "uploads"]);
  });
});
