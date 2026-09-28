-- T22: optimistic revision for client owner/team assignment and stale manual edits.
alter table companies
  add column assignment_revision integer not null default 1
    check (assignment_revision > 0);
