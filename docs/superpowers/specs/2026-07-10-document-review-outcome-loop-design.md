# Document Review Outcome Loop Design

## Summary

This phase turns staff document review into a complete mocked feedback loop. Staff can reject a client-uploaded document with a structured reason code and optional note, clients can see the outcome in the portal, and rejected documents create mock WhatsApp follow-up drafts that can be sent from the automation queue.

The implementation remains local-state only. There is no real WhatsApp delivery, document preview, upload backend, authentication change, database persistence, or notification service. The goal is to make the existing accept/reject workflow feel operationally complete while keeping the store deterministic and easy to test.

## Goals

- Add structured rejection reasons and optional review notes to staff document review.
- Show review reasons, notes, reviewer, and review time in the staff document archive.
- Surface accepted and rejected document outcomes in the client portal.
- Make rejected required documents clearly replaceable in the portal with the rejection reason visible to the client.
- Derive mock WhatsApp follow-up drafts from current rejected client documents.
- Include a mock "Send now" action for rejected-document follow-ups.
- Keep portal activity, WhatsApp automation state, document archive rows, and annual-return timelines synchronized through local state.

## Non-Goals

- No real WhatsApp API calls or outbound delivery.
- No email, push notification, or external notification provider.
- No real file upload, object storage, OCR, virus scanning, or file preview.
- No backend persistence, database migration, or server route.
- No auth, role, or permission overhaul.
- No staff assignment queue, comment thread, SLA dashboard, or broad document management redesign.
- No broad redesign of `/documents`, `/portal`, `/whatsapp/automation`, or annual-return detail.

## Recommended Direction

Use a focused **Review Outcome Loop** approach.

Staff review stays anchored in `/documents`, but each review outcome becomes useful elsewhere:

- Accepted documents show accepted metadata in the archive and portal.
- Rejected documents keep structured rejection metadata, reopen the client replacement task, and create a follow-up draft for `/whatsapp/automation`.
- Sending the rejected-document follow-up is a mocked local action that appends audit history and prevents duplicate active sends for the same current rejected document.

Alternative approaches considered:

- **Review notes first:** enrich `/documents` with reasons, notes, filters, and audit metadata while leaving portal and WhatsApp behavior thin. This is lower risk, but it does not complete the client loop.
- **Automation first:** treat document decisions mainly as WhatsApp triggers. This is strong for queue demos, but staff review quality and portal clarity remain underpowered.

The recommended approach gives the next phase a complete staff-to-client loop without adding real delivery or backend complexity.

## Architecture

Continue using `src/lib/client-portal-store.ts` as the source of truth for mocked client documents, portal actions, document archive rows, review outcomes, and document-review follow-up drafts. The annual-return store remains the source of truth for case readiness, packet state, and timelines.

The existing `reviewClientDocument` mutation should expand from a simple accept/reject decision into a review payload. The implementation should keep the current decision API compatible where possible, and add an object payload path that supports:

- `decision`: accepted or rejected.
- `reasonCode`: required for rejection.
- `note`: optional free-text staff note.
- `actor`: reviewer name.

The portal store should expose derived helpers for:

- Current document review notices for a case.
- Rejected-document follow-up drafts.
- Send eligibility for rejected-document follow-ups.

It should also expose this mutation:

- `sendDocumentReviewFollowUpNow(draftId, actor)`

That mutation should record a mocked send, append portal activity, append an annual-return timeline event, and emit a store update. It should not make a network request.

UI routes should consume derived data from the store instead of duplicating review or follow-up logic. `/documents`, `/portal`, and `/whatsapp/automation` should all agree because they read from the same local model.

## Data Model

Extend client document review metadata with structured fields:

- `reviewReasonCode`
- `reviewReasonLabel`
- `reviewNote`
- `reviewSummary`
- `reviewedBy`
- `reviewedAt`

Suggested rejection reason codes:

- `wrong-file`: Wrong document uploaded.
- `expired`: Document is expired or outdated.
- `unclear-scan`: Scan is unreadable or incomplete.
- `name-mismatch`: Name or company details do not match.
- `missing-signature`: Required signature is missing.
- `missing-page`: Required page or attachment is missing.
- `other`: Other issue explained in the note.

Accepting a document does not require a reason code. It should keep a clear review summary such as `Accepted by Operations`.

Rejected-document follow-up drafts should be derived from the current document state rather than stored as independent campaigns. A draft should include:

- Stable id derived from case id and current rejected document id.
- Case id and document id.
- Company and contact metadata.
- Recipient name and phone from the annual-return case.
- Reason label and optional note.
- Message preview.
- Status: draft, sent, or blocked.
- Blocked reason when the document is no longer current, the case is filed, or the draft was already sent.

The store should keep a small sent-follow-up record keyed by rejected document id so the same current rejected document is not sent twice.

## Staff Archive Behavior

In `/documents`, pending client-uploaded rows remain reviewable. Rejecting a document should require a reason code and allow an optional note.

The UI can stay compact:

- Accept remains a quick action.
- Reject opens a compact inline review control with a reason selector and optional note input.
- Reviewed rows show decision, reason label, note when present, reviewer, and timestamp.
- Rejected rows should show whether their rejected-document follow-up is draft, sent, or no longer active.

