import { describe, expect, it, vi } from "vitest";
import { runScheduledMaintenance } from "./cron";

describe("scheduled maintenance", () => {
  it("evaluates escalations and reminders, dispatches a bounded batch, and cleans expired uploads", async () => {
    const calls: string[] = [];
    const result = await runScheduledMaintenance(
      "2026-07-12T00:00:00.000Z",
      {
        evaluateEscalations: vi.fn(async () => {
          calls.push("escalations");
          return { warnings: 1, breaches: 2 };
        }),
        evaluateAnnualReturnReminders: vi.fn(async () => {
          calls.push("annual-return-reminders");
          return { sent: 1, skipped: 0 };
        }),
        dispatchDue: vi.fn(async (_now, limit) => {
          calls.push(`dispatch:${limit}`);
          return { claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 };
        }),
        cleanupExpiredUploads: vi.fn(async () => {
          calls.push("uploads");
          return { expired: 3 };
        }),
        failStrandedNotifications: vi.fn(async () => {
          calls.push("stranded");
          return { failed: 2 };
        }),
        redactNotifications: vi.fn(async () => {
          calls.push("redact");
          return { redacted: 4 };
        }),
      },
      { dispatchLimit: 7 },
    );
    expect(result).toMatchObject({
      escalations: { warnings: 1, breaches: 2 },
      annualReturnReminders: { sent: 1, skipped: 0 },
      dispatch: { sent: 1 },
      uploads: { expired: 3 },
      notifications: { strandedFailed: 2, redacted: 4 },
    });
    expect(calls).toEqual([
      "escalations",
      "annual-return-reminders",
      "stranded",
      "dispatch:7",
      "uploads",
      "redact",
    ]);
  });
});
