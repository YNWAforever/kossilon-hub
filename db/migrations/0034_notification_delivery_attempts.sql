-- T06: a durable boundary between a claim and an external provider call.
-- Existing processing rows have no attempt history. Their outcome is unknown;
-- quarantine them rather than allowing the old visibility reclaim to send again.
alter table notification_outbox drop constraint notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'needs_reconciliation'));

update notification_outbox
set status = 'needs_reconciliation',
    last_error_code = 'legacy_processing_unknown',
    last_error_message = 'Processing before durable attempts; reconcile before any resend.',
    updated_at = now()
where status = 'processing' and redacted_at is null;

create table if not exists notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references notification_outbox(id) on delete restrict,
  attempt_count integer not null check (attempt_count > 0),
  lease_token uuid not null default gen_random_uuid(),
  delivery_key text not null,
  state text not null check (state in (
    'claimed', 'send_started', 'accepted', 'simulated',
    'definitely_rejected', 'unknown', 'abandoned'
  )),
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  send_started_at timestamptz,
  finished_at timestamptz,
  provider_message_id text,
  error_code text,
  attempt_ref text,
  unique (outbox_id, attempt_count),
  unique (lease_token),
  constraint notification_delivery_attempt_started_check check (
    state not in ('send_started', 'accepted', 'simulated', 'unknown')
    or send_started_at is not null
  )
);

create index if not exists notification_delivery_attempts_outbox_idx
  on notification_delivery_attempts (outbox_id, attempt_count desc);
create index if not exists notification_delivery_attempts_unresolved_idx
  on notification_delivery_attempts (lease_expires_at)
  where state in ('claimed', 'send_started');
