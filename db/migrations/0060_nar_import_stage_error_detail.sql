-- T27: only parser-owned validation refusals may be shown to the uploading Admin.
-- Provider, SQL and storage errors remain codes with no raw detail.
alter table nar_import_stage_jobs
  add column error_detail text,
  add constraint nar_import_stage_jobs_error_detail_limit
    check (error_detail is null or length(error_detail) <= 500);
