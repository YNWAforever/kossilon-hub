-- Reviewed NAR apply is additive; legacy chosen years remain unknown, never inferred.
alter table nar_import_batches add column return_year integer check(return_year between 1900 and 2100);
alter table annual_return_cases add column import_origin text check(import_origin in ('client','historical'));
create index annual_return_cases_historical_import_idx on annual_return_cases(id) where import_origin='historical';
create table nar_mapping_events (
 id uuid primary key default gen_random_uuid(),source_system text not null,external_client_id text not null,
 before_company_id uuid references companies(id),after_company_id uuid not null references companies(id),
 actor_user_id uuid not null references users(id),created_at timestamptz not null default now()
);
create table nar_apply_previews (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references nar_import_batches(id),
 actor_user_id uuid not null references users(id),auth_user_id text not null,items jsonb not null check(jsonb_typeof(items)='array'),
 payload_hash text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '30 minutes')
);
create trigger nar_apply_previews_immutable before update on nar_apply_previews for each row execute function reject_bulk_snapshot_update();
create table nar_apply_jobs (
 id uuid primary key default gen_random_uuid(),preview_id uuid not null references nar_apply_previews(id),batch_id uuid not null references nar_import_batches(id),
 actor_user_id uuid not null references users(id),auth_user_id text not null,idempotency_key text not null,payload_hash text not null,
 state text not null default 'queued' check(state in ('queued','running','completed','partial','cancelled')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(actor_user_id,idempotency_key)
);
create table nar_apply_job_items (
 job_id uuid not null references nar_apply_jobs(id),row_id uuid not null references nar_import_rows(id),ordinal integer not null,
 snapshot jsonb not null,state text not null default 'pending' check(state in ('pending','applied','conflict','failed','cancelled')),
 reason text,attempts integer not null default 0,case_id uuid references annual_return_cases(id),finished_at timestamptz,
 primary key(job_id,row_id),unique(job_id,ordinal)
);
create table nar_apply_journal (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references nar_apply_jobs(id),batch_id uuid not null references nar_import_batches(id),
 row_id uuid not null references nar_import_rows(id),case_id uuid not null references annual_return_cases(id),
 actor_user_id uuid not null references users(id),before_value jsonb,after_value jsonb not null,after_revision text not null,
 command text not null check(command in ('create','update','unchanged','already_applied')),created_at timestamptz not null default now(),unique(job_id,row_id)
);
create index nar_apply_jobs_owner_idx on nar_apply_jobs(actor_user_id,created_at desc,id);
create index nar_apply_items_pending_idx on nar_apply_job_items(job_id,ordinal) where state='pending';
