-- T10: year-aware import identity and durable review snapshots.
-- Existing staged batches lack a trustworthy return year: keep it NULL until an operator restages
-- with an explicit year. The raw source hash remains untouched.
alter table nar_import_batches
  add column return_year integer check (return_year between 1900 and 2100),
  add column revision integer not null default 1 check (revision > 0),
  add column mapping_revision integer not null default 0 check (mapping_revision >= 0),
  add column semantic_key text,
  add column column_mapping jsonb;

alter table nar_import_batches
  drop constraint nar_import_batches_source_sha256_sheet_name_key;
create unique index nar_import_batches_semantic_identity_idx
  on nar_import_batches (source_sha256, sheet_name, return_year, parser_version)
  where return_year is not null;
create unique index nar_import_batches_legacy_identity_idx
  on nar_import_batches (source_sha256, sheet_name)
  where return_year is null;

alter table nar_import_rows
  add column source_issues jsonb,
  add column revision integer not null default 1 check (revision > 0);

create table nar_import_previews (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references nar_import_batches(id) on delete restrict,
  batch_revision integer not null check (batch_revision > 0),
  semantic_key text not null,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  counts jsonb not null,
  rows jsonb not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint nar_import_previews_actor_snapshot_key unique (batch_id, batch_revision, preview_hash, created_by)
);
create index nar_import_previews_batch_recent_idx
  on nar_import_previews (batch_id, created_at desc);
