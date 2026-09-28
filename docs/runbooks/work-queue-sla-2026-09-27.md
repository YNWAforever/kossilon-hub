# T05 work queue staff identity and SLA display — 2026-09-27

RED reproduction: `sla.audit-regression.test.ts` failed all three named T05 scenarios because `workQueuePersonLabel` and `deriveSlaDisplay` were missing. The live audit observed two owner choices with the same first eight UUID characters, and rows already past their displayed due date still reported `SLA None` and zero breaches. The latter alone does not prove the scheduler is broken.

Local changes:

- Queue owner and assignment suggestions now use the server-authorized staff profile plus user and team names. Recommendation SQL requires active staff profiles and active users. Inactive existing owners retain an inactive label but are excluded from new suggestions. A missing profile is explicitly identified; the full user ID is only a diagnostic title.
- Desktop and mobile owner cells use one renderer. Unassigned and unresolved owner are distinct. Focused SSR coverage checks both layouts.
- SLA badges and the breached queue derive an effective state from the immutable policy snapshot and current time, so a missed scheduler tick cannot make an expired deadline look on track. Persisted acknowledgement remains visible until a later unrecorded due threshold. The maintenance run query reads the most recent scheduled run with a non-null `escalations` pass; a run without that pass does not count. The UI shows when the scheduler last completed that pass, or that no run was recorded.
- The UI labels work and SLA due dates separately. The current `work_items` schema has only `sla_due_at`, so work due is honestly shown as not set. No filing deadline has been relabeled as a work deadline.

Limits and next dependency:

- The 2026-09-28 local migration 0063 now permits an all-null SLA snapshot. `ensureWorkItemForEvent` retains a no-policy work item in the queue without inventing due dates or escalation. The existing immutable-snapshot trigger remains in force. At the 0063 stage, a reviewed backfill preview, one-time policy attachment service and real assignment acceptance were still outstanding; a visible item alone did not mean policy setup was complete.
- No production scheduler invocation or approved live role session was available. Production migrations 0021–0033 remain absent, including the `maintenance_runs` table used for freshness. Current local behavior is not production evidence.

Read-only candidate preview for a **selected policy version** (bind `$1` as the selected UUID in an authorized local or staged database; this does not update rows). This identifies no-policy items with a matching work type only; it is not a commit operation:

```sql
select w.id, w.company_id, w.work_type, w.version,
       w.created_at, w.status, p.id as selected_policy_id,
       p.business_calendar_id
from work_items w
join sla_policies p on p.id = $1::uuid
  and p.work_type = w.work_type and p.active = true
where w.sla_policy_version_id is null
  and w.status in ('open','in_progress','blocked')
order by w.created_at, w.id;
```

Do not apply a backfill from this SQL preview alone. The one-item domain path and migration 0064 are described below; production database change still needs separate authorization. No production write, send, or deployment was performed.

Local verification: RED 3/3 named T05 scenarios; focused domain/route/PostgreSQL 10/10; full PostgreSQL-backed suite 185 files/1,744 tests passed; lint exit 0 with one existing fast-refresh warning; typecheck exit 0; verify:firm dry-run exit 0 with live provider/binding blocks; build exit 0. A test/build import-protection failure introduced during this slice was fixed by moving the pure label helper to the shared types module; the failing route suite and build were rerun successfully.

## 2026-09-28 no-policy persistence and migration 0063

RED on disposable PostgreSQL: `t05_no_policy` received `No active SLA policy exists for work type t05_unconfigured_policy_fixture.` instead of persisting the item. Migration 0063 makes the four SLA snapshot columns nullable as a group and rejects partial snapshots. The event service now inserts a current immutable policy snapshot when a policy exists, or all-null SLA fields when none exists. Queue mapping and display preserve null; sorting places these rows after known SLA deadlines; the scheduler requires a policy and skips them. A no-policy work item remains visible with its source event and owner, but this slice does not implement a new assignment override or policy attachment.

Focused regression after the local 0062→0063 upgrade and rollback/reapply: work-item repository, SLA audit regression and schema-health 3 files / 23 tests passed. The database rejected an invalid partial-SLA insert; the existing immutable-SLA trigger also rejected an attempted update. `db:inspect` on the disposable database reported ledger current, no missing/unknown/definition mismatches, 12/12 capabilities ready and `canRelease:true`; this is local only. The review-only rollback SQL restored the 0062 schema and ledger, then normal migration reapplied 0063. With a temporary unconfigured row, the rollback guard refused; cleanup left 63 ledger rows and zero guard rows. Typecheck, lint (0 errors, 1 inherited fast-refresh warning) and build passed.

