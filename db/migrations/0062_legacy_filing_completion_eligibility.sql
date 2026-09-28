-- T29 review: preserve only already-filed historical cases with verified legacy
-- confirmation proof. New cases must use approved package, handoff and return.
alter table annual_return_cases
  add column legacy_completion_eligible boolean not null default false;

update annual_return_cases arc
set legacy_completion_eligible = true
where arc.current_status = 'Filed'
  and arc.filing_reference is not null
  and btrim(arc.filing_reference) <> ''
  and arc.confirmation_document_id is not null
  and exists (
    select 1 from documents d
    where d.id = arc.confirmation_document_id
      and d.case_id = arc.id
      and d.company_id = arc.company_id
      and d.verification_status = 'verified'
      and d.file_type in ('filing-confirmation', 'submission')
  )
  and not exists (
    select 1 from filing_packages fp where fp.case_id = arc.id
  );