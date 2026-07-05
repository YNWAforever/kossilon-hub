# WhatsApp Inbound Matching Design

Date: 2026-07-05
Status: Approved for implementation planning
Project: Kossilon CoSec OS

## Goal

Turn inbound WOZTELL WhatsApp replies into operational Kossilon records by linking received messages to the best-known company and active annual-return case, then writing the reply into the case timeline.

This phase closes the loop opened by the WhatsApp foundation and annual-return outbound queue work: staff can queue a reminder from the annual-return workspace, and when the client replies, the reply becomes visible in the compliance record instead of remaining only as a raw WhatsApp message.

## Context

The app already has:

- WOZTELL payload normalization.
- `whatsapp_contacts`, `whatsapp_messages`, `whatsapp_templates`, and `whatsapp_webhook_events`.
- `processWhatsAppInboundWebhook`, which normalizes inbound payloads, records an inbound message, and records webhook processing status.
- Outbound annual-return reminder queueing, which upserts a WhatsApp contact, links it to a company, queues an outbound message with `company_id` and `case_id`, and writes `whatsapp_message_queued` to `timeline_events`.

The missing behavior is that inbound messages are currently stored without company/case linkage and without an annual-return timeline event.

## Scope

This phase includes:

- Matching inbound WhatsApp replies to a contact, company, and annual-return case using existing database records.
- Updating stored inbound `whatsapp_messages` with matched `company_id` and `case_id`.
- Creating one case timeline event for each newly stored matched inbound message.
- Returning matching metadata from `processWhatsAppInboundWebhook`.
- Keeping unmatched inbound messages stored and auditable.
- Preserving provider-message deduplication so duplicate webhooks do not duplicate timeline events.

This phase excludes:

- Live WOZTELL send API calls.
- Webhook signature verification implementation beyond the existing `signatureValid` input.
- Client upload links or file storage.
- AI intent classification.
- Payment-proof parsing from WhatsApp attachments.
- UI inbox redesign.

## Approaches Considered

### Recommended: Repository-Level Matching

`recordInboundMessage` owns matching, message persistence, and timeline side effects in one transaction.

Pros:

- Keeps deduplication and timeline creation atomic.
- Works for both server functions and future webhook routes.
- Keeps matching close to WhatsApp persistence, where contact/message records already live.

Cons:

- The WhatsApp repository becomes aware of annual-return cases and timeline events.

This is acceptable because the existing outbound queue method already links WhatsApp messages to annual-return cases and writes timeline events.

### Alternative: Server Function Orchestration

The server function could record a raw inbound message, call a separate matcher, then write timeline events.

Pros:

- Keeps the repository closer to a generic message store.

Cons:

- Easier to create partial writes.
- Deduplication logic must be coordinated across multiple calls.
- Future webhook entry points would need to repeat orchestration.

### Alternative: New Matching Tables

Add explicit inbound assignment or conversation tables.

Pros:

- More flexible for future multi-thread inbox and human assignment.

Cons:

- Larger schema surface before the product needs it.
- Not necessary for the current annual-return reply loop.

## Matching Rules

Inbound matching should be deterministic and conservative.

1. Upsert or reuse `whatsapp_contacts` by provider plus WhatsApp ID or normalized phone number.
2. Resolve the company from the contact when `whatsapp_contacts.company_id` is already present.
3. If the contact has no company, resolve company from the most recent outbound WhatsApp message for the same contact that has a `company_id`.
4. Resolve the annual-return case from the most recent outbound WhatsApp message for the same contact that has a non-completed `case_id`.
5. If the recent outbound message does not provide an active case, fall back to the nearest active annual-return case for the resolved company by filing due date.
6. If a company is resolved from prior outbound context, update `whatsapp_contacts.company_id` so future replies match directly.
7. If no company or case can be resolved, store the inbound message with `company_id = null` and `case_id = null`, and do not create a timeline event.

An active annual-return case means `current_status` is not `Filed` and not `Completed`.

## Data Flow

1. WOZTELL webhook payload enters `processWhatsAppInboundWebhook`.
2. Server function validates the payload shape.
3. `normalizeWoztellInboundMessage` extracts provider message ID, sender identity, body, timestamp, and raw payload.
4. `recordInboundMessage` runs in a transaction:
   - upserts contact,
   - checks whether the provider message ID already exists,
   - resolves company and annual-return case,
   - inserts the inbound message,
   - writes a timeline event when the inserted message is matched to a case.
5. `recordWebhookEvent` stores the raw webhook payload and references the normalized message.
6. Server function returns message ID, event ID, processing status, and matching metadata.

## Timeline Event

Matched inbound replies should create:

- `event_type`: `whatsapp_message_received`
- `actor_type`: `system`
- `actor_id`: `null`
- `description`: `Received WhatsApp reply from <contact display name or phone>.`
- `metadata`:
  - `source`: `woztell`
  - `messageId`
  - `providerMessageId`
  - `contactId`
  - `phoneE164`
  - `whatsAppId`
  - `bodyPreview`

`bodyPreview` should be a short text preview, not a separate source of truth. The complete message body stays in `whatsapp_messages.body`.

## Deduplication

WOZTELL may retry webhooks. If an inbound provider message ID already exists:

- Return the existing message record.
- Do not insert another `whatsapp_messages` row.
- Do not create another timeline event.
- `recordWebhookEvent` may still upsert or update its event row according to existing provider event ID behavior.

## Error Handling

- Invalid normalization still records a failed webhook event and returns `ok: false`.
- Invalid signatures still store the normalized message for audit, mark the webhook event as failed, and return `ok: false`.
- Matching failure is not a processing failure. The message remains stored with no case link and the response reports unmatched metadata.
- Database writes for a newly matched message and its timeline event must be transactional.

## Testing Strategy

Unit and integration coverage should prove:

- The server function schema returns matching metadata fields.
- A reply from a contact created by an outbound annual-return reminder links to the same company and case.
- A matched inbound reply writes exactly one `whatsapp_message_received` timeline event.
- A duplicate provider message returns the existing message and does not duplicate timeline events.
- An unmatched inbound reply is stored without company/case linkage and without timeline events.
- Existing outbound queue behavior still writes `whatsapp_message_queued`.

DB-backed tests should continue to run in separate files when using Neon fixtures to avoid cross-file fixture overlap from Vitest file parallelism.

## Acceptance Criteria

- `processWhatsAppInboundWebhook` returns `matchedCompanyId`, `matchedCaseId`, and `timelineEventCreated`.
- Inbound replies after outbound annual-return reminders appear in `timeline_events` for that annual-return case.
- Duplicate inbound webhook delivery remains idempotent.
- No schema migration is required for this phase.
- Existing non-DB tests, typecheck, focused lint, build, and DB repository tests pass when the required database URL is exported.
