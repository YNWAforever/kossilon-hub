-- T25: contextual analysis provenance. The model remains advisory.
alter table document_findings
  add column evidence_quote text,
  add column evidence_confidence numeric(4,3),
  add column evidence_extraction_method text,
  add column evidence_bbox jsonb,
  add constraint document_findings_evidence_bound check (
    evidence_quote is null or (
      tier = 'provider' and document_version_id is not null and page_from is not null
      and page_to = page_from and length(evidence_quote) between 1 and 500
      and evidence_confidence between 0.8 and 1
      and evidence_extraction_method in ('text-layer', 'ocr')
    )
  );

create table document_analysis_run_metadata (
  analysis_job_id uuid primary key references document_analysis_jobs(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,
  context_hash char(64) check (context_hash ~ '^[a-f0-9]{64}$'),
  rule_set_version text not null,
  extraction_method text not null check (extraction_method in ('text-layer', 'none', 'unreadable', 'ocr')),
  model_version text,
  prompt_version text,
  cost_minor integer check (cost_minor is null or cost_minor >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index document_analysis_run_metadata_version_idx
  on document_analysis_run_metadata (document_version_id, created_at desc);
