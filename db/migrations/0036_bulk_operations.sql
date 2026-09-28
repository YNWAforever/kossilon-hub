-- T09: durable previews and per-item operation/attempt evidence.
create table bulk_previews (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('assign', 'importApply')),
  created_by_id uuid not null references users(id) on delete restrict,
  auth_user_id text not null,
  scope_role text not null check (scope_role in ('Admin','Manager')),
  scope_team_id uuid references teams(id),
  parameters jsonb not null,
  selection jsonb not null,
  resource_snapshot jsonb not null,
  preview_hash text not null check (preview_hash ~ '^[a-f0-9]{64}$'),
  selection_count integer not null check (selection_count >= 0 and selection_count <= 1000),
  eligible_count integer not null check (eligible_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  conflict_count integer not null check (conflict_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint bulk_preview_counts_check check (selection_count = eligible_count + skipped_count + conflict_count)
);
create index bulk_previews_actor_recent_idx on bulk_previews (created_by_id, created_at desc);
create table bulk_operations (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null unique references bulk_previews(id) on delete restrict,
  action text not null check (action in ('assign','importApply')),
  created_by_id uuid not null references users(id) on delete restrict,
  auth_user_id text not null,
  idempotency_key text not null,
  logical_key text not null,
  state text not null default 'queued' check (state in ('queued','running','completed','completed-with-errors','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by_id, idempotency_key),
  unique (logical_key)
);
create table bulk_operation_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references bulk_operations(id) on delete cascade,
  resource_id uuid not null,
  revision_before integer not null check (revision_before > 0),
  revision_after integer,
  state text not null default 'pending' check (state in ('pending','running','succeeded','skipped','conflict','forbidden','failed','needs-reconciliation','cancelled')),
  reason_code text,
  audit_ref uuid,
  lease_token uuid,
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now(),
  unique (operation_id, resource_id)
);
create index bulk_items_queue_idx on bulk_operation_items (operation_id, state, lease_until);
create table bulk_operation_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references bulk_operation_items(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  state text not null check (state in ('claimed','succeeded','failed','conflict','forbidden','unknown')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  reason_code text,
  unique (item_id, attempt_number)
);
