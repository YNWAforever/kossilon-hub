import type { AnnualReturnAction, AnnualReturnActorRole } from "./permissions";

// jsonb columns (audit_events.metadata, assignment_events.recommendation_factors)
// always deserialize to plain JSON values. Typing them this way (rather than
// Record<string, unknown>) lets TanStack Start's createServerFn prove the
// history entries are serializable — it can't prove that of a bare `unknown`.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AuditEventRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: AnnualReturnActorRole;
  action: AnnualReturnAction;
  result: "succeeded" | "denied" | "failed";
  summary: string;
  metadata: Record<string, JsonValue>;
  created_at: string | Date;
};

export type AssignmentEventRow = {
  id: string;
  work_item_id: string;
  previous_assignee_id: string | null;
  previous_assignee_name: string | null;
  assigned_to_id: string;
  assigned_to_name: string;
  assigned_by_id: string;
  assigned_by_name: string;
  decision: "accepted_recommendation" | "override" | "manual";
  override_reason: string | null;
  recommendation_rank: number | null;
  // numeric(10,4) in Postgres — postgres.js has no default parser for OID 1700
  // (numeric), so this arrives as a string (e.g. "0.8750"), not a number.
  recommendation_score: string | null;
  recommendation_factors: Record<string, JsonValue>;
  created_at: string | Date;
};

export type CaseHistoryEntry =
  | {
      kind: "audit";
      id: string;
      createdAt: string;
      actorId: string | null;
      actorName: string | null;
      actorRole: AnnualReturnActorRole;
      action: AnnualReturnAction;
      result: "succeeded" | "denied" | "failed";
      summary: string;
      metadata: Record<string, JsonValue>;
    }
  | {
      kind: "assignment";
      id: string;
      createdAt: string;
      workItemId: string;
      previousAssigneeId: string | null;
      previousAssigneeName: string | null;
      assignedToId: string;
      assignedToName: string;
      assignedById: string;
      assignedByName: string;
      decision: "accepted_recommendation" | "override" | "manual";
      overrideReason: string | null;
      recommendationRank: number | null;
      recommendationScore: number | null;
      recommendationFactors: Record<string, JsonValue>;
    };

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function mergeCaseHistory(
  auditEvents: AuditEventRow[],
  assignmentEvents: AssignmentEventRow[],
): CaseHistoryEntry[] {
  const auditEntries: CaseHistoryEntry[] = auditEvents.map((row) => ({
    kind: "audit",
    id: row.id,
    createdAt: toIsoString(row.created_at),
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    action: row.action,
    result: row.result,
    summary: row.summary,
    metadata: row.metadata,
  }));

  const assignmentEntries: CaseHistoryEntry[] = assignmentEvents.map((row) => ({
    kind: "assignment",
    id: row.id,
    createdAt: toIsoString(row.created_at),
    workItemId: row.work_item_id,
    previousAssigneeId: row.previous_assignee_id,
    previousAssigneeName: row.previous_assignee_name,
    assignedToId: row.assigned_to_id,
    assignedToName: row.assigned_to_name,
    assignedById: row.assigned_by_id,
    assignedByName: row.assigned_by_name,
    decision: row.decision,
    overrideReason: row.override_reason,
    recommendationRank: row.recommendation_rank,
    recommendationScore:
      row.recommendation_score === null ? null : Number(row.recommendation_score),
    recommendationFactors: row.recommendation_factors,
  }));

  return [...auditEntries, ...assignmentEntries].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
      // Ties are the normal case, not the exception: assignOwner writes the
      // assignment_events row and its assign_owner audit row in one transaction,
      // so now() gives them the same created_at. Without this the two sources'
      // relative order is left to the planner (see repository.test.ts:919-921).
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

const AUDIT_ACTION_LABELS: Record<AnnualReturnAction, string> = {
  create_case: "Case created",
  assign_owner: "Owner reassigned",
  add_note: "Note added",
  record_reminder: "Reminder recorded",
  update_checklist: "Checklist updated",
  update_payment: "Payment updated",
  update_filing_proof: "Filing proof updated",
  change_status: "Status changed",
  complete: "Case completed",
  prepare_package: "Package prepared",
  approve_package: "Package approved",
  record_submission: "External submission recorded",
  record_return: "Filing return intake recorded",
  reconcile_return: "Filing return reconciled",
};

const ASSIGNMENT_DECISION_LABELS: Record<AssignmentEventRow["decision"], string> = {
  accepted_recommendation: "Assignment: accepted recommendation",
  override: "Assignment: overridden",
  manual: "Assignment: manual",
};

export function describeCaseHistoryEntry(entry: CaseHistoryEntry): {
  label: string;
  description: string;
} {
  if (entry.kind === "audit") {
    return { label: AUDIT_ACTION_LABELS[entry.action] ?? entry.action, description: entry.summary };
  }

  const from = entry.previousAssigneeName ?? "Unassigned";
  const base = `${from} → ${entry.assignedToName}`;
  const description =
    entry.decision === "override" && entry.overrideReason
      ? `${base} (${entry.overrideReason})`
      : base;

  return { label: ASSIGNMENT_DECISION_LABELS[entry.decision], description };
}
