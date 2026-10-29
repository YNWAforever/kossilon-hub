# Native acceptance track: opened, prepare only

**原生驗收軌道已開啟，只準備。Native remains NO_GO.**

Refresh date: 2026-10-29 HKT. Original track-open date: 2026-10-27. This
packet continues the unapproved plan in
[../cosec-20261025-native-plan-fccb7c22/](../cosec-20261025-native-plan-fccb7c22/).
Prior demo/refresh authority: **Willy Approve 2026-10-29 ~21:17 HKT — "deploy
demo then brief Codex packet refresh only"**. Current authority permits recording
provider-observed `OWNER_REQUIRED` candidates only; no binding selection or approval.

Latest owner input: **Willy approved the Gate A QA target preference via
ComSec OS relay, 2026-10-29 ~22:57 HKT (UTC+8)**. QA is
`preferred_target_not_approved`; demo remains a recorded candidate, not preferred.
This is target preference only, **not a `selected_binding` approval**. Both stacks
remain `RECORDED_FOR_PACKET_ONLY_NOT_APPROVED`; no binding or AP is approved.

**Prepare-only. Native NO_GO. execution_enabled=false. No AP authorized.
No Ready/merge/Native ask.** `approved_packet_ids` stays `[]`. Seven supplied
binding values are recorded for this packet only; twelve top-level Gate A
fields and all 14 alias IDs remain `OWNER_REQUIRED`. DB/Auth/data isolation
and required-check policy also need owner confirmation. Gate B and all APs
stay `NOT_READY`.

## Supplied verified demo deployment evidence — not Native approval

The following demo/CI evidence was supplied for the prior refresh, which made
no provider request. The current pass separately records ten read-only provider
queries in `provider_candidate_evidence`; it visits no demo URL, queries no
hosted CI and runs no AP. Full machine evidence: [approval-request.json](approval-request.json),
`demo_deploy_evidence`.

