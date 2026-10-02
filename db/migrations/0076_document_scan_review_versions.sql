-- Add exact scan/job/review identities without certifying historical verdicts.
-- NULL remains unknown. No scan, review, migration history or receipt backfill.
alter table document_upload_intents
  add column if not exists scan_document_version_id uuid
    references document_versions(id) on delete set null;
alter table document_scan_jobs
  add column if not exists document_version_id uuid
    references document_versions(id) on delete set null;
alter table documents
  add column if not exists reviewed_document_version_id uuid
    references document_versions(id) on delete set null;
create index if not exists document_scan_jobs_version_idx
  on document_scan_jobs(document_version_id) where document_version_id is not null;
