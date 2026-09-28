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
  if (!workItem.slaWarningAt || !workItem.slaDueAt) return "none";
  if (workItem.slaBreachedAt) return "breach";

  const current = timestamp(now, "Current time");
  if (current >= timestamp(workItem.slaDueAt, "SLA due time")) return "breach";
  if (current >= timestamp(workItem.slaWarningAt, "SLA warning time")) return "warning";
  return "none";
}

export type SlaDisplayState =
  | "not-configured"
  | "not-started"
  | "on-track"
  | "at-risk"
  | "breached"
  | "acknowledged"
  | "unavailable";

export type SlaDisplayInput = {
  status: WorkItem["status"];
  escalationState: "none" | "warning" | "breach" | "acknowledged";
  workDueAt: string | null;
  slaPolicyVersionId: string | null;
  slaStartedAt: string | null;
  slaWarningAt: string | null;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  evaluatedAt: string | null;
};

export type SlaDisplay = {
  state: SlaDisplayState;
  workDueAt: string | null;
  workOverdue: boolean;
  slaDueAt: string | null;
  evaluatedAt: string | null;
  policyVersionId: string | null;
};

export function deriveSlaDisplay(input: SlaDisplayInput, now: string): SlaDisplay {
  const current = timestamp(now, "Current time");
  const workDue = input.workDueAt ? Date.parse(input.workDueAt) : null;
  const workOverdue = workDue !== null && Number.isFinite(workDue) && current >= workDue;
  const common = {
    workDueAt: input.workDueAt,
    workOverdue,
    slaDueAt: input.slaDueAt,
    evaluatedAt: input.evaluatedAt,
    policyVersionId: input.slaPolicyVersionId,
  };
  if (!input.slaPolicyVersionId) return { ...common, state: "not-configured" };
  if (!input.slaStartedAt) return { ...common, state: "not-started" };
  if (!input.slaWarningAt || !input.slaDueAt) return { ...common, state: "unavailable" };
  const warning = Date.parse(input.slaWarningAt);
  const due = Date.parse(input.slaDueAt);
  if (!Number.isFinite(warning) || !Number.isFinite(due) || warning >= due) {
    return { ...common, state: "unavailable" };
  }
  if (input.escalationState === "acknowledged" && (input.slaBreachedAt || current < due)) {
    return { ...common, state: "acknowledged" };
  }
  if (input.escalationState === "breach" || input.slaBreachedAt || current >= due) {
    return { ...common, state: "breached" };
  }
  if (input.escalationState === "warning" || current >= warning) {
    return { ...common, state: "at-risk" };
  }
  return { ...common, state: "on-track" };
}
