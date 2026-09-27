# T23 bulk annual-return reminder drafts — local release evidence

The WhatsApp Automation page selects current annual-return follow-up cases and shows a T09 dry run with per-case state, verified recipient, send mode and exact approved template text. The preview creates only short-lived T18 `MessagePreview` rows. Its T09 commit schedules per-item **review drafts**, never messages. The existing bulk scheduler invokes `applyOneReminderReviewForActor` for each pending item and saves the review ID in its result. The UI loads each review by that ID. A second explicit staff approval invokes T18 `queueApprovedMessageForActor` for that one frozen preview, in the same transaction that marks its review queued. T18's outbox and dispatch capacity remain the sole send path.

The logical reminder key contains case, company, purpose, Hong Kong business-date cadence slot and contact; a shared phone does not merge companies. The active-key unique index and item transaction prevent replayed drafts. A cancelled unsent draft remains audit evidence but releases that active key. After a contact, template, assignment version or preview expiry change, approval fails; the operator cancels the unsent draft, verifies the new contact/provider template, and makes a fresh preview. Queued or unknown sends cannot be cancelled or retried through the batch. The read model traces pending, processing, sent, failed and `needs_reconciliation` from the existing outbox and exposes the provider receipt when available. A provider acknowledgement without durable receipt is shown as requiring reconciliation, never as a confirmed send.

Fixture and closed cases, recent reminders, missing/ambiguous primary contacts, unverified numbers, missing language and missing active provider-verified `annual_return_manual_reminder` templates are per-item skips. Manager team scope, active profile, case revision, contact and template are rechecked at the item/approval boundary. Demo mutations are blocked server-side. Live queue approval requires the existing WhatsApp capability gate to be healthy. This local work did not send to any recipient. Provider approval and runtime reachability are unverified.

## Release and rollback gate

Forward SQL is `db/migrations/0054_bulk_reminder_drafts.sql`; canonical `src/server/db/schema.sql`, migration inventory and schema compatibility require the same table, partial active logical-key index and action constraints. Migration and rollback rehearsal target disposable PostgreSQL only. The target production binding still needs T03 read-only identity and ledger reconciliation (including the unknown legacy `0006` entry and unapplied 0021 onward) before separately authorized migration. Do not equate local schema readiness, PR checks or a preview deployment with runtime delivery.

Before any authorized target migration, save read-only output for:

```sql
select current_database(), current_user;
select id from schema_migrations order by id;
select action,count(*) from bulk_operations group by action order by action;
select template_name,language_code,status,
  provider_approval_verified_at is not null as provider_approval_recorded
from whatsapp_templates where template_name='annual_return_manual_reminder';
```

Review recipient/template approval in the actual provider tenant and a current capability probe before any live approval. Production DB migration, recipient sends and publication need their own authorization. For an empty clone after 0054, use `docs/runbooks/bulk-reminder-drafts-rollback-0054.sql`; it refuses rollback when any T23 preview, operation or review evidence exists. Retain all such evidence instead of deleting it to force rollback.
