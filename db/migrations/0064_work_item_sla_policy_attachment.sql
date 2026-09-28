-- A no-policy work item may gain exactly one selected, audited SLA snapshot.
-- Existing snapshots remain immutable. The service inserts the audit row and
-- updates the work item in one transaction after an Admin-authorized preview.
create table work_item_sla_attachments (
  work_item_id uuid primary key references work_items(id) on delete restrict,
  policy_version_id uuid not null references sla_policies(id) on delete restrict,
  expected_version integer not null check (expected_version > 0),
  actor_id uuid not null references users(id) on delete restrict,
  sla_started_at timestamptz not null,
  sla_warning_at timestamptz not null,
  sla_due_at timestamptz not null,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint work_item_sla_attachments_order_check check (
    sla_started_at <= sla_warning_at and sla_warning_at < sla_due_at
  )
);

create or replace function reject_work_item_sla_attachment_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Work item SLA attachment audit is immutable';
end
$$;

create trigger work_item_sla_attachments_immutable
before update or delete on work_item_sla_attachments
for each row execute function reject_work_item_sla_attachment_mutation();

create or replace function enforce_work_item_sla_snapshot_immutability()
returns trigger language plpgsql as $$
begin
  if old.sla_policy_version_id is distinct from new.sla_policy_version_id
    or old.sla_started_at is distinct from new.sla_started_at
    or old.sla_warning_at is distinct from new.sla_warning_at
    or old.sla_due_at is distinct from new.sla_due_at then
    if not (
      old.sla_policy_version_id is null
      and old.sla_started_at is null and old.sla_warning_at is null and old.sla_due_at is null
      and old.sla_breached_at is null and old.escalation_state = 'none'
      and new.sla_policy_version_id is not null
      and new.sla_started_at is not null and new.sla_warning_at is not null
      and new.sla_due_at is not null
      and new.version = old.version + 1
      and (to_jsonb(new) - array[
        'sla_policy_version_id', 'sla_started_at', 'sla_warning_at', 'sla_due_at',
        'version', 'updated_at'
      ]) = (to_jsonb(old) - array[
        'sla_policy_version_id', 'sla_started_at', 'sla_warning_at', 'sla_due_at',
        'version', 'updated_at'
      ])
      and exists (
        select 1 from work_item_sla_attachments a
        where a.work_item_id = old.id and a.expected_version = old.version
          and a.policy_version_id = new.sla_policy_version_id
          and a.sla_started_at = new.sla_started_at
          and a.sla_warning_at = new.sla_warning_at
          and a.sla_due_at = new.sla_due_at
      )
    ) then
      raise exception 'Work item SLA snapshots are immutable';
    end if;
  end if;
  if old.sla_breached_at is not null
    and old.sla_breached_at is distinct from new.sla_breached_at then
    raise exception 'Work item breach timestamps are write-once';
  end if;
  return new;
end
$$;
