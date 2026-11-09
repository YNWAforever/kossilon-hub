-- Public request-access queue for the invite-only onboarding flow.
--
-- This table is a review queue, not an identity source: an administrator reads
-- pending rows and invites the address through Neon Auth separately. It stores no
-- password, token or document, and the public server function never returns rows.
create table request_access_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (
    char_length(email) <= 254
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  firm text not null check (char_length(firm) between 1 and 160),
  team text check (team is null or char_length(team) between 1 and 160),
  message text check (message is null or char_length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  constraint request_access_review_agrees check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

-- One pending request per address. A resubmission is treated as a duplicate
-- rather than creating a second row a reviewer would have to reconcile.
create unique index request_access_pending_email_uidx
  on request_access_requests (lower(email))
  where status = 'pending';

create index request_access_created_idx
  on request_access_requests (created_at desc);
