-- Extend the existing source field; never infer or reclassify existing rows.
-- All non-client values remain suppressed by every outbox gate.
set local lock_timeout = '5s';
lock table companies in access exclusive mode;
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='companies'::regclass and conname='companies_data_origin_check';
  if definition is distinct from 'CHECK ((data_origin = ANY (ARRAY[''client''::text, ''fixture''::text])))'
    and definition is distinct from 'CHECK ((data_origin = ANY (ARRAY[''client''::text, ''fixture''::text, ''historical''::text])))' then
    raise exception 'Unexpected data origin constraint; review before extending';
  end if;
end $$;
alter table companies drop constraint companies_data_origin_check;
alter table companies add constraint companies_data_origin_check
  check (data_origin in ('client', 'fixture', 'historical'));