The archive should preserve read-only behavior for generated, superseded, accepted, rejected, filing submission, filing receipt, and staff packet rows.

## Portal Behavior

The client portal should show review outcomes in the document action area.

For required documents:

- No upload exists: show the existing upload action.
- Latest upload is pending review: show that staff are reviewing the file.
- Latest upload is accepted: show accepted status, reviewer, and review time.
- Latest upload is rejected: show the rejection reason, optional note, and a Replace action.

Rejected documents should stay visible enough for the client to understand what went wrong. The portal should not expose internal-only staff phrasing beyond the reason label and note.

Replacing a rejected document should supersede the old document, retire its active rejected-document follow-up draft, and start the new upload in pending-review state.

## WhatsApp Automation Behavior

`/whatsapp/automation` should include rejected-document follow-up drafts alongside existing annual-return follow-ups.

Each rejected-document draft should show:

- Company.
- Recipient.
- Document title.
- Reason label.
- Optional staff note.
- Message preview.
- Status.
- Mock "Send now" action when eligible.

The message preview should be deterministic and based on the review metadata. For example:

`Hi Joanna, we reviewed Signed NAR1 for Delta Bloom Ventures Limited and need a replacement because the required signature is missing. Please upload a corrected file in the portal.`

When the optional note exists, include a concise version after the reason. Do not generate separate drafts for accepted documents in this phase.

## Send Now Behavior

Sending a rejected-document follow-up should:

- Confirm the linked document is still current and rejected.
- Confirm the case is not filed or receipt-accepted.
- Confirm the same rejected document has not already been sent.
- Mark the draft as sent in local state.
- Append a portal activity item.
- Append an annual-return timeline event.
- Re-render `/whatsapp/automation` with sent status.

If the user tries to send the same draft again, the mutation should return `{ ok: false, reason: "Follow-up already sent" }`. The UI should avoid creating duplicate activity or timeline entries.

## Error Handling And Guardrails

- Only pending client-uploaded documents can be reviewed.
- Reject requires a valid reason code.
- The `other` reason should require a non-empty note.
- Review attempts against generated, superseded, already-reviewed, missing, or read-only documents should return explicit failures.
- Rejected-document follow-up drafts are idempotent: one active draft per current rejected document.
- Replacing a rejected document retires the old active draft because the rejected document is no longer current.
- Filed or receipt-accepted cases should block follow-up sending.
- Unknown portal case ids and invalid draft ids should return clear failures without mutating state.

## Testing

Add store tests for:

- Rejection stores reason code, reason label, optional note, reviewer, and timestamp.
- Rejection without a reason fails.
- `other` rejection without a note fails.
- Accepted documents show accepted review metadata and do not derive WhatsApp follow-up drafts.
- Rejected current documents derive one WhatsApp follow-up draft.
- Sending a rejected-document follow-up appends portal activity and annual-return timeline history.
- Sending the same rejected-document follow-up twice does not duplicate activity or timeline history.
- Replacing the rejected document retires the old draft from the active queue.
- Filed or receipt-accepted cases block rejected-document follow-up sending.

Add route tests for:

- `/documents` renders rejection reason controls and stores review metadata.
- `/portal` renders rejected document reason, note, and replacement action.
- `/portal` renders accepted document review metadata.
- `/whatsapp/automation` renders rejected-document drafts and send-now state.

Manual verification should cover:

- Reject each seeded required document reason and confirm portal copy is understandable.
- Send a rejected-document follow-up from `/whatsapp/automation` and confirm the case timeline updates.
- Replace a rejected document and confirm the old follow-up no longer appears as active.
- Accept a pending document and confirm no WhatsApp follow-up is created.

Automated verification should run the relevant store tests, route tests, full Vitest suite, lint, and build.

## Acceptance Criteria

- Staff can reject pending client uploads with a structured reason and optional note.
- Staff cannot reject without a reason, and `other` requires a note.
- Staff can accept pending client uploads without adding rejection metadata.
- `/documents` shows review decision, reason, note, reviewer, and timestamp.
- `/portal` explains rejected documents and lets clients replace them.
- `/portal` shows accepted document review metadata.
- `/whatsapp/automation` shows mock rejected-document follow-up drafts.
- Mock "Send now" marks a rejected-document draft sent and appends audit history.
- Duplicate sends do not create duplicate activity or timeline entries.
- Replacing a rejected document retires the old active follow-up draft.
- The implementation stays local-state only and does not add real delivery or persistence.

## Implementation Boundaries

Expected file changes:

- `src/lib/client-portal-store.ts`
- `src/lib/client-portal-store.test.ts`
- `src/routes/documents.tsx`
- `src/routes/portal.tsx`
- `src/routes/whatsapp.automation.tsx`
- `src/routes/-annual-returns-workflow.test.ts`
- Optional targeted updates to route helper tests if existing fixtures need clearer rejected-document setup.

Avoid creating a new top-level store unless the existing portal store becomes unclear during implementation. Do not add server routes, external APIs, database persistence, real notification delivery, or broad UI redesigns.
