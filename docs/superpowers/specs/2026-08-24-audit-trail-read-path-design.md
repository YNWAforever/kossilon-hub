# P0-11: Statutory audit trail read path — design

**Status:** Approved
**Date:** 2026-08-24
**Roadmap item:** P0-11 (`01-Kossilon-Hub-Roadmap-P0-P3.md:49`), the last unaddressed P0 item.

## Problem

`annual_return_audit_events` is inserted at every annual-return case mutation (`src/features/annual-return/repository.ts`) and `assignment_events` is inserted whenever a work item's owner/reviewer is (re)assigned (`src/features/work-items/repository.ts`, and cascaded from `annual-return/repository.ts`'s `assignOwner`). Neither table is ever read by application code — the only `select`s against either table exist in test assertions. Records kept for compliance that cannot be produced on request are not records.

## Scope

A read path and a case-level history view for **annual-return cases only**, merging `annual_return_audit_events` and `assignment_events` into one chronological feed on the existing `/annual-returns/$id` production detail screen.

**Explicitly out of scope** (real gaps, not solved here):
- `corporate_change_requests` (P1-9) has no audit table at all yet. Adding one is a separate, not-yet-scoped item.
- CSV/PDF export. The roadmap names this as a stretch goal ("ideally"); no CSV/PDF generation library exists anywhere in this codebase today. Ship the read path first; export is a natural fast-follow once the view is proven useful.
- `timeline_events` is a separate, lower-fidelity activity-feed table written at the same call sites as `annual_return_audit_events`, and it already has a UI shape in demo mode (`demo-case-detail.tsx`'s "Timeline" panel, fed from a fixture store, not the real table). It is left untouched by this item — unifying it into one feed roughly doubles scope and touches a table the roadmap gap doesn't name.

## Data model

No new tables or columns. Two new repository read functions in `src/features/annual-return/repository.ts`:

```sql
-- listAuditEventsForCase(caseId)
select
  e.id, e.case_id, e.actor_id, u.name as actor_name, e.actor_role,
  e.action, e.result, e.summary, e.metadata, e.created_at
from annual_return_audit_events e
left join users u on u.id = e.actor_id
where e.case_id = $1
order by e.created_at desc
limit 200;
```

```sql
-- listAssignmentEventsForCase(caseId)
select
  a.id, a.work_item_id, a.previous_assignee_id, pu.name as previous_assignee_name,
  a.assigned_to_id, tu.name as assigned_to_name,
  a.assigned_by_id, bu.name as assigned_by_name,
  a.decision, a.override_reason, a.recommendation_rank, a.recommendation_score,
  a.recommendation_factors, a.created_at
from assignment_events a
join work_items w on w.id = a.work_item_id
left join users pu on pu.id = a.previous_assignee_id
join users tu on tu.id = a.assigned_to_id
join users bu on bu.id = a.assigned_by_id
where w.annual_return_case_id = $1
order by a.created_at desc
limit 200;
```

`assignment_events` has no direct case FK — it is keyed by `work_item_id`, so the join goes through `work_items.annual_return_case_id` (the discriminator column P1-4 added). Both queries are independently bounded at 200 rows to avoid the unscoped-scan pattern the roadmap flags elsewhere (P3-5); a case that somehow exceeds 200 combined history rows will show the 200 most recent with no further pagination in this pass — a real limitation, not silently hidden (the UI states "showing most recent N").

A pure merge function combines both result sets into one sorted array of a shared discriminated type:

```ts
type CaseHistoryEntry =
  | {
      kind: "audit";
      id: string;
      createdAt: string;
      actorId: string | null;
      actorName: string | null;
      actorRole: "Admin" | "Manager" | "Staff";
      action: AnnualReturnAction; // existing type in permissions.ts
      result: "succeeded" | "denied" | "failed";
      summary: string;
      metadata: Record<string, unknown>;
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
      recommendationFactors: Record<string, unknown>;
    };

function mergeCaseHistory(
  auditEvents: AuditEventRow[],
  assignmentEvents: AssignmentEventRow[],
): CaseHistoryEntry[];
```

`mergeCaseHistory` is pure and dependency-free — sorts the concatenation of both mapped arrays by `createdAt` descending. Tested with no database.

## Authorization

Mirrors the existing `listAnnualReturnCaseNotesForActor` pattern exactly (`src/features/annual-return/server-fns.ts`):

```ts
export async function listAnnualReturnCaseHistoryForActor(
  actor: AuthenticatedActor,
  input: { caseId: string },
  dependencies: {
    repository: Pick<AnnualReturnRepository, "getCase" | "listAuditEventsForCase" | "listAssignmentEventsForCase">;
  },
): Promise<CaseHistoryEntry[]> {
  const case_ = await dependencies.repository.getCase(input.caseId);
  if (!case_) {
    throw new Error("Annual return case not found.");
  }
  assertAnnualReturnCaseVisible(boardActorFrom(actor), case_);
  const [auditEvents, assignmentEvents] = await Promise.all([
    dependencies.repository.listAuditEventsForCase(input.caseId),
    dependencies.repository.listAssignmentEventsForCase(input.caseId),
  ]);
  return mergeCaseHistory(auditEvents, assignmentEvents);
}
```

Throws `Forbidden: this annual return case is outside your scope.` for an out-of-scope case (same convention as `listAnnualReturnCaseNotesForActor`, deliberately not the null-on-forbidden convention `getAnnualReturnCaseForActor` uses for the top-level case fetch — this is a sub-resource read, not a "does this id exist" probe). No new authorization concept; reuses `assertAnnualReturnCaseVisible` and the existing team/owner/reviewer scoping every other case sub-resource already uses.

A new `listAnnualReturnCaseHistory` server fn (TanStack Start `createServerFn`, `.validator()` on `{ caseId: string }`) wraps this the same way `listAnnualReturnCaseNotes` wraps its `*ForActor` function today.

## UI

A new "Audit history" section on `src/features/annual-return/components/production-case-detail.tsx`, placed after the existing Notes section. Read-only — no mutation path, matching the nature of an audit log. Each entry renders:
- Timestamp (formatted with the existing Hong Kong business-date helper already used elsewhere on this page)
- Actor name + role (or "System" if `actorId` is null)
- A human-readable label derived from `action` (audit) or `decision` (assignment) via a small formatter:
  - `create_case` → "Case created", `assign_owner` → "Owner reassigned", `add_note` → "Note added", `record_reminder` → "Reminder recorded", `update_checklist` → "Checklist updated", `update_payment` → "Payment updated", `update_filing_proof` → "Filing proof updated", `change_status` → "Status changed", `complete` → "Case completed"
  - `accepted_recommendation` → "Assignment: accepted recommendation", `override` → "Assignment: overridden" (shows `overrideReason`), `manual` → "Assignment: manual"
- The stored `summary` (audit) or a short derived description (assignment: "{previousAssigneeName or 'Unassigned'} → {assignedToName}")
- An expandable "Details" disclosure showing the raw `metadata` / `recommendationFactors` JSON for anyone who needs the full record, not just the human summary

Demo mode is untouched — `demo-case-detail.tsx`'s existing Timeline panel keeps reading from its fixture store exactly as it does today; this item adds no demo-mode equivalent (matching the existing exception already established for `/clients` and `/incorporation`, since there is no fixture story for a real audit log any more than there is for a real client register).

## Explicitly out of scope (restated)

- Corporate-change-request audit table — real gap, separate future item.
- Export (CSV/PDF) — real stretch goal named in the roadmap, deferred; no precedent library exists.
- Unifying `timeline_events` into this feed — separate, lower-stakes table; left as-is.
- Any write-path change — the existing insert call sites in `annual-return/repository.ts` and `work-items/repository.ts` are already correct and are not touched.
- Pagination beyond the 200-row cap per source table — a real, accepted limitation for this pass.

## Verification plan

- Unit tests for `mergeCaseHistory` (pure, no DB) covering sort order and both entry kinds.
- Authorization tests for `listAnnualReturnCaseHistoryForActor` extending the existing visible/forbidden matrix (Admin sees all, Manager/Staff team-scoped, owner/reviewer cross-team exception, inactive/Client actor forbidden).
- Repository integration test behind `describe.skipIf(!databaseUrl)` proving the real `work_items` join reaches `assignment_events` for a case, and that `annual_return_audit_events` rows for a case are returned in the right order — run against a real local Postgres, not just reasoned about.
- Component test for the new "Audit history" section using `fireEvent` (this codebase has no `@testing-library/user-event` or `jest-dom` installed; follow the existing convention of `fireEvent` + plain DOM property assertions).
- Full suite green, `verify:firm --dry-run` PASS, CI `verify` job confirmed `SUCCESS` via `gh pr view <n> --json statusCheckRollup` before treating this as done — per the standing discipline from the PR #46 near-miss.
