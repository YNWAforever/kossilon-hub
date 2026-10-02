-- Separate from notification outbox; no external side effects or historical rewrites.
create table bulk_selection_snapshots (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references users(id),
 auth_user_id text not null, resource text not null check(resource in ('annual_return_case','work_item')),
 filters jsonb not null, items jsonb not null check(jsonb_typeof(items)='array'), snapshot_hash text not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '30 minutes')
);
create table bulk_operation_previews (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references users(id),auth_user_id text not null,
 resource text not null check(resource in ('annual_return_case','work_item')), assignment jsonb not null,items jsonb not null check(jsonb_typeof(items)='array'),
 payload_hash text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '30 minutes')
);
create table bulk_operation_jobs (
 id uuid primary key default gen_random_uuid(),preview_id uuid not null references bulk_operation_previews(id),
 actor_user_id uuid not null references users(id),auth_user_id text not null,idempotency_key text not null,payload_hash text not null,
 resource text not null check(resource in ('annual_return_case','work_item')),assignment jsonb not null,total integer not null check(total>=0),
 state text not null default 'queued' check(state in ('queued','running','completed','partial','cancelled')),
 lease_token uuid,lease_until timestamptz,cancel_requested boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(actor_user_id,idempotency_key)
);
create table bulk_operation_job_items (
 job_id uuid not null references bulk_operation_jobs(id),ordinal integer not null check(ordinal>=0),resource_id uuid not null,expected_version text not null,
 state text not null default 'pending' check(state in ('pending','succeeded','forbidden','locked','conflict','failed','unknown','cancelled')),
 reason text,retryable boolean not null default false,attempts integer not null default 0 check(attempts>=0),
 result jsonb,started_at timestamptz,finished_at timestamptz,
 primary key(job_id,ordinal),unique(job_id,resource_id)
);
create index bulk_operation_jobs_owner_idx on bulk_operation_jobs(actor_user_id,created_at desc,id);
create index bulk_operation_jobs_pending_idx on bulk_operation_jobs(state,lease_until) where state in ('queued','running');
create index bulk_operation_items_pending_idx on bulk_operation_job_items(job_id,ordinal) where state='pending';
-- Enforce snapshots' immutability in the database, not only in application conventions.
create function reject_bulk_snapshot_update() returns trigger language plpgsql as $$begin raise exception 'Bulk snapshots and previews are immutable'; end$$;
create trigger bulk_selection_snapshots_immutable before update on bulk_selection_snapshots for each row execute function reject_bulk_snapshot_update();
create trigger bulk_operation_previews_immutable before update on bulk_operation_previews for each row execute function reject_bulk_snapshot_update();
