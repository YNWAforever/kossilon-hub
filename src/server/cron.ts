import type { ScanDrainSummary } from "@/features/documents/scan-worker";
import type { DispatchSummary } from "@/features/notifications/types";

export type ScheduledMaintenanceDependencies = {
  evaluateEscalations(now: string): Promise<{ warnings: number; breaches: number }>;
  evaluateAnnualReturnReminders(now: string): Promise<{ sent: number; skipped: number }>;
  evaluateServiceSubscriptionReminders(now: string): Promise<{ sent: number; skipped: number }>;
  dispatchDue(now: string, limit: number): Promise<DispatchSummary>;
  /**
   * Received files waiting on a malware verdict. This is the only thing that
   * moves a document out of quarantine: before it existed, `scanQuarantinedDocument`
   * was a staff-triggered HTTP call with zero production callers, so nothing ever
   * scanned anything.
   */
  drainDocumentScanJobs(now: string): Promise<ScanDrainSummary & { scanner: ScannerAvailability }>;
  /**
   * Received files whose retention window lapsed without a verdict. Reports
   * only -- it must never delete evidence, which is the failure this whole pass
   * exists to prevent.
   */
  escalateStalledQuarantine(now: string): Promise<{ stalled: number }>;
  cleanupExpiredUploads(now: string): Promise<{ expired: number }>;
  failStrandedNotifications(now: string): Promise<{ failed: number }>;
  redactNotifications(now: string): Promise<{ redacted: number }>;
};

/**
 * Whether the scan pass had a scanner at all.
 *
 * Zeros on their own are ambiguous: "nothing was due" and "there is no scanner
 * configured" report identically, and the second must never be read as the
 * first. Under `BLOCKED_INTEGRATION: malware-scanner-provider` the second is the
 * permanent state, so it is named rather than inferred.
 */
export type ScannerAvailability = "ran" | "not-configured";

export type MaintenancePassFailure = {
  /** The dependency that threw, so a log line names the pass. */
  pass: string;
  message: string;
};

/**
 * Every pass is nullable, and null is not zero.
 *
 * A pass that threw produced no information at all, which is a different fact
 * from a pass that ran and found nothing to do. Reporting `0` for both is how a
 * broken pass reads as a quiet one.
 */
export type ScheduledMaintenanceResult = {
  now: string;
  escalations: { warnings: number; breaches: number } | null;
  annualReturnReminders: { sent: number; skipped: number } | null;
  serviceSubscriptionReminders: { sent: number; skipped: number } | null;
  dispatch: DispatchSummary | null;
  documentScans: (ScanDrainSummary & { scanner: ScannerAvailability }) | null;
  /**
   * Split out of `documentScans`, which used to merge it in. They are two
   * separate passes with separate fates: the merged shape could not express a
   * failed scan pass beside a successful escalation pass, and that combination
   * is exactly what a missing scanner produces.
   */
  stalledQuarantine: { stalled: number } | null;
  uploads: { expired: number } | null;
  notifications: { strandedFailed: number | null; redacted: number | null };
  /** Passes that threw. Empty on a clean run. */
  failures: MaintenancePassFailure[];
};

/**
 * Run one pass, and let the rest of the tick survive it failing.
 *
 * This exists because of a real defect. The passes used to be nine plain
 * sequential awaits with no error handling, and the scan pass builds its worker
 * from a factory that throws whenever the malware provider is unconfigured --
 * the permanent state under BLOCKED_INTEGRATION. So on the deployed runtime the
 * throw aborted the tick at pass six, and escalateStalledQuarantine,
 * cleanupExpiredUploads and redactNotifications never ran. The comment on that
 * factory claimed the backlog would "stay visible" via escalateStalledQuarantine
 * -- the first pass the throw killed.
 *
 * Recorded rather than swallowed: `failures` is returned, the caller logs it and
 * still fails the invocation, so nothing is quieter than it was before. What
 * changes is that one broken pass no longer decides whether the other eight run.
 */
