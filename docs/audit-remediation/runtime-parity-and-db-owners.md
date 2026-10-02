# B06 / T01, T22, T23 — runtime parity and DB owner evidence

2026-10-03 Hong Kong. **Production remains NO_GO.** Provider access in this supplement
is metadata-only SELECT; no DB/env/deployment/scheduler/send/invite/grant write.
Original50 UAT remains19 LOCAL ONLY pass /31 blocked /0not_run.

## Verified integrated source

PRs #102–#116 are merged with normal commits. Main checkpoint
`da792232879d3ac626c02ea464da3bd3adb459c8` has full
[CI37031330748](https://github.com/YNWAforever/kossilon-hub/actions/runs/37031330748)
SUCCESS:231files/2200PASS/0skip, actualPostgres17/Node22.23.3/Bun1.4.2,
ChromeDEMO12PASS and all existing gates. PR116 records the exact merge parents,
raw-log hashes and unchanged production alias. The new B06 branch adds CI coverage;
its verification is separate from that baseline.

## Node24 coverage

The observed Vercel production project is Node24.x, while prior CI covered Node22.
The existing full workflow now has mandatory isolated Node22/24 legs, each with its
own Postgres17 service, unchanged full tests, both audits, portability install,
browser/parser/build/dev/cron/offline/ledger gates and15-minute timeout. A selected-
major guard fails on a wrong executable. `fail-fast=false` retains both outcomes.
Stable required-check name `verify` is an always-run aggregate that requires the
matrix result exactly `success`; failure/cancelled/skipped each refuse with exit1.
No repository protection or production runtime settings are changed.

Actual localNode24.18.0/npm11.16.0/Bun1.4.2 preflight is recorded in
[runtime evidence](evidence/2026-10-03-runtime-parity-preflight.json):wrong-major
guard RED→GREEN, aggregate refusal, lint/typecheck/build/dev imports/offline/ledger/
compiledcron PASS, local ChromeDEMO12PASS43.6s. This does not verify Vercel functions,
Auth, provider integration or native scheduled ticks.

Initial Windows full run retained231files/2199PASS1FAIL0skip414.18s:Today totals/
navigation still showed loading at assertion. Unchanged standalone TodayNode22 and
Node24 both4PASS; cause not stably reproduced, no claimed fix/timeout relaxation.
A local4-worker full repeat retained2190PASS10FAIL0skip695.81s, including120sNAR100
timeout, cleanup-hook timeout and subsequent read assertions seeing synthetic NAR
companies. After that run the inspected local DB retained100 synthetic NAR companies
and72 total cases; no active test sessions remained. Original DB is retained for
diagnosis, not reset. A new uniquely owned local fixture isolates the100-row scenario.
These failures do not disappear because a focused or later run passes.

Exact draft/final CI outcomes are recorded in
[PR117](https://github.com/YNWAforever/kossilon-hub/pull/117), including both runtime
legs and the stable aggregate. Local Windows diagnostics and actual Linux outcomes
must remain distinguishable. No full-run success is assumed in this checkpoint.

## Read-only DB facts

Exact target: `red-morning-00331124` / `br-muddy-mountain-aov8bbku` / `neondb`.
Snapshots2026-10-02T16:20:29.583Z and16:30:43.728Z are2026-10-03 HK00:20/00:30.
Raw metadata and actual second SELECT are preserved in
[owner metadata](evidence/2026-10-03-db-owner-metadata.json) and
[ACL/policy/dependency evidence](evidence/2026-10-03-db-owner-permissions.json).
No business rows, Auth secrets or connection strings were retrieved.

| Table                        | PostgreSQL technical owner | RLS / FORCE RLS |
| ---------------------------- | -------------------------- | --------------- |
| hk_funding_schema_migrations | neondb_owner               | false / false   |
| personal_workspaces          | neondb_owner               | true / true     |
| sync_changes                 | neondb_owner               | true / true     |
| sync_conflicts               | neondb_owner               | true / true     |
| sync_entities                | neondb_owner               | true / true     |
| sync_field_revisions         | neondb_owner               | true / true     |
| sync_operation_receipts      | neondb_owner               | true / true     |

- All89 public tables have technical owner `neondb_owner`. All7 extra relation ACLs
  are null; expanded default table ACLs show the owner grantee. Null ACL is a default,
  not proof of no privilege. Observed column ACLs and that owner's default-ACL rows
  are empty; implicit ownership, role inheritance and shared credentials remain.
- Six RLS policies use `app.auth_user_id`; policy rolePUBLIC is not a table privilege
  grant. The catalogue contains18 distinct referenced-table/dependent-object pairs,
  including six existing FKs and RLS policy references. It cannot exhaustively find
  dynamic SQL, external applications or all consumers.
- The connector's observed role is `neondb_owner`, nonsuperuser but CREATE ROLE,
  CREATE DB, BYPASSRLS and CREATE onpublic. The connection can bypass RLS; this does
  not establish the application's DATABASE_URL role or an authorised access model.
  Nine public functions are owned byneondb_owner and37 bycloud_admin; none observed
  SECURITY DEFINER. This is not proof of exclusive function-DDL ownership.
- Direct incoming owner-role membership edges were empty in the first query. This
  does not prove no other privileged operator, indirect membership or shared account.

Technical ownership is now observed; **logical business/service attribution remains
unknown**. Preserve all7 tables and their policies/data. No grant/revoke, policy change,
table retirement or application-authority relaxation is included.

## Narrowed blockers, owner and next concrete action

| Gate                     | Owner / next action                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extra-table attribution  | DB/data owners identify each logical application and accountable business owner; use the dated catalogue facts, not role names alone.                                                                                 |
| Permissions / DDL freeze | DB/release operator identify actual application-role and credential consumers plus all DDL operators; prove sole approved DDL owner/freeze and advisory-lock cooperation. No privilege change inferred.               |
| Lineage / recovery       | App/DB owners review separate actual release receipt versus expected IDs; retain unknown applied hashes and strict migrator refusal. Separately authorise genuine provider clone/recovery/restore/workload rehearsal. |
| Runtime                  | Both real Linux runtime CI legs plus exact preview metadata; deployed Node24/functions/topology and three native scheduler ticks still require approved staging/platform access.                                      |
| Windows diagnostics      | Developer reproduce retained Today timing/NAR100 timeout and distinguish environment/fixture effects; no timeout, listing bound or test skip relaxation.                                                              |
| Original31 UAT           | Auth/business/provider owners supply approved isolated origin, existing controlled-account references and genuine R2/scanner/OCR-AI/WOZTELL/handoff evidence. Local fixtures/CI do not certify runtime UAT.           |

The B05 frozen guarded SQL, original66 ledger preservation, separate honest receipt,
exact catalogue guard and rollback remain unchanged. B06 owner facts do not clear
source-history divergence or authorise production execution.

### B06 verified CI checkpoint

Exact source `54c8bd09b68adf514535caf3a86477c961095d50`, [CI37037803079](https://github.com/YNWAforever/kossilon-hub/actions/runs/37037803079): Linux Node22.23.3 and Node24.21.0 full legs and stable `verify` aggregate SUCCESS. Each leg ran231files/2200PASS/0fail/0skip with separate actualPostgres17 and ChromeDEMO12PASS, retaining every original gate and both zero-finding dependency audits. Node22 suite285.56s/browser35.3s; Node24 suite200.62s/browser30.4s. Full step outcomes and raw-log SHA256 are in `evidence/2026-10-03-runtime-parity-ci.json`.

Linux Node24.21.0 differs from localWindows24.18.0; neither establishes the deployed24.x minor, functions, provider integrations or original runtime UAT. A new uniquely owned localDB NAR100 run passed at the original120s limit:1PASS/21name-filtered/73.91s test duration. Cleanup left3referencecompanies/3referencecases/0syntheticNARcompanies. Both earlier Windows full failures and their original database/logs remain retained, not claimed fixed.

Final documentation head, fresh whole-branch review, final-head/main CI and preview/live metadata are recorded in PR117 after they actually occur. Original50UAT remains19LOCALONLYpass/31blocked/0not_run; providerWrites0, productionNO_GO and the business-owner/actual-app-role/DDL-freeze/recovery gates remain.
