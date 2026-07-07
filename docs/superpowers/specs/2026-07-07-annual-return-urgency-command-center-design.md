# Annual Return Urgency Command Center Design

## Summary

The next phase makes Kossilon Hub feel production-real for internal staff operators by turning annual return work into an urgency-first command center. Staff should be able to open the app and understand within 10 seconds which cases are risky, what is blocked, who owns the next action, and what should happen next.

The implementation remains mocked and local-state only. It should still feel like a coherent operations system: actions on a case update readiness, blockers, timelines, tasks, payments, and WhatsApp AI context across the app.

## Goals

- Make `/annual-returns` a dense operator cockpit for annual return work.
- Show urgency, blockers, ownership, payment readiness, filing readiness, and next action at a glance.
- Make `/annual-returns/$id` the action surface where staff can resolve blockers and see case state update immediately.
- Keep the feature isolated in a focused local annual return store, using the existing `useSyncExternalStore` pattern.
- Improve credibility of WhatsApp AI replies by grounding them in richer annual return state.

## Non-Goals

- No real database persistence.
- No real file uploads or storage.
- No real auth, roles, or permissions.
- No real AI calls.
- No new external integrations.
- No broad redesign of unrelated app sections.

## Recommended Direction

Use an **Urgency Command Center** approach.

Alternative approaches considered:

- **Workflow Board:** A kanban-style flow by stage is intuitive, but weaker for deadline and risk scanning because urgent cases can be spread across columns.
- **Case Detail First:** A rich individual case page would make one case feel deep, but would leave dashboard triage underpowered.

The urgency command center best fits internal staff operations because it answers the most important questions first: what is urgent, why is it urgent, who owns it, and what action should happen next.

## Architecture

Add a focused local domain store:

`src/lib/annual-return-store.ts`

This store owns richer annual return case state and exposes hooks/selectors/mutations using the same `useSyncExternalStore` pattern already used by the knowledge base module.

The store should include:

- Case identity and linked client/enquiry identifiers.
- Company/contact metadata.
- Due date and basis date.
- Case status.
- Owner and next action owner.
- Priority or risk inputs.
- Checklist items.
- Document requirements.
- Signature state.
- Payment state.
- Internal review state.
- Notes.
- Timeline events.

The store should expose pure derived helpers:

- `getRiskLevel(case)`: returns overdue, due soon, blocked, healthy, or filed.
- `getReadinessScore(case)`: returns a filing readiness percentage from documents, payment, signatures, checklist, and review.
- `getBlockers(case)`: returns normalized blockers across documents, payment, signatures, review, and ownership.
- `getNextAction(case)`: returns concise staff-facing action text.
- `getCaseMetrics(cases)`: returns counts for overdue, due soon, blocked, ready to file, and filed.
- `getCaseTasks(case)`: returns task-like rows derived from blockers and next actions.

Keeping derived logic pure makes the workflow easier to test and keeps UI components focused on presentation and interaction.

## Data Flow

`/annual-returns` reads all cases from the annual return store. It derives command-center metrics, applies search/filter state, sorts by urgency, and links into the detail route.

`/annual-returns/$id` reads a single case and dispatches store mutations:

- `markDocumentReceived(caseId, documentId)`
- `markDocumentMissing(caseId, documentId)`
- `updatePaymentStatus(caseId, status)`
- `completeChecklistItem(caseId, itemId)`
- `reopenChecklistItem(caseId, itemId)`
- `updateSignatureStatus(caseId, status)`
- `updateReviewStatus(caseId, status)`
- `assignOwner(caseId, owner)`
- `addCaseNote(caseId, note)`
- `markFiled(caseId)`

Each state-changing mutation should also append a timeline event. Derived state then updates readiness, blockers, next action, and related surfaces.

`/tasks` should derive rows from annual return blockers and next actions rather than relying on separate static mock tasks.

`/payments` should derive payment rows from annual return cases.

`/whatsapp` should prefer enriched annual return store context when an enquiry maps to a client/case. If enriched annual return context is unavailable, it should fall back to the current basic client case context.

