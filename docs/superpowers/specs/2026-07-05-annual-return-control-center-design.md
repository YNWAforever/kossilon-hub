# Annual Return Control Center Design

Date: 2026-07-05
Status: Approved for spec review
Project: Kossilon CoSec OS

## Goal

Build the first durable backend slice of Kossilon CoSec OS around the Annual Return Control Center. Phase 1 turns the existing in-memory prototype into a deadline-first compliance workflow backed by Neon/Postgres, while leaving full WOZTELL messaging, client upload links, and broader CRM persistence for later phases.

The product principle is simple: WhatsApp is the communication layer; Kossilon CoSec OS owns the compliance record, checklist state, payment state, staff accountability, and audit trail.

## Context

The current app is a TanStack Start application with polished routes for dashboard, enquiries, clients, annual returns, documents, payments, teams, settings, FAQ/AI, and WhatsApp automation. The annual-return experience currently uses mock data and client-side stores. `DATABASE_URL` is configured in Vercel, but there is no database layer in the app yet.

The attached product brief positions the app as a Kossilon Company Secretary Operating System, not just a CRM. It emphasizes Hong Kong annual return deadlines, NAR1 workflow, document chasing, payment reminders, staff assignment, and timeline records. For Phase 1, the approved approach is the Compliance Core: a durable, deadline-first annual-return workflow.

## Compliance Assumptions

Phase 1 targets Hong Kong local private companies. The Companies Registry states that a local private company with share capital should deliver its annual return within 42 days after the anniversary of incorporation, and its annual return filing calculator applies the same 42-day rule for local private companies. Late delivery of a local private company annual return carries higher registration fees from HK$870 to HK$3,480.

References:

- Companies Registry annual return filing calculator: https://www.cr.gov.hk/en/compliance/annual-return/calculator.htm
- Companies Registry local private company annual return guidance: https://www.cr.gov.hk/en/compliance/annual-return/private-company.htm
- Companies Registry specified forms fee details: https://www.cr.gov.hk/en/forms/specified-forms/details.htm

## Scope

Phase 1 includes:

- Auto-generate annual return cases from company statutory dates.
- Create each yearly case 90 days before filing deadline as `Upcoming`.
- Increase urgency at 60, 30, 14, 7, and overdue thresholds.
- Support the full approved status lifecycle:
  `Upcoming -> Client reminder sent -> Documents pending -> Documents received -> Payment pending -> Payment received -> NAR1 prepared -> Signature pending -> Ready to file -> Filed -> Completed`.
- Make the deadline-first list the default `/annual-returns` view.
- Keep the status board as a secondary view.
- Persist checklist, payment status, notes, filing reference, confirmation upload metadata, reminder logs, and timeline events in Neon.
- Let staff manually record reminders sent and generate/copy WhatsApp reminder drafts.
- Enforce strict completion rules before a case can become `Completed`.

Phase 1 excludes:

- Real WOZTELL outbound messaging.
- WOZTELL inbound webhooks and message matching.
- Client-facing upload links.
- Full multi-tenant packaging.
- Broad persistence migration for every mock-data route.
- AI automation beyond simple draft copy helpers.

## Architecture

Keep the existing TanStack Start app and add a server-side data layer around Neon/Postgres.

Core backend units:

- `db` client: reads `DATABASE_URL` and owns the Postgres connection.
- Annual-return repository: reads and writes companies, cases, checklist items, payments, documents, notes, reminder logs, and timeline events.
- Case generation service: finds active companies whose annual return case should exist and creates missing yearly cases.
- Status transition service: validates allowed transitions and blocks invalid completion.
- Risk service: adapts the existing risk behavior to real case, checklist, payment, and deadline data.
- Timeline service: records audit events for case creation, reminders, status changes, checklist updates, document updates, payment updates, filing, completion, and admin corrections.

Frontend changes:

- `/annual-returns` becomes deadline-list first, with a view toggle for status board.
- `/annual-returns/$id` becomes a real case workspace with checklist, payment, filing, reminders, notes, and timeline.
- Dashboard annual-return counts can read from the real repository once the backend slice exists.

