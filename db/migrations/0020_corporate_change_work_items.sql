-- 0020: extend work_items for the corporate_change_request case type (P1-9).
--
-- Per 0014's own comment: a future case type adds its own nullable FK column and
-- extends the two CHECK constraints below, in its own migration.

alter table work_items add column corporate_change_request_id uuid
  references corporate_change_requests(id) on delete restrict;

alter table work_items drop constraint work_items_case_type_check;
alter table work_items add constraint work_items_case_type_check
  check (case_type in ('annual_return', 'corporate_change_request'));

alter table work_items drop constraint work_items_case_reference_check;
alter table work_items add constraint work_items_case_reference_check
  check (
    (case_type = 'annual_return' and annual_return_case_id is not null and corporate_change_request_id is null)
    or (case_type = 'corporate_change_request' and corporate_change_request_id is not null and annual_return_case_id is null)
  );