| Field | Supplied value |
| --- | --- |
| Team | `team_qvzlsFmfCsLkgItSypqHjw3z` / `ynwaforevers-projects` |
| Project | `kossilon-hub-demo` / `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm` — **DEMO ONLY**; not in Vercel `linkedProjects`, but Git-source `create_deployment` succeeded |
| Deployment | `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c`, state `READY`, target `production` **inside the demo project only** |
| URL | `https://kossilon-hub-demo-4oxc6afow-ynwaforevers-projects.vercel.app` |
| Aliases | `kossilon-hub-demo.vercel.app`, `kossilon-hub-demo-ynwaforevers-projects.vercel.app`, `kossilon-hub-demo-git-main-ynwaforevers-projects.vercel.app` |
| Observed source / comparison candidate | `d5183ba04cd510230e7a7f6b6b53c4529141aad6`, `githubCommitRef=main` |
| CI on same SHA | [GitHub Actions run 40755216699](https://github.com/YNWAforever/kossilon-hub/actions/runs/40755216699), `SUCCESS`; `Node22` / `Node24` / `verify` `SUCCESS` |
| Accountable human/business owner | Willy (YNWAforever), confirmed by Willy; no email supplied |
| Cleanup | `RETAIN_ONLY` — no delete/reset |

Provider `READY` and CI `SUCCESS` are supplied observations, not Native/AP
approval. The demo exposes no artifact digest. DB endpoint and Auth tenant
candidates are now recorded separately, with selection/isolation still
`OWNER_REQUIRED`. The production Vercel project `kossilon-hub` was not touched.
This refresh performed no deployment.

Historical demo deployment `dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY` and its fixed URL
remain in discovery and the original metadata receipt as **HISTORICAL /
SUPERSEDED**, not current bindings. Old receipts and older packets are unchanged.

## Baseline SHAs

| Pin | SHA | What it is |
| --- | --- | --- |
| Comparison source candidate | `d5183ba04cd510230e7a7f6b6b53c4529141aad6` | `main`; PR [#150](https://github.com/YNWAforever/kossilon-hub/pull/150) merge. Supplied demo deployment/source and CI evidence recorded above; Native unapproved |
| Current packet branch base | `48371b2c3cdd73e6faab60ec733896d5f3b71fa8` | `main` at start of `codex/native-gate-a-owner-required-20261029`; source comparison stays `d5183ba` |
| Previous comparison candidate (historical / superseded) | `ae9cbc195878235d72c8d0f1d1e49d0f3ad3e5c0` | PR [#149](https://github.com/YNWAforever/kossilon-hub/pull/149) squash merge; prior packet comparison only |
| Original track-open candidate (historical) | `79ad0c04da892ec03601f11c12d82fcc84039b31` | Then-draft PR #149, branch `cursor/reminder-upload-protocol-942a`, subject `docs: record staff recovery finalize resume evidence` |
| PR #147 head | `fcce28d6b5483bd78bc31c8f32590325f3152d98` | Draft PR [#147](https://github.com/YNWAforever/kossilon-hub/pull/147), branch `codex/cosec-20261023`. Ancestor of #149. Merge-base of #149 and #148 |
| PR #148 head | `713f4a3d1fddc41905b0c3243230185fc5bc18e3` | Draft PR [#148](https://github.com/YNWAforever/kossilon-hub/pull/148), branch `cursor/protocol-review-reminder-upload-3c21`. One docs commit whose parent is the #147 head. Not an ancestor of #149 |
| Previous Native source candidate | `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1` | `fix(admin): hand over case responsibilities before staff disable`. Ancestor of #149. Superseded as the candidate |
| Previous delivery named by that plan | `531887acce5468f7321a3a2919a7afaa20dedac1` | `docs(audit): complete UC186 same-source local build gate`. Ancestor of #149. Two commits after `4d63818` |

The #147/#148 states in the table and the ancestry comparisons describe the
original track-open history against `79ad0c04`, not the squash-merged base.
Commit counts on that historical branch: `4d63818..531887ac` = 2, `531887ac..fcce28d6` = 55,
`fcce28d6..79ad0c04` = 6, `4d63818..79ad0c04` = 63.

#148 and #149 share the protocol-review files under
`docs/audit-remediation/cosec-20261027-protocol-review-reminder-upload/` with no
diff. #149 then adds the reminder-command and staff-recovery implementation
(`74007730` through `79ad0c04`). #148 stops at the design note.

The previous plan's runtime conclusions stay attached to `4d63818` / `531887ac`.
They do not transfer to `79ad0c04`, historical `ae9cbc19`, or current `d5183ba`.
A later Native approval would have to name the candidate and exact scope.
This prepare-only packet records supplied demo source/CI evidence at `d5183ba`;
repinning and recording observations do not approve execution or prove the
deployed artifact checksum.

## Original track-open evidence (historical)

The prior packet still has empty bindings, `execution_enabled: false`, and
`approved_packet_ids: []`. Its `approval-request.json` SHA256 is
`20ad7c792f6a23b37b478005ea14ba4c065f69a29cd1f806ac64a730f5f5db96`.
That file is left unchanged.

Historical matrix file
`../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv`
SHA256 `287bafceb836b4e42b96cfbc006ee83dd9ac65900100d1ba199f93631537e6fb`,
184 rows. Column `native_result`: **BLOCKED 70 / NOT_RUN 114 / PASS 0**.
This open-track packet recounts that file. It does not re-run the matrix on
`79ad0c04`, historical `ae9cbc19`, or current `d5183ba`.

UC map only (100 rows, a subset of the 184):
`native-scenario-map.csv` SHA256
`f50954198c73f2366e5c8905a2da083bc90c0ac3107f9d541dc9e534dacc2c13`,
native_result BLOCKED 41 / NOT_RUN 59, `plan_status` all
`PLANNED_NOT_APPROVED_NOT_EXECUTED`, `execution_evidence` all `NONE_THIS_RUN`.
Every UC still requires AP-00 and names AP-12 for cleanup. Do not add 41 to 70.

`4d63818..79ad0c04` changes 41 files under `src/` and 458 under `docs/`. It does
not change `db/`, `src/server/`, `src/server.ts`, Wrangler config, package
manifests, or `.github` workflows. The `src/` delta is annual-return reminder and
case UI, document recovery and preview, Today / work-queue / documents / payments
routes, and bulk selection. Those local slices do not supply an isolation URL, a
CI run, a database target, an Auth tenant, storage, fixtures, or a cost ceiling.

The original prepare pass performed no Native Auth, HTTP, RLS, browser, provider, CI,
scheduler, or restore action. It created no resources, ran no migration, sent no
message, took no payment, merged nothing, and deployed nothing. It did not query
hosted CI. That historical absence of a run is now superseded for comparison
by the supplied run 40755216699 above; it is not a CI query or rerun by this refresh.

## What Willy supplies for AP-00

The fill-in form is [APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md). Machine
fields are [approval-request.json](approval-request.json). Secrets stay in the
existing secret store or an operator session. Do not paste secrets into git or
chat.

**Gate A — required before the first slice can be proposed for approval.**
Repository discovery and supplied demo evidence are recorded in
[APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md) and
[gate-a-discovery.json](gate-a-discovery.json). The table distinguishes supplied
values from remaining owner inputs. Counts refer to top-level fields only;
recording a demo URL/project or CI result does not settle isolation or CI policy.

| Field | What to supply |
| --- | --- |
| `environment_owner` | Recorded: Willy (YNWAforever), confirmed human/business owner |
| `existing_isolated_url` | Recorded: `https://kossilon-hub-demo-4oxc6afow-ynwaforevers-projects.vercel.app`; `OWNER_REQUIRED` for DB/Auth/data isolation and approved Native origin/availability |
| `runtime_project_id` | Recorded: demo `prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`; DB/Auth/data isolation remains `OWNER_REQUIRED` |
| `deployment_id` | Recorded: demo `dpl_J9ZwsCtnJ99f3N4RWsBYgXMdhR1c`; checksum and isolation remain `OWNER_REQUIRED` |
| `observed_source_sha` | Recorded from supplied evidence: `d5183ba04cd510230e7a7f6b6b53c4529141aad6`, the new comparison candidate; no Native approval |
| `observed_artifact_checksum` | Observed `PROVIDER_EXPOSES_NO_DIGEST`; status/selected binding stay `OWNER_REQUIRED`. Source/CI/lockfile substitutes are explicitly not a deployed digest or approval |
| `required_ci_run_ids_and_results` | Recorded: 40755216699 `SUCCESS`, `Node22` / `Node24` / `verify`, same SHA; required-check policy remains `OWNER_REQUIRED` |
| `artifact_sbom_and_dependency_disposition` | SBOM or lockfile identity and the accepted dependency disposition for that artifact |
| `db_provider_project_id` | Provider project ID of the disposable or dedicated QA database |
| `db_branch_id` | Branch ID |
| `database_name` | Database name |
| `app_role` | Application role used for identity and denial checks |
| `readonly_observer_role` | Read-only observer role. A superuser read is not this role |
| `server_identity_binding` | Host, proxy, and port binding, plus migration ledger, physical catalog, checksum, and privileges |
| `auth_tenant_id` | Auth tenant ID |
| `role_identity_manifest` | Immutable Auth ID to internal user, profile, team, and revision for each Gate A alias, and the method that opens an existing QA session |
| `network_allowlist` | Approved app, Auth, storage, and provider-sandbox hosts only |
| `read_only_cost_ceiling_and_expiry_hkt` | Currency, amount, window, and expiry in HKT for the read-only slice |
| `cleanup_manifest_and_disposition` | Recorded: `RETAIN_ONLY` (no delete/reset); this refresh opened no session; future exact IDs require a later packet |

Gate A aliases, each actual Auth ID `OWNER_REQUIRED`: `ADMIN_PRIMARY`,
`ADMIN_RECOVERY`, `STAFF_SOURCE`, `STAFF_OWNER`, `STAFF_REVIEWER`, `MANAGER_A`,
`STAFF_B`, `MANAGER_B`, `CLIENT_A`, `CLIENT_B`, `STAFF_NO_TEAM`,
`AUTH_NO_PROFILE`, `STAFF_INACTIVE`, `STAFF_NO_SKILL`.

**Gate B — still on the AP-00 form, still `NOT_READY`, not inputs to the first slice.**

| Field | Later packet it blocks |
| --- | --- |
| `storage_account_and_bucket_id`, `approved_object_prefix`, `scanner_sandbox_id` | AP-04 and AP-09 |
| `fixture_driver_diff_and_physical_row_budget`, `actual_fixture_ids_and_versions` | AP-02, then AP-03 and AP-05 |
| `approved_calendar_version_hash_and_expected_dates` | AP-07 (UC134 stays historical `NOT_RUN`) |
| `fault_clone_id`, `fault_runtime_url_and_artifact_binding` | AP-07 |
| `scheduler_owner_runtime_and_allowed_job_ids` | AP-11 |
| `backup_id_and_restore_target`, `restore_runtime_url_and_artifact_binding` | AP-11 |
| `provider_destinations_models_cost_and_receipt_contracts` | AP-09 |
| `physical_device_browser_and_network_profile` | AP-10 |
| `RACE_SOURCE_01` through `RACE_SOURCE_06` | AP-05 |
| `PAGING_SOURCE` | AP-06 |

Filling Gate A does not approve execution. A later human packet would have to set
`execution_enabled` to `true` and list packet IDs. This packet forbids that edit.

## First executable slice, not started

**AP-01-RO-1 — read-only deployment, CI, and catalog identity preflight.**

It becomes eligible for a separate approval only after Gate A is filled and a
human approves that slice alone. This packet leaves it unstarted and unauthorized.

Intended scope, once those conditions exist:

1. Read deployment metadata and compare source SHA plus artifact checksum to the approved candidate.
2. Read the named required CI runs for that same head. A missing run stays unbound.
3. With the named read-only app role and observer, read migration ledger, catalog identity, and privileges.
4. Open existing QA sessions for the Gate A aliases and read role and team denial.
5. Stop.

Any GET with a known sync or write stays off this slice. The slice includes no
migration, no account creation, no invitation, no magic-link request, no fixture
write, and no continuation into AP-02.

## Still NOT_READY

| AP | Why it stays NOT_READY |
| --- | --- |
| AP-00 | Seven supplied values recorded; twelve top-level fields/14 alias IDs `OWNER_REQUIRED`; isolation unproven; Gate B `NOT_READY`; no AP approval |
| AP-01 | Demo deployment/source/CI recorded; no artifact checksum, proved isolation, DB/Auth/role manifest, allowlist or budget/expiry; no AP-01 execution |
| AP-02 | No reviewed fixture driver, no exact IDs, no disposable database target |
| AP-03 | No bound staff session, core fixture or proved isolated Native runtime. Supplied same-SHA demo deployment is not that journey |
| AP-04 | Storage, object prefix, scanner sandbox, and real scan receipts are `NOT_READY`. No payment was taken |
| AP-05 | `STAFF_SOURCE` and `RACE_SOURCE_01`–`06` have no Auth IDs. Disabling seven QA profiles is not approved |
| AP-06 | The 104-obligation fixture and `PAGING_SOURCE` are unbound |
| AP-07 | No approved calendar hash or expected dates. No fault clone or fault runtime. UC134 remains historical `NOT_RUN` |
| AP-08 | Scale fixture manifest and no-dispatch policy are unbound |
| AP-09 | Destinations, models, corpus, currency, and spend ceiling are blank. Approved provider calls and approved spend are 0 |
| AP-10 | No device, browser, or network profile. AP-08 data does not exist. No performance number is claimed |
| AP-11 | No scheduler owner, job IDs, backup ID, or restore target. No tick was observed |
| AP-12 | `RETAIN_ONLY`, no delete/reset; future exact session IDs unbound. This refresh created no resource to dispose |

Detail: [blockers.md](blockers.md).

## What cannot start until bindings exist

AP-01-RO-1 and every later AP. Also blocked on this packet: Native Auth, HTTP,
RLS, browser, provider, hosted CI execution, scheduler observation, restore,
resource creation, migrations, messages, payments, merge, and production
Vercel or Neon deploy.

Historical local evidence, including the UC186 slice at `4d63818` / `531887ac`
and the reminder and recovery work on #149, stays local. It does not close the
70 / 114 / 0 gate.

## Remaining owner inputs — no approval request

Remaining Gate A fields are listed in [APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md).
Secret material remains outside git. Gate B stays `NOT_READY` until the packet
that needs it; completing the form does not approve an AP.

Until those identifiers exist, the Native gate stays **NO_GO** and no executor
should start AP-01-RO-1.

## Historical repo-only Gate A follow-up for #150

Original discovery reviewed #150 head `165e8cd53d9f85221e06d7b8bfb705f1681b2db7`.
After restacking, sources were rechecked at #150 head
`51b9a2ebaff965726963cbeb6b7146e860248f90` on the then-comparison candidate
`ae9cbc19` (now **HISTORICAL / SUPERSEDED**). That pass filled historical demo
and Neon references, workflow/check names, both lockfile hashes, binding names,
flags, code paths and role-manifest columns. Its original 19 unresolved fields
and retain-only proposal are historical counters, not current binding counts.

## 2026-10-29 packet refresh validation and remaining gaps

The comparison/source pin is `d5183ba04cd510230e7a7f6b6b53c4529141aad6`;
the current packet branch base is `48371b2c3cdd73e6faab60ec733896d5f3b71fa8`.
All 26 discovery source paths, git blobs and SHA256 values, both candidate
lockfiles and source-reference JSON pointers were locally rechecked at that
source pin. All 26 pinned source bytes match the previous fingerprints. The
current packet branch matches 24 of those sources; its two lockfiles differ.
The existing lockfile hashes remain pinned to `d5183ba` and are not repinned to
the current branch. Prior demo/CI evidence has separate provenance in
`demo_deploy_evidence`. Current candidate observations
have provenance in `provider_candidate_evidence`, sourced from the shepherd
file gathered 2026-10-29 ~22:55 HKT (UTC+8); demo deployment metadata was
corroborated by `get_deployment`, while hosted CI was not queried.
`verification-report.json` fingerprints the current six other packet files.

Twelve top-level fields remain `OWNER_REQUIRED`: deployed artifact checksum;
artifact SBOM/dependency disposition; DB provider project, usable isolated branch
and database name; application and read-only observer roles; server identity;
Auth tenant; role identity manifest/existing QA session method; network allowlist;
and cost ceiling/currency/HKT window/expiry/approver. All 14 actual alias IDs,
DB/Auth/data isolation and required-check policy remain `OWNER_REQUIRED`.
No repo/packet/lockfile hash is treated as a deployed artifact checksum.
Historical Neon `red-morning-00331124`, `br-fragrant-sunset-aosoylhr` /
`kossilon-r01-staging-20261004`, and `neondb` remain historical references only.
No Neon resource was created. Eight read-only Neon metadata queries are now
recorded; no DB connection, role creation or binding selection occurred.

This pass records ten read-only provider metadata queries (Vercel 2, Neon 8),
with no Native/Auth/HTTP/DB/RLS/browser/hosted CI/scheduler/restore or AP execution.
No provider state, runtime setting, production project, older packet or
product source was changed. GitHub push and draft PR are delivery operations,
separate from Native execution. Baseline zero-query counters refer to the prior
refresh. Current discovery and provider-evidence counters increase from 0 to 10,
with per-method counts;
ComSec-reported `/files` 404 and QA env match are not additional queries.
Historical matrix 70/114/0 and Gate B remain unchanged. Local validation checks
JSON/invariants, base-pinned sources/locks,
historical files, relative Markdown links, basic secret patterns, docs-only
scope and `git diff --check`. No Ready/merge/Native ask is made.

## OWNER_REQUIRED candidate evidence pass — 2026-10-29 HKT (UTC+8)

The demo and QA stacks are both `RECORDED_FOR_PACKET_ONLY_NOT_APPROVED`.
QA is `preferred_target_not_approved` per Willy via ComSec OS relay
2026-10-29 ~22:57 HKT (UTC+8); demo remains recorded, not preferred.
This target preference is not a `selected_binding` approval.
Full metadata and provenance are in `approval-request.json#/provider_candidate_evidence`,
with field observations in [gate-a-discovery.json](gate-a-discovery.json) and
candidate/host tables in [APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md). No
selected binding changed: seven earlier values remain recorded, twelve fields
and all fourteen alias IDs remain `OWNER_REQUIRED`, as do isolation, required-check
policy, allowlist and cost ceiling. Baseline is unchanged as a historical receipt.

Demo runtime-to-DB/Auth URL linkage is `UNPROVEN` (sensitive env unread).
QA `NEON_AUTH_URL` match proof is reported by ComSec OS; shepherd did not re-read
env, and no DB URL link or data isolation is inferred. QA latest CLI deployment
has no SHA; its Git deployment is at `4d63818`, with no verified `d5183ba`
deployment. Both branches expose only their owner role: required app/observer
roles are `NONE_EXISTS` and need later creation/approval by Willy. Endpoint
hosts are candidates only; API exposes no port and port stays `OWNER_REQUIRED`.

QA latest deploys are **not verified at `d5183ba`**: the latest CLI deploy
exposes no SHA, and the recorded Git deploy is at `4d63818`, not `d5183ba`.
A QA deployment at source SHA `d5183ba04cd510230e7a7f6b6b53c4529141aad6`,
port, restricted app/observer roles, all 14 alias IDs, allowlist, cost ceiling
and expiry, `required_check_policy`, and selected bindings all remain
`OWNER_REQUIRED`. Target preference does not authorize a deployment; this
follow-up deploys nothing and leaves every `selected_binding` and count unchanged.

Demo checksum observation is `PROVIDER_EXPOSES_NO_DIGEST`. `get_deployment`
exposes no digest; Git deploy `/files` 404 is ComSec OS-reported, not re-run.
Source SHA `d5183ba04cd510230e7a7f6b6b53c4529141aad6`, existing CI run
`40755216699` and both existing lockfile hashes are **LABELLED SUBSTITUTES ONLY,
explicitly not a deployed artifact digest or approval**. Checksum status/selected
binding remain `OWNER_REQUIRED` awaiting Willy's evidence/disposition decision.
No AP was executed. Native `NO_GO`, `execution_enabled=false`, and
`approved_packet_ids=[]` remain unchanged. This pass commits locally; no push.