## UI Design

### `/annual-returns`

This page should feel like a work queue, not a marketing dashboard.

Top band:

- Overdue count.
- Due soon count.
- Blocked count.
- Ready to file count.
- Filed count.

Controls:

- Search by company/contact.
- Segmented filters for all, urgent, blocked, ready, filed.
- Owner filter, with seeded cases distributed across several staff names.

Main list/table:

- Company.
- Owner.
- Risk badge.
- Due date and days remaining.
- Readiness score.
- Blocker summary.
- Payment state.
- Next action.
- Open action.

Default sort should be urgency-first: overdue, due soon, blocked, ready to file, healthy, filed.

### `/annual-returns/$id`

This page is the action surface.

Header:

- Company name.
- Risk badge.
- Due date and days remaining.
- Owner.
- Readiness score.
- Next action.
- Link to WhatsApp AI when a matching enquiry exists.

Main panels:

- **Blockers:** Documents, payment, signatures, and review items with controls to resolve or reopen each blocker.
- **Checklist:** Operational steps that can be completed or reopened.
- **Filing readiness:** Visual score and exact missing requirements.
- **Activity timeline:** Automatic entries from actions plus manual notes.
- **Client context:** Contact details and linked case/enquiry references.

Desktop layout should be dense and two-column where useful. Mobile layout should stack panels and keep next action and readiness near the top.

## Workflow Behavior

Actions should update state immediately in local memory.

Examples:

- Marking `Signed NAR1` received removes that document blocker, increases readiness, appends a timeline event, and may change the next action.
- Updating payment from pending to paid removes the payment blocker, updates `/payments`, and may move the case closer to ready-to-file.
- Completing final review can move a case to ready-to-file if documents, payment, and signatures are complete.
- Marking a case filed should only be allowed when required blockers are resolved. Filing appends a timeline event and changes the case status to filed.
- Adding a note appends a manual timeline event without changing readiness.

## Error Handling And Guardrails

The local mocked workflow should prevent impossible or confusing transitions:

- Do not allow filing before required documents, payment, signatures, and review are complete.
- Show inline warnings when an action leaves the case blocked.
- Keep reversible controls where useful: checklist items can be reopened, documents can be toggled back to missing, owner can be reassigned.
- Unknown case ids should render a case-not-found state with a link back to `/annual-returns`.
- WhatsApp AI should degrade gracefully when enriched annual return context is unavailable.

## Testing And Verification

Pure helper tests should cover:

- Risk level calculation.
- Readiness score calculation.
- Blocker generation.
- Next action selection.
- Metrics aggregation.

Manual verification should cover:

- Filter annual return cases by risk/status.
- Open each case and confirm header metrics match detail state.
- Mark documents received/missing and confirm readiness, blockers, timeline, and tasks update.
- Update payment status and confirm `/payments` reflects the change.
- Complete checklist/review/signature actions and confirm ready-to-file behavior.
- Attempt to file a blocked case and confirm the guardrail appears.
- File a ready case and confirm filed state propagates.
- Open WhatsApp for a linked enquiry and confirm AI context reflects current annual return blockers.

If runtime tooling remains unavailable in the shell, record that verification limitation clearly and keep business logic pure enough for later automated tests.

## Implementation Boundaries

This phase should avoid broad refactors. The main implementation boundary is the annual return store and its derived helpers. Routes and components consume that store but should not duplicate business logic.

Expected file changes:

- New `src/lib/annual-return-store.ts`
- Possible small updates to `src/lib/app-data.ts`
- Updates to `src/lib/ai-agent.ts`
- Updates to `src/components/ai-assistant-panel.tsx`
- Updates to `src/routes/annual-returns.tsx`
- Updates to `src/routes/annual-returns.$id.tsx`
- Updates to `src/routes/tasks.tsx`
- Updates to `src/routes/payments.tsx`

The UI should remain restrained, dense, and operator-focused. Avoid landing-page patterns, oversized hero sections, decorative cards, or visual treatments that make repeated staff work harder to scan.