This keeps implementation bounded: annual returns become durable first while other prototype areas can keep mock data until their own phase.

## Data Model

Neon/Postgres is the source of truth for annual-return operations.

### `companies`

Stores company records needed for annual-return generation and assignment.

Key fields:

- `id`
- `company_name`
- `cr_number`
- `br_number`
- `incorporation_date`
- `annual_return_basis_date`
- `registered_office`
- `company_secretary`
- `status`
- `assigned_owner_id`
- `assigned_team_id`
- `created_at`
- `updated_at`

### `annual_return_cases`

Stores one operational annual-return case per company and return year.

Key fields:

- `id`
- `company_id`
- `return_year`
- `made_up_date`
- `filing_due_date`
- `current_status`
- `risk_level`
- `owner_id`
- `reviewer_id`
- `reminders_sent`
- `filing_reference`
- `confirmation_document_id`
- `locked_at`
- `completed_at`
- `created_at`
- `updated_at`

Constraints:

- Unique `(company_id, return_year)`.
- `Completed` requires proof fields and complete dependent records.

### `annual_return_checklist_items`

Stores required and optional evidence items for a case.

Key fields:

- `id`
- `case_id`
- `item_label`
- `required`
- `status`
- `due_date`
- `received_at`
- `verified_at`
- `document_id`
- `created_at`
- `updated_at`

### `payments`

Stores payment state associated with a case.

Key fields:

- `id`
- `company_id`
- `case_id`
- `invoice_number`
- `amount`
- `currency`
- `status`
- `due_date`
- `paid_at`
- `payment_proof_document_id`
- `created_at`
- `updated_at`

### `documents`

Stores document metadata, not file blobs.

Key fields:

- `id`
- `company_id`
- `case_id`
- `file_type`
- `file_name`
- `storage_url`
- `upload_source`
- `verification_status`
- `uploaded_by`
- `uploaded_at`
- `verified_by`
- `verified_at`

### `timeline_events`

Stores immutable audit events.

Key fields:

- `id`
- `company_id`
- `case_id`
- `event_type`
- `actor_type`
- `actor_id`
- `description`
- `metadata`
- `created_at`

### `case_notes`

Stores editable staff collaboration notes separately from audit events.

Key fields:

- `id`
- `case_id`
- `author_id`
- `body`
- `created_at`
- `updated_at`

### `reminder_logs`

Stores manually recorded reminders and draft usage.

Key fields:

- `id`
- `case_id`
- `channel`
- `template_label`
- `recipient_name`
- `recipient_phone`
- `draft_body`
- `recorded_sent_at`
- `staff_actor_id`
- `note`
- `created_at`

### `users` and `teams`

Stores enough assignment metadata for filtering, ownership, and audit actors.

Key fields:

- `users`: `id`, `name`, `email`, `role`, `team_id`, `active`
- `teams`: `id`, `name`, `manager_id`, `active`

## Workflow Rules

### Case Generation

For each active company:

1. Calculate the annual return made-up date from `annual_return_basis_date` or the incorporation anniversary.
2. For Phase 1 local private companies, calculate filing due date as 42 days after the anniversary basis date.
3. Generate the case when the due date enters the 90-day window.
4. Skip generation if `(company_id, return_year)` already exists.
5. Set initial status to `Upcoming`.
6. Write a timeline event: annual return case generated.

### Visibility And Risk

Risk and visibility thresholds:

- 90 days: case appears as `Upcoming`.
- 60 days: normal preparation visibility.
- 30 days: active chasing window.
- 14 days: warning if required checklist items are missing.
- 7 days: high urgency if documents, payment, signature, or filing preparation are incomplete.
- Overdue: red risk and escalation flag.

Risk is recalculated from due date, status, checklist, payment, reminder count, and filing fields. Stored `risk_level` can be updated when relevant case data changes so list queries stay fast.

### Status Flow

Allowed lifecycle:

`Upcoming -> Client reminder sent -> Documents pending -> Documents received -> Payment pending -> Payment received -> NAR1 prepared -> Signature pending -> Ready to file -> Filed -> Completed`

