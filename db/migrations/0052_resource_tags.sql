-- T22: versioned tags for clients, annual-return cases and work items.
alter table companies add column tag_revision integer not null default 1 check (tag_revision > 0);
alter table annual_return_cases add column tag_revision integer not null default 1 check (tag_revision > 0);
alter table work_items add column tag_revision integer not null default 1 check (tag_revision > 0);

create table company_tags (
  company_id uuid not null references companies(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 64),
  created_by_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id,tag)
);
create table annual_return_case_tags (
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 64),
  created_by_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (case_id,tag)
);
create table work_item_tags (
  work_item_id uuid not null references work_items(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 64),
  created_by_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (work_item_id,tag)
);
create table resource_tag_events (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('clients','annual-return-cases','work-items')),
  resource_id uuid not null,
  tag text not null,
  action text not null check (action in ('add','remove')),
  actor_id uuid not null references users(id) on delete restrict,
  revision_before integer not null check (revision_before > 0),
  revision_after integer not null check (revision_after > revision_before),
  created_at timestamptz not null default now()
);
create index resource_tag_events_resource_idx
  on resource_tag_events(resource_type,resource_id,created_at desc);
