-- T07: per-job leases; scheduled slots are unique across trigger owners.
create table maintenance_job_runs (
  id uuid primary key default gen_random_uuid(),
  scheduled_for timestamptz not null,
  job_kind text not null check (job_kind in (
    'evaluateEscalations', 'settleNotificationAttempts',
    'redactNotifications', 'escalateStalledQuarantine'
  )),
  trigger_source text not null check (trigger_source in ('scheduled', 'manual')),
  run_id text not null,
  lease_token uuid not null default gen_random_uuid(),
  state text not null check (state in ('claimed','started','succeeded','failed','unknown')),
  claimed_at timestamptz not null,
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lease_token),
  constraint maintenance_job_started_check check (
    state = 'claimed' or started_at is not null
  )
);
create unique index maintenance_job_scheduled_once_idx
  on maintenance_job_runs (scheduled_for, job_kind)
  where trigger_source = 'scheduled';
create index maintenance_job_unresolved_idx
  on maintenance_job_runs (lease_expires_at)
  where state in ('claimed','started');
