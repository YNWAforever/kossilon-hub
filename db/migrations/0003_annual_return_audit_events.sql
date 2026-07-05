create table if not exists annual_return_audit_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id),
  company_id uuid not null references companies(id),
  actor_id uuid references users(id),
  actor_role text not null check (actor_role in ('Admin', 'Manager', 'Staff')),
  action text not null,
  result text not null default 'succeeded' check (result in ('succeeded', 'denied', 'failed')),
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists annual_return_audit_events_case_created_idx
  on annual_return_audit_events (case_id, created_at desc);

create index if not exists annual_return_audit_events_actor_created_idx
  on annual_return_audit_events (actor_id, created_at desc);

create index if not exists annual_return_audit_events_action_created_idx
  on annual_return_audit_events (action, created_at desc);
