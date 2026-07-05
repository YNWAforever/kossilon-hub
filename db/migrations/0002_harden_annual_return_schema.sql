do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annual_return_cases_return_year_check'
      and conrelid = 'annual_return_cases'::regclass
  ) then
    alter table annual_return_cases
      add constraint annual_return_cases_return_year_check
      check (return_year between 1900 and 2100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'annual_return_cases_reminders_sent_nonnegative_check'
      and conrelid = 'annual_return_cases'::regclass
  ) then
    alter table annual_return_cases
      add constraint annual_return_cases_reminders_sent_nonnegative_check
      check (reminders_sent >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_amount_positive_check'
      and conrelid = 'payments'::regclass
  ) then
    alter table payments
      add constraint payments_amount_positive_check
      check (amount > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_currency_hkd_check'
      and conrelid = 'payments'::regclass
  ) then
    alter table payments
      add constraint payments_currency_hkd_check
      check (currency = 'HKD');
  end if;
end
$$;

create index if not exists documents_case_idx on documents (case_id);
create index if not exists documents_company_idx on documents (company_id);
create index if not exists case_notes_case_idx on case_notes (case_id);
create index if not exists reminder_logs_case_idx on reminder_logs (case_id);
create index if not exists companies_assigned_team_idx on companies (assigned_team_id);
