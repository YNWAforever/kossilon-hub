-- Idempotency belongs to the active attempt, not every immutable historical approval.
-- Unknown results (including legacy NULL) remain outstanding and cannot be retried.
drop index package_handoffs_manifest_uidx;
create unique index package_handoffs_manifest_uidx on package_handoffs(case_id,manifest_sha256)
  where status in ('prepared','transmitted','acknowledged') or delivery_fact='unknown'
    or (delivery_fact is null and status not in ('cancelled','returned'));
drop index package_handoffs_live_uidx;
create unique index package_handoffs_live_uidx on package_handoffs(case_id)
  where status in ('prepared','transmitted','acknowledged') or delivery_fact='unknown'
    or (delivery_fact is null and status not in ('cancelled','returned'));
