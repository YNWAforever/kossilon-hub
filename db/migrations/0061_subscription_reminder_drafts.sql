-- T28: subscription reminders are approval-required drafts, never auto-dispatchable.
alter table notification_outbox drop constraint notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check
  check (status in ('draft', 'pending', 'processing', 'sent', 'failed',
                    'cancelled', 'needs_reconciliation'));
alter table notification_outbox
  add column approved_by uuid references users(id) on delete restrict,
  add column approved_at timestamptz,
  add constraint notification_outbox_approval_pair_check
    check ((approved_by is null) = (approved_at is null));

-- Earlier builds queued these reminders for immediate dispatch. Quarantine anything
-- still capable of dispatch; a processing provider call has an unknown result.
update notification_outbox
set status='cancelled',last_error_code='legacy_subscription_unapproved',updated_at=now()
where left(notification_type,length('service_subscription_reminder_'))='service_subscription_reminder_'
  and status in ('pending','failed') and redacted_at is null;
update notification_outbox
set status='needs_reconciliation',last_error_code='legacy_subscription_processing_unknown',
    last_error_message='Review provider outcome before any new send.',updated_at=now()
where left(notification_type,length('service_subscription_reminder_'))='service_subscription_reminder_'
  and status='processing' and redacted_at is null;
-- Keep legacy events with unknown period intact. New events carry their exact
-- renewal date; a partial unique index deduplicates each future period.
alter table service_subscription_reminder_events
  add column renewal_date date;
alter table service_subscription_reminder_events
  drop constraint if exists service_subscription_reminder_events_subscription_id_milestone_key;
alter table service_subscription_reminder_events
  drop constraint if exists service_subscription_reminder_eve_subscription_id_milestone_key;
create unique index service_subscription_reminder_period_uidx
  on service_subscription_reminder_events (subscription_id, renewal_date, milestone)
  where renewal_date is not null;
