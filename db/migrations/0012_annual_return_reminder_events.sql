-- evaluateReminders (src/features/annual-return/repository.ts) needs a permanent
-- record of which milestone reminders have already fired per case, independent of
-- notification_outbox — those rows get redacted after retention_until (see
-- redactExpired in src/features/notifications/outbox.ts), so deriving "already
-- sent" from the outbox would silently forget and re-send once a row aged out.
-- Mirrors escalation_events, which solves the identical problem for SLA warnings
-- and breaches.
create table if not exists annual_return_reminder_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id),
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (case_id, milestone)
);
