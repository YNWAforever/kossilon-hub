-- T27: direct, versioned lookup of one approved import preview row.
-- The full immutable rows array remains the approval/hash source of truth.
-- Existing previews are populated without changing their hash or approvals.
alter table nar_import_previews
  add column rows_by_id jsonb not null default '{}'::jsonb,
  add constraint nar_import_previews_rows_by_id_object check (jsonb_typeof(rows_by_id) = 'object');
update nar_import_previews p
set rows_by_id = coalesce((
  select jsonb_object_agg(item->>'rowId', item)
  from jsonb_array_elements(p.rows) item
), '{}'::jsonb);
