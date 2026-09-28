# T28 service lifecycle acceptance (local)

Source branch: `codex/kossilon-service-lifecycle`, stacked on T27. This document records local evidence only. No production database, provider send, invitation, or deployment was changed.

## Behavior and authority

- Incorporation intake advances through the existing status service. Only `completeCase` may set Completed and create the company. An exact replay returns the same case/company; a conflicting replay is rejected. Staff list/detail reads are scoped to the assigned team; Admin retains all-team read.
- Corporate change requests retain the existing four types. Name, address, officer and shareholding canonical registers are changed by the completion service after Filed with Registrar, not by a status edit. Request intake and completion reject foreign-company officer/shareholding IDs. Completed replay is idempotent. Existing annual-return party display snapshots remain unchanged after later company rename/director cessation.
- Subscription reminder evaluation creates outbox `draft` rows. The delivery worker does not claim drafts. Manager/Admin approval checks the live DB actor, company team, current subscription period, recipient, channel, content, retention and draft state under locks before queueing. Repeat approval does not queue a second send. Renewal/cancellation cancels stale drafts and unsent pending reminders. A processing outcome remains unknown and requires reconciliation.
- Client portal membership and staff-role boundaries remain server enforced. The corporate and incorporation staff detail/list routes now reject cross-team reads.
- WeChat has no adapter verified by this audit. No WeChat delivery is claimed.

## RED/GREEN and local evidence

Named `t28_scenario_1` through `t28_scenario_3` integration cases were RED for direct Completed bypass, foreign-company transfer, unapproved pending reminder, missing approval operation and unscoped incorporation list. They turned GREEN after the domain and route changes. A further RED showed that a missing primary contact consumed the reminder milestone, blocking later draft creation; moving the milestone event after recipient validation made contact repair GREEN. Existing cancellation and filing-snapshot behavior was verified with executable integration cases.

Migration `0061_subscription_reminder_drafts.sql` was applied on a newly created disposable local PostgreSQL database after applying exactly migrations 0001-0060. Synthetic pre-upgrade records comprised pending, failed and processing subscription reminders plus one legacy reminder event. The upgrade produced two `cancelled` rows with `legacy_subscription_unapproved`, one `needs_reconciliation` row with `legacy_subscription_processing_unknown`, retained the legacy event with a null period, removed the old all-period unique constraint and installed `service_subscription_reminder_period_uidx`. `db:inspect` reported current ledger and all 12 capabilities ready. This is a local upgrade rehearsal, not production schema verification. The complete seeded local suite passed 225 files and 1,923 tests, with one file and five tests skipped. Typecheck and build passed; lint had zero errors and one inherited Fast Refresh warning. The offline firm gate used 38 reads, zero network calls and zero writes; dev-server imports and both built cron handlers passed.

## Production review gate for 0061

Run read-only identity and backup checks under the T03 production database gate before any authorization to apply 0061. Preview the exact affected rows without exposing recipient/content:

```sql
select status, count(*)::int
from notification_outbox
where left(notification_type, length('service_subscription_reminder_')) =
      'service_subscription_reminder_'
  and status in ('pending','failed','processing')
  and redacted_at is null
group by status order by status;
select conname
from pg_constraint
where conrelid = 'service_subscription_reminder_events'::regclass
  and contype = 'u';
select count(*)::int as legacy_events
from service_subscription_reminder_events;
```

Apply only after approving a specific backup/restore point, migration diff, row counts, application commit and deployment window. Stop the reminder worker during schema cutover. If validation fails, restore the named pre-upgrade database snapshot into an isolated database and compare ledger, outbox counts and provider attempt records before any traffic switch. A direct down migration is unsafe once new renewal periods have events because the old single-period uniqueness cannot represent them. Do not resend an unknown processing outcome. Reconciliation needs provider evidence.

## Remaining runtime evidence

Authenticated browser acceptance for incorporation, all four corporate change types, subscriptions and Client ownership; deployed schema identity and upgrade approval; provider delivery and reconciliation; any real WeChat integration; internal pilot acceptance. CI and local SQL tests do not establish these results.
