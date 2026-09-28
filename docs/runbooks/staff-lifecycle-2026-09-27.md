# T20 staff lifecycle and handover

Scope: local implementation on `codex/kossilon-staff-lifecycle`, stacked on T19. Covers K11 locally. No production database, provider invitation, live access change, recipient email, or deployment was changed.

## Server boundary

The production Admin page now reads the real `users` and `staff_profiles` roster. Demo stays in its separate read-only fixture console. `requireActor` joins both records and denies a disabled user even if the staff profile still says active; disagreeing role or team also fails closed. A provider identity in both staff and client membership tables is refused at each session lookup, even if a concurrent membership write bypassed the invitation-time check. Every Admin action rechecks the current active Admin records inside the database transaction. Role changes and disable operations use a shared transaction-scoped advisory lock; the last active Admin cannot be downgraded or disabled, including two concurrent attempts. Profile `access_revision` prevents stale writes, and `staff_access_events` preserves the actor and prior/new access values.

Moving a staff member to another team or disabling them requires zero outstanding annual-return cases, corporate-change cases, and open work items. The UI shows this balance. A supplied T09 handover operation must be completed and created by the acting Admin; the actual remaining workload is checked regardless of that operation. Case reassignment and T09 work-item assignment retain their existing authorization and version checks. This screen never transfers a case by setting a raw owner ID. Existing single-case and T09 work-item assignment paths now lock the target user/profile at final write, recheck active role/team after a concurrent disable, and enforce the current team for Manager case assignment and work-item placement. A two-connection case assignment test reproduced the old post-disable assignment before this change and passed after it.

## Invitation boundary

`staff_provisioning_requests` reserves normalized email and idempotency key before a provider call. `provider_call_started_at` records that a call may have happened. Reconcile looks up the **same invitation key**, verifies the provider email and key, and links the provider identity to a new `users`/`staff_profiles` pair in one DB transaction. A request with an unknown provider result is not sent again automatically. Pending/provider-created rows grant no app access. A provider identity with any client membership cannot be linked as staff.

The production `verifiedStaffInviteProvider()` deliberately returns no adapter. The tenant has not supplied a verified app-staff invitation API, a scoped management credential, or a provider-side idempotency lookup. Neon project-member invitations and the generic [create-user endpoint](https://api-docs.neon.tech/reference/createbranchneonauthnewuser) are not treated as app-staff invitations; see [Managed Auth API guidance](https://neon.com/docs/auth/guides/manage-auth-api). The Admin page shows invitation capability as unavailable; no invite button or live email is enabled. Provider-created but unlinked rows, if any after a future approved integration, require reconciliation before another send.

## Database and rollback

Forward SQL: `db/migrations/0046_staff_lifecycle.sql`. It adds access revision, durable provisioning state, and staff access audit. The schema snapshot and compatibility gate include a `staff` capability. The migration was applied from empty through 0046 on disposable `kossilon_t20_fresh`; inspection found the ledger current and all ten capabilities ready. The guarded `docs/runbooks/staff-lifecycle-rollback-0046.sql` succeeded only with no lifecycle evidence; inspection then showed 0046 missing and `canRelease=false`, and reapplication returned to current. An uncommitted local provider reservation made the exact rollback SQL raise `staff lifecycle or provider evidence exists; rollback refused`; no fixture remained afterward. Any used deployment needs a forward repair preserving provider and audit evidence.

Before a production migration, inspect the actual target ledger and definition mismatch, plus a read-only preview of existing access consistency:

```sql
select sp.id, sp.user_id, sp.role as profile_role, u.role as user_role,
       sp.team_id as profile_team_id, u.team_id as user_team_id,
       sp.active as profile_active, u.active as user_active
from staff_profiles sp join users u on u.id = sp.user_id
where sp.role <> u.role or sp.team_id is distinct from u.team_id
   or sp.active <> u.active;
```

Rows returned require human reconciliation; do not silently backfill authority. T00's production DB binding and legacy `0006_client_register.sql` remain unresolved, and this assignment does not authorize production migration or staff access mutation.

## Runtime proof still required

1. Obtain the tenant-specific Neon Auth management/invitation contract and credential scope, including a provider lookup keyed by the exact invitation request. Test only with an explicitly authorized non-client recipient, and record whether a real invitation email and session are issued. Do not infer that the documented create-user API sends an invitation.
2. Verify one authorized Admin role change and disable in the intended runtime, concurrent last-Admin refusal, immediately rejected old session, pending invitation denial, and a T09 handover with zero remaining cases and work items. Confirm provider revoke or separate identity disable behavior without relaxing app-side denial.
3. Reconcile the production migration ledger, deployment SHA, and remote CI before pilot acceptance. Local tests and a preview build do not establish production acceptance.

## Local verification on 2026-09-27

- Disposable `kossilon_t20_fresh`: migrations 0001–0046 from empty; schema inspection current with ten capabilities ready; focused T20 lifecycle suite 10/10 including two-connection last-Admin and assignment/disable races.
- Seeded disposable `kossilon_t13_fresh`: complete Vitest suite 210/210 files, 1,849 passed, two environment-gated concurrency tests skipped. The focused T20 run above executed those two scenarios separately.
- Typecheck and build passed; lint reported zero errors and the existing `react-refresh/only-export-components` warning in `src/routes/work-queue.tsx`. `verify:firm --dry-run` performed 38 reads and zero network calls or writes.
- Forward/rollback/reapply tested only on disposable local databases. Provider invitation and production runtime behavior remain unverified.
