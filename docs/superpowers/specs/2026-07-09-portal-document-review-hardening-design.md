# Portal Document Review Hardening Design

## Summary

This phase hardens the mocked client portal and document archive that were added in the previous phase. It closes two gaps: one-time portal actions should be safe to call repeatedly, and staff need a credible way to accept or reject client-uploaded documents from `/documents`.

The result should still be local-state only. No real upload backend, auth, notifications, or file preview is added. The goal is to make the existing demo flow feel operationally trustworthy: client uploads enter the archive, staff review them, rejected required documents reopen in the portal, accepted required documents allow packet approval, and duplicate client clicks do not spam the activity feed or annual-return timeline.

## Goals

- Make one-time portal actions idempotent at the store layer.
- Add staff accept/reject review actions for client-uploaded archive documents.
- Treat accepted required uploads as satisfying packet approval.
- Treat rejected required uploads as needing replacement in the portal.
- Show document review status and actions in `/documents`.
- Keep portal activity, archive rows, and annual-return timeline entries synchronized.
- Replace the weakest source-string route assertions with rendered route coverage for portal and documents behavior.

## Non-Goals

- No real file upload, file preview, object storage, virus scanning, or OCR.
- No real authentication, authorization, or staff identity provider.
- No backend persistence or database migration.
- No email, WhatsApp, or push notification delivery.
- No broad redesign of `/portal`, `/documents`, or annual-return detail.
- No document comment threads, reviewer assignment queues, or SLA dashboards.

## Recommended Direction

Use the focused A+B approach:

- **A, portal hardening:** guard repeated payment acknowledgement, packet approval, and receipt viewing so they return success without adding duplicate action or timeline records.
- **B, staff document review:** let staff accept or reject client-uploaded documents from `/documents`; rejected uploads remain visible but no longer satisfy required portal documents.

Alternative approaches considered:

- **Labels only:** show review status without actions. This is fast but does not improve the workflow enough because staff still cannot resolve uploaded evidence.
- **Full review queue:** add assignment, comments, filters, and notification-like actions. This is more complete, but it is too large for the next phase and would distract from closing the current PR review gaps.

The focused combined approach is the best fit because it improves correctness and adds one staff workflow using the existing local store boundaries.

## Architecture

Continue using `src/lib/client-portal-store.ts` as the local source of truth for mocked portal documents and portal/archive activity. The annual-return store remains the source of truth for case readiness, checklist, payment, packet, filing, receipt, and case timeline state.

The portal store should add one review mutation:

- `reviewClientDocument(documentId, decision, actor)`

The decision should be either `accepted` or `rejected`. The mutation should update only client-uploaded, non-superseded documents that are still reviewable. It should append a portal/archive action and an annual-return timeline event. It should return a structured failure for missing, generated, superseded, already-reviewed, or read-only documents.

The store should also add a small helper for required-document satisfaction:

- A required portal document is satisfied only when the latest upload for that requirement is `accepted`.
- A latest upload with `uploaded` status should show as pending staff review, should not count as complete, and should not reopen the client upload action.
- A latest upload with `rejected` status should reopen the client replacement action.

One-time actions should be guarded with existing action lookup before mutation. If a completed action already exists for the same case and type, the mutation should return success and avoid adding a new action, timeline event, or store emission.

## Data Model

Reuse `ClientPortalDocumentStatus`:

- `uploaded`: client file is present and waiting for staff review.
- `accepted`: staff accepted the current uploaded file.
- `rejected`: staff rejected the current uploaded file; it stays in the archive and the client must replace it.
- `superseded`: a later replacement exists.
- `generated`: staff/system generated archive artifact.

Add review metadata to client documents:

- `reviewedBy`
- `reviewedAt`
- `reviewSummary`

Reuse `ClientPortalAction` for both client and staff activity by extending the action type union with:

- `accept-document`
- `reject-document`

The archive row should expose enough review data for `/documents` to display review state and decide whether action buttons are enabled.

## Portal Behavior

The client portal should continue to show required document actions. The details change:

- No upload exists: show `Upload <document>`.
- Latest upload is `uploaded`: show pending staff review detail, keep the action unavailable to the client, and do not count it as complete.
- Latest upload is `accepted`: show complete detail and let packet approval count it as satisfied.
- Latest upload is `rejected`: show `Replace <document>` and explain that staff rejected the previous file.
- Filed or accepted-packet cases remain read-only, except receipt viewing stays available when a receipt exists.

Payment acknowledgement, packet approval, and receipt viewing should be idempotent. Repeated clicks should not duplicate the portal activity feed or annual-return timeline.

## Documents Behavior

The `/documents` route should keep its existing filters and archive table. Add one review/action column for client-uploaded rows:

- Pending uploaded rows show `Accept` and `Reject` controls.
- Accepted rows show accepted review metadata.
- Rejected rows show rejected review metadata.
- Superseded, generated, filing-submission, filing-receipt, and staff-packet rows are read-only.

The route does not need a modal or comment form. Review summaries can be generated by the store, for example `Accepted by Operations` or `Rejected by Operations; replacement required`.

The route should remain dense and operational, matching the existing dashboard style.

## Error Handling

Store mutations should return explicit `{ ok: false, reason }` failures for invalid review attempts. UI should surface the reason in a small inline warning near the archive controls.

Idempotent one-time actions should not surface warnings when repeated. They should behave as successful no-ops.

Packet approval should fail with a clear reason when required documents are missing, pending review, or rejected. The reason should list the affected document labels.

## Testing

Add store tests for:

- Payment acknowledgement is idempotent and does not duplicate activity.
- Packet approval is idempotent after it succeeds.
- Receipt viewing is idempotent after a receipt exists.
- Packet approval is blocked while required uploads are pending review.
- Accepted required uploads allow packet approval.
- Rejected required uploads reopen the portal replacement action.
- Review attempts fail for generated, superseded, missing, or already-reviewed documents.

Add rendered route tests for:

- `/portal?caseId=ar-delta` selects the requested case and renders required document/payment/packet actions.
- `/documents?caseId=ar-delta` renders the archive workspace filtered to the requested case.
- The documents route exposes staff review controls for pending client uploads.

Keep targeted source-string assertions only where they are checking generated route registration or static route contracts that are hard to exercise through SSR.

## Acceptance Criteria

- Repeated one-time portal actions do not create duplicate activity or timeline entries.
- Required documents must be staff-accepted before packet approval can succeed.
- Rejected required documents become client-replaceable again in the portal.
- Staff can accept or reject pending client uploads from `/documents`.
- Read-only archive rows cannot be reviewed.
- Route tests cover the visible portal and documents behavior through rendered output.
- Existing annual-return, portal, archive, lint, and build checks continue to pass with only known baseline warnings.
