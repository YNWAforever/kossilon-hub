-- T23: durable draft review only. Queuing a client message is a separate,
-- explicit per-item approval through the T18 single-message service.
alter table bulk_previews drop constraint bulk_previews_action_check;
alter table bulk_previews add constraint bulk_previews_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts','importApply'));
alter table bulk_operations drop constraint bulk_operations_action_check;
alter table bulk_operations add constraint bulk_operations_action_check
  check (action in ('assign','caseAssign','clientAssign','tag','reminderDrafts','importApply'));

create table bulk_reminder_reviews (
  id uuid primary key default gen_random_uuid(),
  operation_item_id uuid not null unique references bulk_operation_items(id) on delete restrict,
  logical_key text not null,
  case_id uuid not null references annual_return_cases(id) on delete restrict,
  company_id uuid not null references companies(id) on delete restrict,
  contact_id uuid not null references company_contacts(id) on delete restrict,
  cadence_slot date not null,
  preview_id uuid not null references whatsapp_message_previews(id) on delete restrict,
  preview_hash text not null check (preview_hash ~ '^[a-f0-9]{64}$'),
  created_by_id uuid not null references users(id) on delete restrict,
  state text not null default 'draft'
    check (state in ('draft','queued','needs-reconciliation','cancelled')),
  message_id uuid references whatsapp_messages(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'queued' and message_id is not null)
    or (state <> 'queued' and message_id is null))
);
create unique index bulk_reminder_reviews_logical_key_active_uidx
  on bulk_reminder_reviews(logical_key) where state <> 'cancelled';
create index bulk_reminder_reviews_case_idx
  on bulk_reminder_reviews(case_id,created_at desc);