The app may allow admin correction transitions after completion, but those must create timeline events and preserve the original completion evidence.

### Completion Gate

A case can move to `Completed` only when all conditions are true:

- Every required checklist item is received and verified.
- Payment status is `Payment received`.
- Filing reference is present.
- Confirmation document is uploaded and linked.

When completed:

- Set `completed_at`.
- Set `locked_at`.
- Create a timeline event.
- Prevent normal staff edits except notes or explicit admin correction flows.

### Manual Reminder Logging

Phase 1 does not send WhatsApp messages. Staff can:

- Generate or copy a WhatsApp draft.
- Record that a reminder was sent manually.
- Select recipient and template/draft label.
- Add an optional note.

Recording a reminder:

- Inserts a `reminder_logs` row.
- Increments `annual_return_cases.reminders_sent`.
- Creates a timeline event.
- May update status to `Client reminder sent` when appropriate.

## UI Design

### `/annual-returns`

Default view: deadline-first control list.

Rows show:

- Company
- Filing due date
- Days left or overdue days
- Risk badge
- Current status
- Missing required checklist count
- Payment state
- Owner
- Reviewer
- Next action

Filters:

- Owner
- Team
- Reviewer
- Risk
- Status
- Missing documents
- Payment status
- Overdue only

Secondary view: status board using the approved lifecycle columns. Cards should preserve the existing compact operational style, but each card needs due date, risk, blockers, owner, and next action.

### `/annual-returns/$id`

Case detail sections:

- Summary header: status, due date, days left, risk, owner, reviewer, completion blockers.
- Checklist panel: required items, status, received/verified state, document reference.
- Payment panel: invoice, amount, payment status, payment proof reference.
- Filing panel: NAR1 prepared state, signature state, filing reference, confirmation document.
- Reminder panel: WhatsApp draft text, copy action, record reminder sent, reminder history.
- Timeline: immutable events for all key changes.
- Notes: staff notes separate from audit timeline.

### Dashboard

Once the repository exists, dashboard annual-return metrics should read real counts:

- Due in 7 days
- Due in 30 days
- Overdue
- High risk
- Missing required documents
- Payment pending
- Assigned to current user

## Error Handling

- Missing `DATABASE_URL`: show a clear setup/data-access error instead of a blank app.
- Duplicate generation: database uniqueness prevents duplicates; service treats existing company/year case as success.
- Invalid status transition: reject with a user-visible reason.
- Blocked completion: show exact missing requirements.
- Database failure: use the current app error boundary pattern and offer retry.
- Timeline failure: fail the whole operation rather than silently losing audit evidence.
- Locked case edit: reject normal edits and direct staff to admin correction.

## Testing And Verification

Required tests:

- Deadline calculation from company statutory dates.
- 90-day case generation window.
- Duplicate generation prevention.
- Risk threshold calculation at 60, 30, 14, 7, and overdue windows.
- Allowed status transitions.
- Completion gate success and failure cases.
- Reminder logging side effects: log row, reminder count, timeline event.
- Deadline list filtering and sorting behavior.
- Case detail completion blocker display.

Verification before completion:

- Build passes.
- Lint passes or known lint scope is documented.
- Database migrations apply cleanly.
- Seed script creates realistic sample annual-return data.
- Production-like environment can read `DATABASE_URL`.
- Manual browser check covers deadline list, board toggle, case detail, blocked completion, reminder logging, and completed-case lock.

## Rollout Plan

1. Add database schema and migration.
2. Add seed data for companies, users, teams, and annual-return cases.
3. Add repository and services.
4. Migrate `/annual-returns` to real data.
5. Migrate `/annual-returns/$id` to real data and actions.
6. Wire dashboard annual-return metrics to real data.
7. Add tests and verification.

## Open Implementation Notes

- File storage can be represented by metadata and URLs in Phase 1; actual upload plumbing can remain minimal until document upload is explicitly implemented.
- User authentication can stay lightweight if the current app does not yet have login, but all write actions should still record a staff actor from the current user context or seeded fallback user.
- Existing mock-data types can guide UI shape, but database models should be the durable contract.
