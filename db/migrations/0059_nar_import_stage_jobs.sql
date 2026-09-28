-- T27: durable, actor-owned workbook parsing with private object storage.
-- An upload remains encrypted/private in R2; only its opaque object key and hash are here.
create table nar_import_stage_jobs (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size_bytes integer not null check (source_size_bytes > 0 and source_size_bytes <= 26214400),
  object_key text not null unique,
  sheet_name text,
  return_year integer not null check (return_year between 1900 and 2100),
  created_by uuid not null references users(id),
  state text not null default 'queued' check (state in ('queued','processing','succeeded','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  error_code text,
  object_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nar_import_stage_jobs_result_object check (result is null or jsonb_typeof(result) = 'object')
);
create unique index nar_import_stage_jobs_active_upload
  on nar_import_stage_jobs (source_sha256, coalesce(sheet_name,''), return_year, created_by)
  where state <> 'failed';
create index nar_import_stage_jobs_claim
  on nar_import_stage_jobs (created_at,id) where state in ('queued','processing');
create index nar_import_stage_jobs_cleanup
  on nar_import_stage_jobs (updated_at,id)
  where state in ('succeeded','failed') and object_deleted_at is null;
