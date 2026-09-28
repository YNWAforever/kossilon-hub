-- A missing active policy must leave a visible, assignable work item, not
-- invent a due date or silently drop the source event. Existing SLA snapshots
-- stay immutable; policy backfill requires an explicit reviewed action.
alter table work_items
  alter column sla_policy_version_id drop not null,
  alter column sla_started_at drop not null,
  alter column sla_warning_at drop not null,
  alter column sla_due_at drop not null;

alter table work_items drop constraint work_items_sla_order_check;
alter table work_items add constraint work_items_sla_snapshot_check check (
  (
    sla_policy_version_id is null
    and sla_started_at is null
    and sla_warning_at is null
    and sla_due_at is null
    and sla_breached_at is null
    and escalation_state = 'none'
  ) or (
    sla_policy_version_id is not null
    and sla_started_at is not null
    and sla_warning_at is not null
    and sla_due_at is not null
    and sla_started_at <= sla_warning_at
    and sla_warning_at < sla_due_at
  )
);
