-- T22: optimistic case-owner revision for safe per-item bulk assignment.
alter table annual_return_cases
  add column assignment_revision integer not null default 1
    check (assignment_revision > 0);
