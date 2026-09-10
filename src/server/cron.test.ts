import { describe, expect, it, vi } from "vitest";
import {
  MaintenancePassesFailedError,
  runScheduledMaintenance,
  type ScheduledMaintenanceDependencies,
  type ScheduledMaintenanceResult,
} from "./cron";

/**
 * A full set of passes that all succeed, each recording that it ran.
 *
 * Shared so a test about one pass failing can replace exactly that pass and
 * still assert that every other one ran -- which is the property the isolation
 * exists to provide, and which cannot be shown with a stub set that omits the
 * passes it is not interested in.
 */
function passingDependencies(calls: string[]): ScheduledMaintenanceDependencies {
  return {
    evaluateEscalations: vi.fn(async () => {
      calls.push("escalations");
      return { warnings: 1, breaches: 2 };
    }),
    evaluateAnnualReturnReminders: vi.fn(async () => {
      calls.push("annual-return-reminders");
      return { sent: 1, skipped: 0 };
    }),
    evaluateServiceSubscriptionReminders: vi.fn(async () => {
      calls.push("service-subscription-reminders");
      return { sent: 1, skipped: 0 };
    }),
    dispatchDue: vi.fn(async (_now: string, limit: number) => {
      calls.push(`dispatch:${limit}`);
      return {
        claimed: 1,
        sent: 1,
        retried: 0,
        permanentlyFailed: 0,
        superseded: 0,
        sentButUnrecorded: 0,
        suppressedFixtureOrigin: 0,
      };
    }),
    drainDocumentScanJobs: vi.fn(async () => {
      calls.push("scans");
      return {
        claimed: 1,
        clean: 1,
        rejected: 0,
        retried: 0,
        failed: 0,
        superseded: 0,
        sentButUnrecorded: 0,
        suppressedFixtureOrigin: 0,
        scanner: "ran" as const,
      };
    }),
    drainDocumentAnalysisJobs: vi.fn(async () => {
      calls.push("analysis");
      return {
        claimed: 1,
        analysed: 1,
        awaitingScan: 0,
        retried: 0,
        failed: 0,
        superseded: 0,
        sentButUnrecorded: 0,
        suppressedFixtureOrigin: 0,
        providerSkipped: 1,
        worker: "ran" as const,
      };
    }),
    escalateStalledQuarantine: vi.fn(async () => {
      calls.push("stalled-quarantine");
      return { stalled: 0 };
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
  };
}

/**
 * Run a set of passes expected to contain a failure, and return the partial
 * result the error carried.
 *
 * The run still throws, so no caller can mistake a broken tick for a clean one,
 * and the result rides along so isolating the passes does not cost the log
 * everything the passes that succeeded found.
 */
async function runExpectingFailure(
  dependencies: ScheduledMaintenanceDependencies,
): Promise<ScheduledMaintenanceResult> {
  try {
    await runScheduledMaintenance("2026-07-12T00:00:00.000Z", dependencies);
  } catch (error) {
    if (error instanceof MaintenancePassesFailedError) return error.result;
    throw error;
  }
  throw new Error("expected the maintenance run to fail");
}

describe("scheduled maintenance", () => {
  it("evaluates escalations and reminders, dispatches a bounded batch, and cleans expired uploads", async () => {
    const calls: string[] = [];
    const result = await runScheduledMaintenance(
      "2026-07-12T00:00:00.000Z",
      passingDependencies(calls),
      { dispatchLimit: 7 },
    );
    expect(result).toMatchObject({
      escalations: { warnings: 1, breaches: 2 },
      annualReturnReminders: { sent: 1, skipped: 0 },
      serviceSubscriptionReminders: { sent: 1, skipped: 0 },
      dispatch: { sent: 1 },
      uploads: { expired: 3 },
      notifications: { strandedFailed: 2, redacted: 4 },
    });
    // The full order, including the two passes the old stub set left silent.
    // Scanning runs before the expiry sweep so a file that becomes available in
    // this tick is already out of quarantine when the sweep looks; redaction is
    // last so a row settled in this run waits for the next one.
    expect(calls).toEqual([
      "escalations",
      "annual-return-reminders",
      "service-subscription-reminders",
      "stranded",
      "dispatch:7",
      "scans",
      "analysis",
      "stalled-quarantine",
      "uploads",
      "redact",
    ]);
    expect(result.failures).toEqual([]);
  });

  /**
   * The regression this isolation exists for.
   *
   * The passes used to be nine plain sequential awaits with no error handling,
   * and the scan pass builds its worker from a factory that throws whenever the
   * malware provider is unconfigured -- the permanent state under
   * BLOCKED_INTEGRATION. So on the deployed runtime the tick aborted at pass six
   * and the three passes after it never ran, including the one the code's own
   * comment named as the thing keeping the quarantine backlog visible.
   */
  it("runs the passes after one that throws, and names the pass that failed", async () => {
    const calls: string[] = [];

    const result = await runExpectingFailure({
      ...passingDependencies(calls),
      drainDocumentScanJobs: vi.fn(async () => {
        calls.push("scans");
        throw new Error("Live document scanning requires DOCUMENT_SCANNER_URL.");
      }),
    });

    // Every later pass still ran. This is the whole point.
    expect(calls).toContain("stalled-quarantine");
    expect(calls).toContain("uploads");
    expect(calls).toContain("redact");

    expect(result.failures).toEqual([
      {
        pass: "drainDocumentScanJobs",
        message: "Live document scanning requires DOCUMENT_SCANNER_URL.",
      },
    ]);
  });

  // Null, not zero. A pass that threw produced no information, which is a
  // different fact from a pass that ran and found nothing -- and reporting 0 for
  // both is how a broken pass reads as a quiet one.
  it("reports null rather than zero for a pass that failed", async () => {
    const result = await runExpectingFailure({
      ...passingDependencies([]),
      cleanupExpiredUploads: vi.fn(async () => {
        throw new Error("R2 unreachable");
      }),
      redactNotifications: vi.fn(async () => {
        throw new Error("connection terminated");
      }),
    });

    expect(result.uploads).toBeNull();
    expect(result.notifications.redacted).toBeNull();
    // The pass beside it in the same field still reported its own number.
    expect(result.notifications.strandedFailed).toBe(2);
    expect(result.failures.map((failure) => failure.pass)).toEqual([
      "cleanupExpiredUploads",
      "redactNotifications",
    ]);
  });

  // A thrown value can carry a provider payload or a connection string, and this
  // is logged, so only an Error's message is ever recorded.
  it("does not record a thrown value that is not an Error", async () => {
    const result = await runExpectingFailure({
      ...passingDependencies([]),
      evaluateEscalations: vi.fn(async () => {
        throw { secret: "postgres://user:password@host/db" };
      }),
    });

    expect(result.failures).toEqual([
      { pass: "evaluateEscalations", message: "Unknown maintenance failure." },
    ]);
    expect(JSON.stringify(result)).not.toContain("password");
  });
});
