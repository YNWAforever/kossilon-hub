import { describe, expect, it } from "vitest";
import {
  describeCaseHistoryEntry,
  mergeCaseHistory,
  type AssignmentEventRow,
  type AuditEventRow,
} from "./case-history";

const baseAuditRow: AuditEventRow = {
  id: "a1000000-0000-0000-0000-000000000001",
  actor_id: "20000000-0000-0000-0000-000000000001",
  actor_name: "Amy Chan",
  actor_role: "Staff",
  action: "add_note",
  result: "succeeded",
  summary: "Note added.",
  metadata: {},
  created_at: "2026-08-01T09:00:00.000Z",
};

const baseAssignmentRow: AssignmentEventRow = {
  id: "b1000000-0000-0000-0000-000000000001",
  work_item_id: "c1000000-0000-0000-0000-000000000001",
  previous_assignee_id: "20000000-0000-0000-0000-000000000001",
  previous_assignee_name: "Amy Chan",
  assigned_to_id: "20000000-0000-0000-0000-000000000002",
  assigned_to_name: "Ken Wong",
  assigned_by_id: "20000000-0000-0000-0000-000000000003",
  assigned_by_name: "Mei Lam",
  decision: "manual",
  override_reason: null,
  recommendation_rank: null,
  recommendation_score: null,
  recommendation_factors: {},
  created_at: "2026-08-02T09:00:00.000Z",
};

describe("mergeCaseHistory", () => {
  it("sorts audit and assignment entries together, newest first", () => {
    const older = { ...baseAuditRow, created_at: "2026-08-01T09:00:00.000Z" };
    const newer = { ...baseAssignmentRow, created_at: "2026-08-02T09:00:00.000Z" };

    const merged = mergeCaseHistory([older], [newer]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ kind: "assignment", id: newer.id });
    expect(merged[1]).toMatchObject({ kind: "audit", id: older.id });
  });

  it("maps an audit row to a fully-shaped audit entry", () => {
    const [entry] = mergeCaseHistory([baseAuditRow], []);

    expect(entry).toEqual({
      kind: "audit",
      id: baseAuditRow.id,
      createdAt: "2026-08-01T09:00:00.000Z",
      actorId: baseAuditRow.actor_id,
      actorName: baseAuditRow.actor_name,
      actorRole: baseAuditRow.actor_role,
      action: baseAuditRow.action,
      result: baseAuditRow.result,
      summary: baseAuditRow.summary,
      metadata: baseAuditRow.metadata,
    });
  });

  it("maps an assignment row to a fully-shaped assignment entry", () => {
    const [entry] = mergeCaseHistory([], [baseAssignmentRow]);

    expect(entry).toEqual({
      kind: "assignment",
      id: baseAssignmentRow.id,
      createdAt: "2026-08-02T09:00:00.000Z",
      workItemId: baseAssignmentRow.work_item_id,
      previousAssigneeId: baseAssignmentRow.previous_assignee_id,
      previousAssigneeName: baseAssignmentRow.previous_assignee_name,
      assignedToId: baseAssignmentRow.assigned_to_id,
      assignedToName: baseAssignmentRow.assigned_to_name,
      assignedById: baseAssignmentRow.assigned_by_id,
      assignedByName: baseAssignmentRow.assigned_by_name,
      decision: baseAssignmentRow.decision,
      overrideReason: baseAssignmentRow.override_reason,
      recommendationRank: baseAssignmentRow.recommendation_rank,
      recommendationScore: baseAssignmentRow.recommendation_score,
      recommendationFactors: baseAssignmentRow.recommendation_factors,
    });
  });

  it("accepts a Date object for created_at", () => {
    const [entry] = mergeCaseHistory(
      [{ ...baseAuditRow, created_at: new Date("2026-08-01T09:00:00.000Z") }],
      [],
    );

    expect(entry.createdAt).toBe("2026-08-01T09:00:00.000Z");
  });

  it("coerces the numeric string postgres returns for recommendation_score into a number", () => {
    const [entry] = mergeCaseHistory(
      [],
      [{ ...baseAssignmentRow, recommendation_score: "0.0000" }],
    );

    expect(entry).toMatchObject({ recommendationScore: 0 });
  });

  it("breaks ties on identical timestamps deterministically by id", () => {
    const at = "2026-08-02T09:00:00.000Z";
    const auditRow = {
      ...baseAuditRow,
      id: "a1000000-0000-0000-0000-000000000001",
      created_at: at,
    };
    const assignmentRow = {
      ...baseAssignmentRow,
      id: "b1000000-0000-0000-0000-000000000001",
      created_at: at,
    };

    const merged = mergeCaseHistory([auditRow], [assignmentRow]);

    expect(merged.map((entry) => entry.id)).toEqual([assignmentRow.id, auditRow.id]);
  });
});

describe("describeCaseHistoryEntry", () => {
  const auditActionLabels: Record<AuditEventRow["action"], string> = {
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

  it.each(Object.entries(auditActionLabels) as [AuditEventRow["action"], string][])(
    "labels audit action %s as %s",
    (action, label) => {
      const [entry] = mergeCaseHistory([{ ...baseAuditRow, action }], []);

      expect(describeCaseHistoryEntry(entry).label).toBe(label);
    },
  );

  it("labels an audit entry's description as its stored summary", () => {
    const [entry] = mergeCaseHistory([baseAuditRow], []);

    expect(describeCaseHistoryEntry(entry).description).toBe("Note added.");
  });

  it("labels a manual assignment and describes the reassignment", () => {
    const [entry] = mergeCaseHistory([], [baseAssignmentRow]);

    const { label, description } = describeCaseHistoryEntry(entry);
    expect(label).toBe("Assignment: manual");
    expect(description).toBe("Amy Chan → Ken Wong");
  });

  it("labels an overridden assignment and includes the override reason", () => {
    const [entry] = mergeCaseHistory(
      [],
      [{ ...baseAssignmentRow, decision: "override", override_reason: "Amy is on leave." }],
    );

    const { label, description } = describeCaseHistoryEntry(entry);
    expect(label).toBe("Assignment: overridden");
    expect(description).toBe("Amy Chan → Ken Wong (Amy is on leave.)");
  });

  it("labels an accepted-recommendation assignment", () => {
    const [entry] = mergeCaseHistory(
      [],
      [{ ...baseAssignmentRow, decision: "accepted_recommendation" }],
    );

    expect(describeCaseHistoryEntry(entry).label).toBe("Assignment: accepted recommendation");
  });

  it("describes an assignment with no previous assignee as Unassigned", () => {
    const [entry] = mergeCaseHistory(
      [],
      [{ ...baseAssignmentRow, previous_assignee_id: null, previous_assignee_name: null }],
    );

    expect(describeCaseHistoryEntry(entry).description).toBe("Unassigned → Ken Wong");
  });
});
