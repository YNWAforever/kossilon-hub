-- T27: only importApply may exceed the generic 1000-item bulk selection ceiling.
alter table bulk_previews drop constraint bulk_previews_selection_count_check;
alter table bulk_previews add constraint bulk_previews_selection_count_check
  check (selection_count >= 0 and selection_count <=
    case when action = 'importApply' then 10000 else 1000 end);
