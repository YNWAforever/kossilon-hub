# T05 work queue staff identity and SLA display — 2026-09-27

RED reproduction: `sla.audit-regression.test.ts` failed all three named T05 scenarios because `workQueuePersonLabel` and `deriveSlaDisplay` were missing. The live audit observed two owner choices with the same first eight UUID characters, and rows already past their displayed due date still reported `SLA None` and zero breaches. The latter alone does not prove the scheduler is broken.

Local changes:

- Queue owner and assignment suggestions now use the server-authorized staff profile plus user and team names. Recommendation SQL requires active staff profiles and active users. Inactive existing owners retain an inactive label but are excluded from new suggestions. A missing profile is explicitly identified; the full user ID is only a diagnostic title.
- Desktop and mobile owner cells use one renderer. Unassigned and unresolved owner are distinct. Focused SSR coverage checks both layouts.
- SLA badges and the breached queue derive an effective state from the immutable policy snapshot and current time, so a missed scheduler tick cannot make an expired deadline look on track. Persisted acknowledgement remains visible until a later unrecorded due threshold. The maintenance run query reads the most recent scheduled run with a non-null `escalations` pass; a run without that pass does not count. The UI shows when the scheduler last completed that pass, or that no run was recorded.
- The UI labels work and SLA due dates separately. The current `work_items` schema has only `sla_due_at`, so work due is honestly shown as not set. No filing deadline has been relabeled as a work deadline.

Limits and next dependency:

- Current `work_items` columns `sla_policy_version_id`, `sla_started_at`, `sla_warning_at`, and `sla_due_at` are all non-null; `ensureWorkItemForEvent` rejects a missing policy. The no-policy presentation contract is tested, but creating and assigning a policy-setup work item is not yet implemented. It needs a schema and domain transition that preserves immutable snapshots, recommendation authorization, and escalation behavior. This is an outstanding T05 requirement, not a claimed production fix.
- No production scheduler invocation or approved live role session was available. Production migrations 0021–0033 remain absent, including the `maintenance_runs` table used for freshness. Current local behavior is not production evidence.

Read-only backfill preview for a **selected existing policy version** (bind `$1` as the selected UUID in an authorized local or staged database; this does not update rows):

```sql
select w.id, w.company_id, w.work_type, w.sla_policy_version_id,
       w.sla_due_at, w.escalation_state,
       (w.status in ('open','in_progress','blocked')
        and w.sla_due_at <= now()
        and w.sla_breached_at is null) as needs_escalation_review
from work_items w
where w.sla_policy_version_id = $1::uuid
order by w.sla_due_at, w.id;
```

Do not apply a backfill from this preview without a selected policy, matching domain migration, and separately authorized database change. No production write, send, or deployment was performed.

Local verification: RED 3/3 named T05 scenarios; focused domain/route/PostgreSQL 10/10; full PostgreSQL-backed suite 185 files/1,744 tests passed; lint exit 0 with one existing fast-refresh warning; typecheck exit 0; verify:firm dry-run exit 0 with live provider/binding blocks; build exit 0. A test/build import-protection failure introduced during this slice was fixed by moving the pure label helper to the shared types module; the failing route suite and build were rerun successfully.
