-- T25 rollback: execute only against the intended database after identity and evidence review.
begin;
do $$
begin
  if not exists (select 1 from schema_migrations where id = '0056_document_analysis_context.sql') then
    raise exception 'T25 migration ledger entry missing';
  end if;
  if exists (select 1 from document_analysis_run_metadata limit 1)
     or exists (select 1 from document_findings where evidence_quote is not null limit 1) then
    raise exception 'T25 context/evidence rows exist; preserve them and stop rollback';
  end if;
end $$;
drop table document_analysis_run_metadata;
alter table document_findings
  drop constraint document_findings_evidence_bound,
  drop column evidence_quote,
  drop column evidence_confidence,
  drop column evidence_extraction_method,
  drop column evidence_bbox;
delete from schema_migrations where id = '0056_document_analysis_context.sql';
commit;
