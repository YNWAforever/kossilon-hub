-- 0014: generalize work_items' case reference beyond annual returns.
--
-- work_items.case_id was `not null references annual_return_cases(id)`, so no other
-- case type (SCR, incorporation intake, ad hoc changes — P1-6/7/9) could ever create a
-- work item. This replaces it with a case_type discriminator plus one nullable FK
-- column per case type — today just annual_return_case_id. A future case type adds its
-- own nullable FK column and extends the two CHECK constraints below, in its own
-- migration; this file is not touched again.

alter table work_items add column case_type text;
alter table work_items add column annual_return_case_id uuid
  references annual_return_cases(id) on delete restrict;

update work_items set case_type = 'annual_return', annual_return_case_id = case_id;

alter table work_items alter column case_type set not null;

alter table work_items add constraint work_items_case_type_check
  check (case_type in ('annual_return'));

alter table work_items add constraint work_items_case_reference_check
  check (case_type <> 'annual_return' or annual_return_case_id is not null);

alter table work_items drop constraint work_items_case_id_fkey;
alter table work_items drop column case_id;
