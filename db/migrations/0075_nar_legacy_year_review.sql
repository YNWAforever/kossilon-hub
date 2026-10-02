-- Explicit legacy-year review; no filename inference or backfill.
create table nar_batch_review_events (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references nar_import_batches(id),
 actor_user_id uuid not null references users(id),before_year integer,after_year integer not null check(after_year between 1900 and 2100),
 expected_version text not null,reason text not null check(length(btrim(reason))>=10),created_at timestamptz not null default now()
);
create index nar_batch_review_events_batch_idx on nar_batch_review_events(batch_id,created_at,id);
