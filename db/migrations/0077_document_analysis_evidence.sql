-- Add source-bound evidence and run provenance. Historical NULL is unknown;
-- no clean verdict, page citation, human resolution or model metadata backfill.
alter table document_version_texts
  add column if not exists evidence jsonb
    check (evidence is null or jsonb_typeof(evidence) = 'object');
alter table document_findings
  add column if not exists evidence jsonb
    check (evidence is null or jsonb_typeof(evidence) = 'object');
alter table document_analysis_jobs
  add column if not exists provenance jsonb
    check (provenance is null or jsonb_typeof(provenance) = 'object');
