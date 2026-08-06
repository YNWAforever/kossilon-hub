import type { DispatchSummary } from "@/features/notifications/types";

export type ScheduledMaintenanceDependencies = {
  evaluateEscalations(now: string): Promise<{ warnings: number; breaches: number }>;
  dispatchDue(now: string, limit: number): Promise<DispatchSummary>;
  cleanupExpiredUploads(now: string): Promise<{ expired: number }>;
  redactNotifications(now: string): Promise<{ redacted: number }>;
};

export type ScheduledMaintenanceResult = {
  now: string;
  escalations: { warnings: number; breaches: number };
  dispatch: DispatchSummary;
  uploads: { expired: number };
  notifications: { redacted: number };
};

export async function runScheduledMaintenance(
  now: string,
  dependencies: ScheduledMaintenanceDependencies,
  options: { dispatchLimit?: number } = {},
): Promise<ScheduledMaintenanceResult> {
  const escalations = await dependencies.evaluateEscalations(now);
  const dispatch = await dependencies.dispatchDue(now, options.dispatchLimit ?? 50);
  const uploads = await dependencies.cleanupExpiredUploads(now);
  // Last: redaction is housekeeping, and running it after the dispatch pass means
  // a row settled in this same run is not considered until the next.
  const notifications = await dependencies.redactNotifications(now);
  return { now, escalations, dispatch, uploads, notifications };
}
