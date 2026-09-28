-- T20: local staff lifecycle ledger. No provider request or permission change is made by this migration.
alter table staff_profiles
  add column access_revision integer not null default 1
    check (access_revision > 0);

create table staff_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 320),
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  requested_role text not null check (requested_role in ('Admin','Manager','Staff')),
  requested_team_id uuid references teams(id) on delete restrict,
  requested_by_id uuid not null references users(id) on delete restrict,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending','provider_created','linked','failed')),
  provider_auth_user_id text unique,
  provider_call_started_at timestamptz,
  user_id uuid unique references users(id) on delete restrict,
  last_error_code text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_provisioning_link_pair check (
    (status = 'linked' and provider_auth_user_id is not null and user_id is not null)
    or (status <> 'linked' and user_id is null)
  )
);

create table staff_access_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references users(id) on delete restrict,
  actor_user_id uuid not null references users(id) on delete restrict,
  event_type text not null check (event_type in ('linked','access_changed','disabled')),
  old_role text,
  new_role text,
  old_team_id uuid,
  new_team_id uuid,
  handover_operation_id uuid references bulk_operations(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index staff_access_events_target_idx on staff_access_events(target_user_id,created_at desc);