async function runPass<T>(
  pass: string,
  failures: MaintenancePassFailure[],
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    failures.push({
      pass,
      // Message only. A thrown value can carry a provider payload or a
      // connection string, and this is logged.
      message: error instanceof Error ? error.message : "Unknown maintenance failure.",
    });
    return null;
  }
}

export async function runScheduledMaintenance(
  now: string,
  dependencies: ScheduledMaintenanceDependencies,
  options: { dispatchLimit?: number } = {},
): Promise<ScheduledMaintenanceResult> {
  const failures: MaintenancePassFailure[] = [];

  const escalations = await runPass("evaluateEscalations", failures, () =>
    dependencies.evaluateEscalations(now),
  );
  const annualReturnReminders = await runPass("evaluateAnnualReturnReminders", failures, () =>
    dependencies.evaluateAnnualReturnReminders(now),
  );
  const serviceSubscriptionReminders = await runPass(
    "evaluateServiceSubscriptionReminders",
    failures,
    () => dependencies.evaluateServiceSubscriptionReminders(now),
  );
  // Before dispatch: a row stranded on its final attempt is unreclaimable and
  // unredactable, so it is finalised here rather than sitting invisible forever.
  const stranded = await runPass("failStrandedNotifications", failures, () =>
    dependencies.failStrandedNotifications(now),
  );
  const dispatch = await runPass("dispatchDue", failures, () =>
    dependencies.dispatchDue(now, options.dispatchLimit ?? 50),
  );
  // Scanning runs before the expiry sweep so a file that becomes available in
  // this tick is already out of quarantine when the sweep looks.
  const documentScans = await runPass("drainDocumentScanJobs", failures, () =>
    dependencies.drainDocumentScanJobs(now),
  );
  const stalledQuarantine = await runPass("escalateStalledQuarantine", failures, () =>
    dependencies.escalateStalledQuarantine(now),
  );
  const uploads = await runPass("cleanupExpiredUploads", failures, () =>
    dependencies.cleanupExpiredUploads(now),
  );
  // Last: redaction is housekeeping, and running it after the dispatch pass means
  // a row settled in this same run is not considered until the next.
  const redaction = await runPass("redactNotifications", failures, () =>
    dependencies.redactNotifications(now),
  );

  const result: ScheduledMaintenanceResult = {
    now,
    escalations,
    annualReturnReminders,
    serviceSubscriptionReminders,
    dispatch,
    documentScans,
    stalledQuarantine,
    uploads,
    notifications: {
      strandedFailed: stranded?.failed ?? null,
      redacted: redaction?.redacted ?? null,
    },
    failures,
  };

  // Isolation must not cost unmissable failure. Every pass got its turn, and
  // then the run still fails -- so no caller can accidentally treat a broken
  // tick as a successful one by forgetting to inspect a field. The partial
  // result rides along on the error so that logging it costs nothing either.
  if (failures.length > 0) throw new MaintenancePassesFailedError(result);

  return result;
}

/**
 * Thrown when a run completed but one or more passes failed.
 *
 * Carries the whole result, including what the passes that succeeded found.
 * Without that, isolating the passes would trade one loss for another: the tick
 * would survive, but the log would lose everything it learned.
 */
export class MaintenancePassesFailedError extends Error {
  readonly failures: MaintenancePassFailure[];
  readonly result: ScheduledMaintenanceResult;

  constructor(result: ScheduledMaintenanceResult) {
    super(
      `scheduled maintenance passes failed: ${result.failures
        .map((failure) => `${failure.pass}: ${failure.message}`)
        .join("; ")}`,
    );
    this.name = "MaintenancePassesFailedError";
    this.failures = result.failures;
    this.result = result;
  }
}

/**
 * The partial result a failed run carried, for a caller that only has `unknown`.
 *
 * `runScheduledMaintenanceForWorker` takes an injectable runner typed loosely so
 * a test can assert the wiring without executing it, and `catch` gives it
 * `unknown` regardless. Anything else yields null rather than throwing on shape.
 */
export function maintenanceResultOf(error: unknown): ScheduledMaintenanceResult | null {
  return error instanceof MaintenancePassesFailedError ? error.result : null;
}
