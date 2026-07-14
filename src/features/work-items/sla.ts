import { addBusinessMinutes } from "./business-calendar";
import type {
  BusinessCalendar,
  SlaPolicyVersion,
  SlaSnapshot,
  SlaThreshold,
  WorkItem,
} from "./types";

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

export function snapshotSla(
  policy: SlaPolicyVersion,
  startedAt: string,
  calendar: BusinessCalendar,
): SlaSnapshot {
  if (!Number.isSafeInteger(policy.warningMinutes) || policy.warningMinutes <= 0) {
    throw new Error("SLA warning minutes must be positive.");
  }
  if (!Number.isSafeInteger(policy.dueMinutes) || policy.dueMinutes <= policy.warningMinutes) {
    throw new Error("SLA due minutes must be greater than warning minutes.");
  }

  return {
    policyVersionId: policy.id,
    startedAt: new Date(timestamp(startedAt, "SLA start")).toISOString(),
    warningAt: addBusinessMinutes(startedAt, policy.warningMinutes, calendar),
    dueAt: addBusinessMinutes(startedAt, policy.dueMinutes, calendar),
  };
}

export function thresholdFor(workItem: WorkItem, now: string): SlaThreshold {
  if (workItem.status === "completed" || workItem.status === "cancelled") return "none";
  if (workItem.slaBreachedAt) return "breach";

  const current = timestamp(now, "Current time");
  if (current >= timestamp(workItem.slaDueAt, "SLA due time")) return "breach";
  if (current >= timestamp(workItem.slaWarningAt, "SLA warning time")) return "warning";
  return "none";
}
