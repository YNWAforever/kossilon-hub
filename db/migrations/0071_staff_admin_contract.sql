-- Forward-only existing-staff maintenance. No Auth identities, invitations or grants.
alter table staff_profiles add column if not exists access_revision integer not null default 1 check(access_revision>0);
create table if not exists staff_access_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references users(id) on delete restrict,
  actor_user_id uuid not null references users(id) on delete restrict,
  event_type text not null check(event_type in ('linked','access_changed','disabled')),
  old_role text,
  new_role text,
  old_team_id uuid,
  new_team_id uuid,
  handover_operation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists staff_access_events_target_idx on staff_access_events(target_user_id,created_at desc);
