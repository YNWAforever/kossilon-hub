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
  drainDocumentScanJobs(now: string): Promise<ScanDrainSummary>;
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

export type ScheduledMaintenanceResult = {
  now: string;
  escalations: { warnings: number; breaches: number };
  annualReturnReminders: { sent: number; skipped: number };
  serviceSubscriptionReminders: { sent: number; skipped: number };
  dispatch: DispatchSummary;
  documentScans: ScanDrainSummary & { stalled: number };
  uploads: { expired: number };
  notifications: { strandedFailed: number; redacted: number };
};

export async function runScheduledMaintenance(
  now: string,
  dependencies: ScheduledMaintenanceDependencies,
  options: { dispatchLimit?: number } = {},
): Promise<ScheduledMaintenanceResult> {
  const escalations = await dependencies.evaluateEscalations(now);
  const annualReturnReminders = await dependencies.evaluateAnnualReturnReminders(now);
  const serviceSubscriptionReminders = await dependencies.evaluateServiceSubscriptionReminders(now);
  // Before dispatch: a row stranded on its final attempt is unreclaimable and
  // unredactable, so it is finalised here rather than sitting invisible forever.
  const stranded = await dependencies.failStrandedNotifications(now);
  const dispatch = await dependencies.dispatchDue(now, options.dispatchLimit ?? 50);
  // Scanning runs before the expiry sweep so a file that becomes available in
  // this tick is already out of quarantine when the sweep looks.
  const scans = await dependencies.drainDocumentScanJobs(now);
  const stalledQuarantine = await dependencies.escalateStalledQuarantine(now);
  const uploads = await dependencies.cleanupExpiredUploads(now);
  // Last: redaction is housekeeping, and running it after the dispatch pass means
  // a row settled in this same run is not considered until the next.
  const redaction = await dependencies.redactNotifications(now);
  return {
    now,
    escalations,
    annualReturnReminders,
    serviceSubscriptionReminders,
    dispatch,
    documentScans: { ...scans, stalled: stalledQuarantine.stalled },
    uploads,
    notifications: { strandedFailed: stranded.failed, redacted: redaction.redacted },
  };
}
