# Payment Proof Reconciliation And AI Follow-Up Design

## Summary

This phase turns the existing read-only payment listing into a complete mocked payment-proof reconciliation workflow. Clients and staff can add payment proof, staff can accept or reject the current proof, and an accepted proof updates payment status, filing-packet readiness, portal activity, and case history in one operation.

Rejected proof keeps a structured reason and optional client-visible note. It also creates an action-aware AI WhatsApp follow-up draft that staff can review and send through the existing mock "Send now" flow.

The implementation remains local-state only. There is no real payment processor, bank reconciliation, file upload backend, storage service, WhatsApp delivery, database persistence, OCR, or accounting integration.

## Goals

- Let clients upload payment proof from the client portal.
- Let staff attach payment proof from the Payments workspace.
- Give staff a focused queue for reviewing current payment proof.
- Accept proof atomically across payment status, packet readiness, portal activity, and annual-return history.
- Reject proof with a structured reason and optional client-visible note.
- Show proof outcomes and history in both staff and client surfaces.
- Create one deduplicated AI WhatsApp follow-up draft for each current rejected proof.
- Support the existing mock "Send now" action and sent-history behavior.
- Give the AI assistant payment and proof-review context without allowing it to mutate case state.

## Non-Goals

- No real card, FPS, bank-transfer, or payment-gateway integration.
- No automated matching against bank statements, invoices, amounts, or transaction references.
- No real file upload, object storage, preview service, OCR, virus scanning, or image processing.
- No real WhatsApp API call or outbound message delivery.
- No backend persistence, server route, database migration, or authentication change.
- No refunds, partial payments, installment plans, invoices, receipts, or accounting ledger.
- No generic evidence-review framework or broad refactor of document review.
- No redesign of the full annual-return workflow, client portal, or AI assistant.

## Recommended Direction

Use an integrated vertical slice through the existing annual-return and client-portal stores.

The annual-return store remains authoritative for payment status, packet requirements, filing readiness, filed-case locks, and annual-return timeline history. The client-portal store owns mocked payment-proof artifacts, proof-review metadata, portal activity, and rejected-proof follow-up state. Store mutations coordinate through explicit interfaces so every route reads the same outcome.

Alternative approaches considered:

- **Separate finance-review module:** provides a clean accounting boundary, but introduces synchronization between finance and annual-return state before the product has a real finance backend.
- **Generic evidence-review engine:** could unify document and payment-proof review, but adds abstraction and migration work beyond this phase.

The integrated approach matches the current application, completes the operational loop, and keeps future replacement by a backend service straightforward.

## Architecture

`src/lib/annual-return-store.ts` remains the source of truth for:

- Payment status.
- The `payment-proof-checked` packet requirement.
- Filing readiness and blockers.
- Filed and receipt-accepted read-only rules.
- Annual-return timeline events.

`src/lib/client-portal-store.ts` becomes the source of truth for:

- Payment-proof artifacts and versions.
- Proof origin, review state, reason, note, reviewer, and timestamps.
- Portal activity related to proof upload and review.
- Rejected-proof WhatsApp drafts and mocked send history.

The client-portal store should expose focused proof mutations rather than letting routes update records directly:

- `uploadPaymentProof(caseId, input, actor)` for a client upload.
- `attachPaymentProof(caseId, input, actor)` for a staff-recorded proof.
- `acceptPaymentProof(proofId, actor)` for the atomic accepted outcome.
- `rejectPaymentProof(proofId, review, actor)` for the rejected outcome.
- `sendPaymentProofFollowUpNow(draftId, actor)` for a mocked send.

Acceptance delegates its annual-return changes to one annual-return-store mutation that marks payment paid and completes `payment-proof-checked` together. The client-portal mutation records the proof outcome only after that annual-return mutation succeeds, then emits portal updates after both stores are consistent.

The exact function names may follow established local naming, but the ownership and behavior must remain explicit. Route components should consume store helpers and mutations instead of reproducing review, deduplication, readiness, or filed-case rules.

## Data Model

Add a payment-proof record with these fields:

- Stable proof id and annual-return case id.
- Display filename and mocked file metadata.
- Origin: `client-portal` or `staff-payments`.
- Uploaded by and uploaded at.
- Status: `pending-review`, `accepted`, `rejected`, or `superseded`.
- Review reason code and label when rejected.
- Optional client-visible review note.
- Review summary, reviewer, and reviewed at.
- Version relationship or sequence sufficient to identify the current proof.

Suggested rejection reason codes:

- `unreadable`: Proof is unclear, cropped, or incomplete.
- `amount-mismatch`: Paid amount does not match the expected amount.
- `payer-mismatch`: Payer or company details do not match the case.
- `missing-reference`: Transaction date, reference, or payment identifier is missing.
- `wrong-case`: Proof belongs to another company or filing.
- `duplicate-proof`: Proof repeats a previously reviewed transaction.
- `other`: Another issue explained in the note.