A full PostgreSQL suite was attempted but did not pass: the first run found the 0063 schema allowlist omission and several unrelated database tests timed out in setup/cleanup hooks. The allowlist was fixed and its 13/13 test passed; the isolated corporate-change case still timed out in `beforeEach`/`afterEach` before business assertions while Docker Desktop was slow. The full run was stopped, so T05 stays `in-progress`. At the 0063 stage, selected-policy backfill preview/commit, authorized assignment, complete DB regression, live scheduler/role verification, production schema reconciliation and separate production migration/deployment authorization remained open. No production change or live send occurred.

## 2026-09-28 selected-policy attachment (local 0064)

An authenticated Admin can call `previewWorkItemPolicyAttachment` with one work item ID, one selected policy-version UUID and the work item's current version. The preview is read only and returns the exact start, warning and due timestamps plus a digest. It requires an active policy for the item's work type, an active calendar and an effective date no later than preview time. The start is the preview time, so adding a policy does not silently backdate an existing unconfigured item's SLA. Review the dates before using `attachWorkItemPolicy` with that exact preview; previews expire after 15 minutes. At the first 0064 commit there was no bulk mutation path or operator UI. The selected-policy candidate SQL above remains a read-only way to scope the work.

The apply endpoint accepts no actor ID. It uses the server-authenticated Admin and, within the transaction, locks and rechecks the current Admin profile and the selected policy/calendar rows. It locks the work item, checks its version/open status and recomputes the selected policy/calendar snapshot and digest. Migration 0064 permits only one all-null to complete SLA transition, with a matching immutable `work_item_sla_attachments` audit row inserted in the same transaction. The old immutable-snapshot rule still rejects direct edits, partial edits and later changes. Apply also writes a timeline event. A replay receives a stale/already-attached result; it does not attach a second policy.

RED: the selected-policy integration test found no repository preview method; a second RED found that a revoked Admin could still apply after preview. GREEN: the focused disposable-PostgreSQL test covers no-write preview, selected-policy mismatch, version staleness, revoked Admin, inactive policy, expired/tampered preview, direct SQL bypass rejection, one-time apply, immutable audit and replay rejection. The no-policy assignment integration test used the existing recommendation and assignment domain service to assign active same-team Staff without creating an SLA date. After the revoked-Admin hardening, the affected suite passed 5 files/36 tests; the focused attachment case also passed 1/1. Typecheck, lint (0 errors, 1 inherited warning) and Cloudflare preset build passed. Local `db:inspect` reported ledger current, no definition mismatch and 12/12 capabilities ready after 0064. The guarded rollback script `sql/2026-09-28-t05-policy-attachment-rollback.sql` refused a synthetic audit row in a rolled-back transaction; with an empty audit table, the 0064 rollback and normal reapply both passed on the disposable database. No production schema, send or deployment was changed. A new full PostgreSQL suite was attempted but stopped after several minutes without per-file results while Docker hooks were slow; it is not recorded as passing. Final focused attachment after the row-lock review passed 1/1; final typecheck, lint (0 errors, 1 inherited warning), formatting and Cloudflare preset build passed. T05 remains in progress pending complete regression and authenticated operator/runtime acceptance.

## 2026-09-28 Admin policy selection in the work queue

A no-policy work item now offers an Admin-only action on desktop and mobile. The dialog reads active policy versions for that exact work type and active calendar, with the current work-item version. It shows the selected version and calendar, then requests a read-only preview of the Hong Kong start, warning and due times. The apply control stays disabled until that preview succeeds. Changing selection or an apply error clears the preview, requiring a new review; successful apply refreshes the work queue. A failed policy read is shown as an error, never as an empty policy list. All three server actions independently require authenticated Admin authority, and the apply transaction rechecks the current Admin profile. The UI does not create or activate SLA policies.

RED: the policy-choice integration case found the repository method missing. GREEN: disposable-PostgreSQL selected-policy case passed 1/1 with the policy choice and audited apply; the combined repository/server/dialog/SLA/schema/work-queue suite passed 6 files/36 tests with a 60-second per-test ceiling after an earlier 30-second Docker timeout. Dialog interactions separately passed 3/3 for explicit preview before apply, failed preview and failed apply requiring a new preview. The React review found no new data-fetch waterfall or client-side authorization dependency; the server remains authoritative. This is local source and disposable DB evidence only. Authenticated Admin browser proof, full DB suite and production schema/deployment remain open.

The final `verify:firm --dry-run` initially failed its migration-schema gate because 0064's audit table was absent from the canonical `schema.sql`. The mirror now includes the 0063 all-null-or-complete SLA constraint and the 0064 audit/one-time transition trigger. Re-running the gate passed its local structure and migration checks: 38 reads, zero network calls and zero writes; provider/database/browser checks remain explicitly blocked. Its own tests passed 15/15. Final UI slice typecheck, lint (0 errors, 1 inherited warning), formatting and Cloudflare preset build passed; no deployment was run.
