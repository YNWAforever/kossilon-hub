-- 0018: recurring service subscriptions and renewals (P1-8).
--
-- Retires service_packages (unnamed generic tiers, no dates, no renewal
-- logic) in favor of per-company subscriptions to four named services with
-- real catalogue fees, each independently renewable. See the design spec for
-- why this is a replacement, not an addition.

alter table companies drop column if exists service_package_id;
drop table if exists service_packages;

create table if not exists service_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  service_type text not null check (service_type in (
    'secretary', 'registered_office', 'director_correspondence_address', 'designated_representative'
  )),
  fee integer not null check (fee > 0),
  status text not null default 'Active' check (status in ('Active', 'Cancelled')),
  renewal_date date not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_subscriptions_one_per_type unique (company_id, service_type)
);

create index if not exists service_subscriptions_company_idx on service_subscriptions (company_id);
create index if not exists service_subscriptions_renewal_date_idx on service_subscriptions (renewal_date)
  where status = 'Active';

-- Mirrors annual_return_reminder_events exactly (see its own migration's
-- comment for why this needs to be a permanent record independent of
-- notification_outbox, which redacts rows after retention_until).
create table if not exists service_subscription_reminder_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references service_subscriptions(id) on delete cascade,
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, milestone)
);