Rejecting with `other` requires a non-empty note. Other rejection reasons allow an optional note. The reason label and note are visible to the client, so the UI must identify the note as client-visible rather than an internal comment.

A rejected-proof follow-up draft includes:

- Stable id derived from case id and current rejected proof id.
- Case, company, contact, and recipient metadata.
- Proof id, reason label, and optional note.
- Deterministic AI-assisted message preview.
- Status: `draft`, `sent`, or `blocked`.
- Sent actor and timestamp when mocked as sent.
- Blocked reason when the proof is no longer current, the case is read-only, or the draft was already sent.

Sent history is keyed by proof id so the same rejected proof cannot be sent twice. A replacement proof receives a new id and may generate a new draft only if that replacement is later rejected.

## Proof Lifecycle

Both client and staff upload paths create a `pending-review` proof. An upload is allowed when no proof exists or when the current proof is rejected. A replacement supersedes that rejected proof while preserving all earlier artifacts, review metadata, portal activity, timeline events, and sent-message history. Pending and accepted current proofs block additional uploads.

The current proof can move through one review outcome:

- `pending-review` to `accepted`.
- `pending-review` to `rejected`.

Accepted and rejected proofs are immutable. A correction is represented by a replacement proof, not by resetting the existing record. Review mutations target a specific proof id and fail if that proof is no longer current, preventing an older screen from reviewing a replacement upload.

## Acceptance Behavior

Accepting the current proof performs one coordinated local-state operation:

- Mark the proof accepted with reviewer and timestamp.
- Set the annual-return payment status to `paid`.
- Complete the `payment-proof-checked` packet requirement.
- Recalculate filing readiness and payment-related blockers.
- Add one client-portal activity item.
- Add one annual-return timeline event.
- Retire any active rejected-proof draft for an earlier proof.
- Emit store updates after the coordinated state is consistent.

Repeated acceptance of the same accepted proof returns a successful no-op and does not duplicate activity or timeline history. Acceptance fails without mutation when the case is filed or receipt-accepted, the proof is missing, the proof is no longer current, or the current proof has already been rejected.

This phase does not automatically mark the case filed, approve the full packet, or complete unrelated packet requirements.

## Rejection Behavior

Rejecting the current proof:

- Requires a valid reason code.
- Requires a note when the reason is `other`.
- Stores the reason label, optional client-visible note, reviewer, and timestamp.
- Keeps payment status unchanged.
- Keeps `payment-proof-checked` incomplete.
- Adds portal activity and an annual-return timeline event.
- Reopens the client payment-proof replacement action.
- Derives one active WhatsApp follow-up draft for that rejected proof.

The rejected proof remains visible in staff history and the client portal. Its replacement action clearly explains the rejection reason and note. Uploading a replacement supersedes the rejected proof and removes its draft from the active queue without deleting the prior proof or any sent record.

## Payments Workspace

`/payments` becomes the staff reconciliation workspace while retaining its dense operational layout. Each annual-return payment row should show:

- Company, owner, due date, payment status, and readiness score.
- Current proof status, origin, uploader, and upload time.
- Proof metadata with mocked preview or download affordance consistent with existing document behavior.
- Accept and Reject controls for a current pending proof.
- Rejection reason, note, reviewer, review time, and follow-up status for reviewed proof.
- A compact staff "Attach proof" action when no current pending proof exists.

Reject opens a compact review control with a reason selector and optional client-visible note. Filed and receipt-accepted cases render read-only. The route surfaces structured mutation failures inline and does not implement business rules itself.

## Client Portal Behavior

The client portal adds a payment-proof action to the existing case workflow:

- No proof exists: show an upload action.
- Current proof is pending review: show that staff are reviewing it and prevent duplicate upload.
- Current proof is accepted: show accepted status, reviewer, review time, and proof in portal activity or archive.
- Current proof is rejected: show the reason and note, then offer a replacement action.
- Case is filed or receipt-accepted: keep proof history visible but read-only.

The mocked upload captures a display filename and metadata using the same local-state conventions as client documents. It must not imply that a real file was transferred or stored.

## WhatsApp And AI Behavior

`/whatsapp/automation` includes rejected-payment-proof drafts alongside annual-return and document-review follow-ups. Each draft shows the company, recipient, rejection reason, optional note, message preview, status, and mock "Send now" action when eligible.

Message copy is action-aware, mocked, and deterministic. It should explain why the proof was rejected and ask the client to upload a replacement. For example:

`Hi Joanna, we reviewed the payment proof for Delta Bloom Ventures Limited and need a replacement because the transaction reference is missing. Please upload clearer proof in the portal.`

The existing AI assistant receives current payment status, proof-review outcome, and payment blocker context when drafting replies. It may suggest or insert a response, but it cannot accept proof, reject proof, mark payment paid, complete packet requirements, or send a message automatically.

Mock "Send now" must:

- Confirm the linked proof is still current and rejected.
- Confirm the case is not filed or receipt-accepted.
- Confirm that proof has not already been sent.
- Mark the draft sent in local state.
- Add one portal activity item and one annual-return timeline event.
- Remove the draft from the active queue while retaining sent history.

Duplicate sends return an explicit failure and do not duplicate activity or timeline entries.

## Error Handling And Guardrails

- Only the current `pending-review` proof can be accepted or rejected.
- Review actions must target a specific proof id.
- Filed and receipt-accepted cases are read-only.
- Reject requires a valid reason; `other` also requires a non-empty note.
- Unknown case ids, proof ids, and draft ids return structured failures without mutation.
- A client cannot add a second proof while the current proof is pending review.
- Client and staff upload paths both reject an additional proof when the current proof is accepted.
- A replacement proof supersedes the current rejected proof but never erases history.
- One rejected proof derives at most one active follow-up draft.
- One rejected proof can be mocked as sent at most once.
- Acceptance updates payment and packet readiness in a coordinated mutation before subscribers render.
- AI output remains a draft and never performs a business-state mutation.

## Testing

Add store tests for:

- Client upload and staff attachment create current pending-review proof with correct origin metadata.
- A second upload is blocked while the current proof is pending review.
- Acceptance marks the proof accepted, payment paid, and `payment-proof-checked` complete.
- Acceptance appends one portal activity item and one annual-return timeline event.
- Repeated acceptance is an idempotent no-op.
- Rejection stores reason, label, optional note, reviewer, and timestamp.
- Rejection without a reason fails; `other` without a note fails.
- Rejection leaves payment unpaid and packet proof unchecked.
- A rejected current proof derives exactly one active WhatsApp draft.
- Mock send appends audit history and moves the draft out of the active queue.
- Duplicate mock send does not duplicate activity or timeline history.
- Replacement supersedes the rejected proof, retires its active draft, and preserves history.
- Stale proof ids and filed or receipt-accepted cases reject mutations without changing state.

Add route tests for:

- `/payments` renders proof status, staff attachment, and review controls.
- `/payments` renders accepted and rejected review metadata.
- `/portal` renders upload, pending-review, accepted, rejected, and replacement states.
- `/whatsapp/automation` renders rejected-proof drafts and mock-send state.
- The AI assistant renders current payment-proof context without exposing state-changing actions.

Manual verification should cover the complete path:

1. Upload payment proof in the client portal.
2. Reject it in Payments with a structured reason and note.
3. Confirm the portal explains the rejection.
4. Confirm one WhatsApp draft appears and mock-send it.
5. Upload a replacement proof.
6. Accept the replacement in Payments.
7. Confirm payment is paid, `payment-proof-checked` is complete, the packet readiness updates, and history is preserved.

Automated verification should run targeted store and route tests, the full Vitest suite, lint, and build.

## Acceptance Criteria

- Clients and staff can create mocked payment-proof records from their respective surfaces.
- Staff can accept or reject only the current pending proof.
- Accepted proof marks payment paid and completes `payment-proof-checked` atomically.
- Accepted proof is visible in staff review history and client portal activity or archive.
- Rejected proof stores a structured reason and optional client-visible note.
- Rejected proof reopens the client replacement action.
- Each current rejected proof creates one deduplicated AI WhatsApp draft.
- Mock "Send now" records one sent outcome and one set of audit events.
- Replacement proof preserves previous proof, review, and message history.
- Filed and receipt-accepted cases remain read-only.
- The AI assistant uses payment-proof context but cannot mutate payment or review state.
- The implementation remains local-state only and performs no real payment, upload, AI, or messaging operation.

## Implementation Boundaries

Expected file changes:

- `src/lib/annual-return-store.ts`
- `src/lib/annual-return-store.test.ts`
- `src/lib/client-portal-store.ts`
- `src/lib/client-portal-store.test.ts`
- `src/lib/ai-agent.ts`
- `src/routes/payments.tsx`
- `src/routes/portal.tsx`
- `src/routes/whatsapp.automation.tsx`
- `src/components/ai-assistant-panel.tsx`
- `src/routes/-annual-returns-workflow.test.ts`

Optional targeted changes are allowed where existing route helpers or fixtures need payment-proof setup. Avoid a new top-level finance store, generic review engine, server route, external API, database, real file handling, or broad visual redesign.
