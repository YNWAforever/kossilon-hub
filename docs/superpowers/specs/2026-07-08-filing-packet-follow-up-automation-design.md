# Filing Packet Builder And WhatsApp Follow-Up Automation Design

## Summary

This phase extends the annual return command center into an end-to-end mocked filing workflow. Staff should be able to open an annual return case, assemble a filing packet, generate blocker-driven WhatsApp follow-ups, mock-send those follow-ups, submit the packet, and record the filing receipt.

The implementation remains local-state only. There are no real WhatsApp sends, Companies Registry submissions, document uploads, or backend integrations. The goal is to make the internal operator workflow feel coherent and production-real while keeping the state model easy to test.

## Goals

- Add a filing packet workflow to annual return cases.
- Show packet readiness and packet status in the command center and case detail.
- Generate follow-up drafts from unresolved case and packet blockers.
- Include a mock **Send now** action that marks a draft sent and appends a case timeline event.
- Allow staff to submit a complete packet and record a mock receipt.
- Reuse the annual return store as the source of truth so tasks, payments, WhatsApp automation, and case timelines stay connected.

## Non-Goals

- No real Companies Registry submission.
- No real WhatsApp API call.
- No real file upload or generated PDF packet.
- No new auth, permissions, billing, or backend persistence.
- No broad redesign of unrelated sections.
- No separate client portal in this phase.

## Recommended Direction

Use a **packet-centered workflow**.

The annual return case remains the main operator surface. Filing packet state and follow-up drafts live with or are derived from the annual return case. This keeps the operator mental model simple: open a case, build the packet, resolve blockers, send reminders, submit, and record the receipt.

Alternative approaches considered:

- **Automation-centered workflow:** Make `/whatsapp/automation` the main surface and treat packet state as input to messaging campaigns. This is strong for messaging operations but makes filing feel secondary.
- **Separate packet module:** Create a standalone packet store and route. This separates concerns, but adds duplicated state and extra plumbing for a mocked phase.

The packet-centered approach best fits the current command center because it continues from the existing ready-to-file state and gives staff a clear next action.

## Architecture

Extend `src/lib/annual-return-store.ts` rather than introducing a new top-level store.

The annual return domain should own:

- Filing packet requirements.
- Packet status.
- Submission metadata.
- Receipt metadata.
- Derived packet readiness.
- Derived follow-up drafts.
- Mock send, submit, and receipt mutations.

The store should continue exposing pure helper functions for derived state and small mutations for state transitions. UI routes should consume these helpers instead of duplicating packet logic.

Expected additions include:

- `AnnualReturnPacketRequirement`
- `AnnualReturnPacketStatus`
- `AnnualReturnFollowUpDraft`
- `AnnualReturnSubmission`
- `AnnualReturnReceipt`
- `getPacketReadiness(caseItem)`
- `getPacketStatus(caseItem)`
- `getPacketBlockers(caseItem)`
- `getFollowUpDrafts(caseItem)`
- `canSendFollowUp(caseItem, draft)`
- `togglePacketRequirement(caseId, requirementId)`
- `sendFollowUpNow(caseId, draftId)`
- `submitFilingPacket(caseId)`
- `acceptFilingReceipt(caseId)`

The exact function names can shift during implementation if local naming patterns suggest something cleaner, but the boundaries should stay the same.

## Case Data Model

Each annual return case should gain a filing packet shape:

- Requirements:
  - NAR1 draft prepared.
  - Company particulars checked.
  - Significant controller register confirmed.
  - Signed NAR1 attached.
  - Payment proof checked.
  - Internal filing review approved.
- Status:
  - `not-started`
  - `building`
  - `ready-for-review`
  - `approved`
  - `submitted`
  - `accepted`
- Submission:
  - Submitted timestamp.
  - Mock filing reference.
  - Submitted by staff member.
- Receipt:
  - Accepted timestamp.
  - Mock receipt number.
  - Accepted by staff member.

Packet readiness should be derived from requirements. A packet is complete when all required packet requirements are complete and the underlying case is ready to file.

Filed cases are terminal. Packet and follow-up controls should render read-only once a case is filed or accepted.

## Follow-Up Drafts

Follow-up drafts should be derived from current blockers rather than stored as independent campaign data.

Draft types:

- Missing document request.
- Payment reminder.
- Signature nudge.
- Internal review escalation.
- Packet requirement reminder.

Each draft should include:

- Stable id.
- Case id.
- Type.
- Recipient name and phone.
- Suggested timing label.
- Message preview.
- Status: `draft`, `sent`, or `blocked`.
- Reason when blocked.

Mock sending a draft should:

- Confirm the draft is still eligible.
- Append a timeline event to the case.
- Record the draft id as sent so it does not show as sendable again.
- Keep the message visible as sent in `/annual-returns/$id` and `/whatsapp/automation`.

No network request should be made.

## Workflow

### Build Packet

