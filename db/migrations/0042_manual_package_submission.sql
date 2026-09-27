-- T15: human-recorded external submission is distinct from package download,
-- connector transmission, and external acknowledgement.
alter table package_handoffs
  add column package_id uuid references filing_packages(id) on delete restrict,
  add column submission_mode text check (submission_mode in ('manual','external-api')),
  add column destination_label text,
  add column proof_version_id uuid references document_versions(id) on delete restrict,
  add column submitted_at timestamptz,
  add column recorded_at timestamptz;

alter table package_handoffs drop constraint package_handoffs_status_check;
alter table package_handoffs add constraint package_handoffs_status_check
  check (status in (
    'prepared','recorded_submission','transmitted','acknowledged',
    'returned','failed','cancelled'
  ));
alter table package_handoffs drop constraint package_handoffs_transmission_agrees;
alter table package_handoffs add constraint package_handoffs_transmission_agrees
  check (
    (status in ('prepared','recorded_submission','failed','cancelled')
      and transmitted_at is null)
    or (status in ('transmitted','acknowledged','returned')
      and transmitted_at is not null)
  );
alter table package_handoffs add constraint package_handoffs_manual_evidence
  check (
    (status <> 'recorded_submission' or submission_mode = 'manual')
    and (submission_mode is distinct from 'manual'
    or (
      package_id is not null
      and destination_label is not null and length(btrim(destination_label)) > 0
      and destination_reference is not null and length(btrim(destination_reference)) > 0
      and proof_version_id is not null
      and submitted_at is not null
      and recorded_at is not null
    ))
  );

drop index package_handoffs_live_uidx;
create unique index package_handoffs_live_uidx on package_handoffs (case_id)
  where status in ('prepared','recorded_submission','transmitted','acknowledged');
create unique index package_handoffs_manual_package_uidx
  on package_handoffs (package_id) where submission_mode = 'manual';
create unique index package_handoffs_manual_reference_uidx
  on package_handoffs (case_id,destination_label,destination_reference)
  where submission_mode = 'manual';

create function enforce_manual_submission_identity() returns trigger
language plpgsql as $$
begin
  if old.submission_mode = 'manual' and (
    old.case_id is distinct from new.case_id
    or old.package_id is distinct from new.package_id
    or old.manifest_sha256 is distinct from new.manifest_sha256
    or old.manifest_payload is distinct from new.manifest_payload
    or old.approved_by is distinct from new.approved_by
    or old.released_by is distinct from new.released_by
    or old.submission_mode is distinct from new.submission_mode
    or old.destination_label is distinct from new.destination_label
    or old.destination_reference is distinct from new.destination_reference
    or old.proof_version_id is distinct from new.proof_version_id
    or old.submitted_at is distinct from new.submitted_at
    or old.recorded_at is distinct from new.recorded_at
  ) then raise exception 'Manual submission identity is immutable';
  end if;
  return new;
end $$;
create trigger package_handoffs_manual_identity_before_update
before update on package_handoffs for each row
execute function enforce_manual_submission_identity();
