# T12 — verified staff maintenance

## Release scope and prerequisites

Candidate PR05 extends the existing four roles (Admin, Manager, Staff, Client).
`0071_staff_admin_contract.sql` adds `staff_profiles.access_revision` and attributed
`staff_access_events`. It creates no Auth identities, sends no invitations, grants
no access and changes no existing roles or active flags. Only the isolated local
Postgres database has received this migration.

Before a separately approved production operation, the DB owner must inspect the
physical columns, checks, indexes and FKs of the historical 0046 staff lifecycle
tables. `IF NOT EXISTS` does not prove compatibility. Preserve historical IDs and
hashes; do not substitute 0071 for an old ledger entry or delete old events. Retain
the production restore point and use the reviewed schema-readiness release order.
An old `handover_operation_id` FK may refer to the historical bulk table; this
candidate leaves that FK and historical rows intact.

## Existing identity maintenance

Admin RPC and repository independently require the current exact
`staff_profiles.auth_user_id` binding, matching active user/profile role and team.
Email text never binds an identity. Each mutation supplies the displayed access
revision; a changed revision produces HTTP 409 and requires refresh.

The UI displays open cases/work items before disable, team move or conversion to
Client. Transfer those assignments using the authorized assignment domain service,
then preview again. The server rechecks current work in the write transaction;
the preview is advisory and cannot authorize a later changed scope. Neither
successful transfers nor historical events are deleted on disable.

Last-Admin checks share one transaction advisory lock. Assignment transactions
hold shared user/profile locks, so a concurrent disable cannot receive new work
after commit. Every `requireActor` call rereads both active states; an old session
is rejected after disable. Missing last-login evidence displays unknown.

## Provider invitations — blocked / Auth owner

No tenant-verified Neon Auth staff provisioning API or management credential was
provided. The invitation UI explicitly reports blocked, while verified existing
staff maintenance is usable. No invitation request is made by this release.

Manual provisioning, if separately approved, must follow these concrete steps:

1. Auth owner confirms the target Neon Auth project/branch and its documented
   administration method; obtains the intended user's consent and approved role/team.
2. Auth owner performs the provider's supported enrollment process and verifies
   the immutable Auth user ID in that tenant. A matching email or an existing
   browser session is insufficient evidence.
3. Prepare a reviewed transaction with the exact verified Auth ID and existing
   internal user ID. Preview both records, unique-ID conflicts, team state and
   before/after scope. Require fresh expected access revision and at least one
   active Admin. Record actor, evidence reference and approved role/team.
4. Execute only under the separately approved production identity/access change.
   Test a fresh session and a separate unauthorized account; record actual provider
   evidence without storing tokens, invitation links or secrets in the repository.

An unknown enrollment or invitation result requires provider reconciliation;
never create an invented Auth ID or retry a live invitation blindly.

## Rollback

Pause staff mutations and switch to an approved compatible build. Retain revisions,
access events and all assignments; no down migration or history reset is proposed.
Restore an erroneous role/active change only through a fresh authorized, versioned
maintenance command with its own event and last-Admin/handover checks. A fresh
provider session test remains a release gate, separate from local injected-session
and real-Postgres contract tests.