Staff mark packet requirements complete or reopen them. Each change updates packet readiness and appends a timeline event.

Examples:

- Marking "NAR1 draft prepared" complete moves the packet from `not-started` to `building`.
- Completing every packet requirement while the case is ready to file makes the packet `approved`.
- Reopening a requirement after approval moves the packet back to `building`.

### Generate Follow-Ups

The system derives follow-up drafts from unresolved case blockers and packet blockers.

Examples:

- Missing signed NAR1 creates a signature or document follow-up.
- Payment pending creates a payment reminder.
- Internal review not approved creates an internal escalation.
- Packet requirement incomplete creates a packet reminder.

### Send Now

Staff can click **Send now** on an eligible draft.

The action should not send a real WhatsApp message. It should mark the draft as sent and append a timeline event such as:

`WhatsApp reminder sent: Signature nudge`

The timeline detail should include the recipient and a short message preview.

### Submit Filing Packet

Staff can submit only when:

- The annual return case is ready to file.
- All packet requirements are complete.
- The packet has not already been submitted.
- The case is not filed.

Submitting sets packet status to `submitted`, records a mock reference, and appends a timeline event.

### Record Receipt

Receipt acceptance is only allowed after submission.

Accepting the receipt sets packet status to `accepted`, records a mock receipt number, appends a timeline event, and completes the existing annual return filing flow so the case becomes `filed`.

## UI Design

### `/annual-returns`

The command center remains a dense triage queue.

Add:

- Packet status column or compact badge.
- Packet readiness percentage.
- Filter for packet-ready cases.
- Filter for cases needing follow-up.
- Follow-up count in each row.

Keep existing urgency, owner, readiness, blockers, payment, next action, and open-case behavior.

### `/annual-returns/$id`

Add two focused panels to the case detail page.

**Filing Packet**

- Packet status badge.
- Packet readiness meter.
- Requirement rows with complete/reopen controls.
- Submission reference when submitted.
- Receipt number when accepted.
- Submit packet action with inline warning when blocked.
- Accept receipt action once submitted.

**Follow-Ups**

- Draft rows grouped by type or urgency.
- Recipient and phone.
- Suggested timing.
- Message preview.
- Status badge.
- **Send now** action for eligible drafts.
- Disabled state and reason when a draft cannot be sent.

The existing timeline becomes the audit trail for packet edits, sends, submissions, and receipts.

### `/whatsapp/automation`

Upgrade this route into a cross-case mocked automation queue.

It should show follow-up drafts derived from annual return cases, including:

- Company.
- Recipient.
- Draft type.
- Suggested timing.
- Message preview.
- Status.
- Send now action.

Sending from this route should call the same store mutation and append to the linked case timeline.

## Error Handling And Guardrails

- Do not allow packet submission while requirements are incomplete.
- Submission warnings should list missing requirements in plain staff-facing language.
- Do not allow receipt acceptance before submission.
- Do not allow follow-up sends when the case is filed.
- Do not allow follow-up sends when the draft has already been sent.
- Do not allow follow-up sends when the original blocker has been resolved.
- Unknown case ids should keep the existing case-not-found state.
- Filed cases should stay read-only except for viewing packet history, sent reminders, and timeline.

## Testing And Verification

Pure helper tests should cover:

- Packet readiness calculation.
- Packet status derivation.
- Packet blocker generation.
- Follow-up draft generation.
- Follow-up send eligibility.
- Submission guardrails.
- Receipt acceptance completing the filed state.
- Filed cases blocking packet and follow-up mutations.

Manual verification should cover:

- Packet status appears on `/annual-returns`.
- Packet-ready filter shows only cases that can be submitted.
- Needs-follow-up filter shows cases with unsent eligible drafts.
- Completing packet requirements updates packet readiness.
- Submitting an incomplete packet shows a warning with missing requirements.
- Submitting a complete packet records a mock reference.
- Accepting a receipt records a mock receipt number and marks the case filed.
- Sending a follow-up from case detail marks it sent and appends a timeline event.
- Sending a follow-up from `/whatsapp/automation` updates the same case timeline.
- Resolving a blocker disables or removes the related follow-up draft.

Automated verification should run:

- Annual return store tests.
- TypeScript/static checks.
- Lint/build if the local toolchain is available.

## Implementation Boundaries

The primary implementation boundary is still `src/lib/annual-return-store.ts`. Packet and follow-up logic should be pure and testable there.

Expected file changes:

- `src/lib/annual-return-store.ts`
- `src/lib/annual-return-store.test.ts`
- `src/routes/annual-returns.tsx`
- `src/routes/annual-returns.$id.tsx`
- `src/routes/whatsapp.automation.tsx`
- Optional small updates to `src/lib/ai-agent.ts` or `src/components/ai-assistant-panel.tsx` only if the new packet state improves the existing AI context without broadening scope.

Avoid creating a separate packet store, adding real API integrations, or redesigning unrelated routes.
