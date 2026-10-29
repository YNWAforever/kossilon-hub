# Native acceptance track: opened, prepare only

**原生驗收軌道已開啟，只準備。Native remains NO_GO.**

Refresh date: 2026-10-30 HKT. Original track-open date: 2026-10-27. This
packet continues the unapproved Native plan in
[../cosec-20261025-native-plan-fccb7c22/](../cosec-20261025-native-plan-fccb7c22/).
Prior demo/refresh authority was Willy's 2026-10-29 ~21:17 HKT instruction to
deploy demo then refresh the packet; that demo evidence is retained below.

Latest owner input: **Willy approved binding Gate A `selected_binding` to the QA
IDs via ComSec OS relay, 2026-10-30 ~01:45 HKT (UTC+8)**. QA status is
`selected_binding_approved_by_owner`; `selected_binding_approval=true` and
`all_selected_bindings_unchanged=false`. Scope is QA ID binding only, **not
Native/AP execution approval or deployment/production authorization**. Demo is
a recorded candidate only, not selected or preferred. Owner stays Willy (YNWAforever).

Of **19 top-level `selected_binding` values, 11 are recorded and 8 remain
`OWNER_REQUIRED`**. The recorded count includes `PROVIDER_EXPOSES_NO_DIGEST`
as a provider limitation, not an artifact digest. Required CI run IDs/results
remain `OWNER_REQUIRED`; ComSec OS reports main CI run `40892827294` GREEN at
`48371b2c` as evidence only. All 14 alias IDs, required-check policy, acceptable
checksum substitute/disposition, runtime DB/Auth URL linkage and data isolation
remain open. Native stays **NO_GO**, `execution_enabled=false`,
`approved_packet_ids=[]`; Gate B and all 13 APs stay `NOT_READY`.

## Owner-approved QA binding — execution remains blocked

| Field | Owner-selected QA value / evidence |
| --- | --- |
| Selected URL (`existing_isolated_url`) | `https://kossilon-cosec-qa-20261025.vercel.app` |
| Immutable deployment URL | `https://kossilon-cosec-qa-20261025-r9c1abtfo-ynwaforevers-projects.vercel.app` |
| Vercel project / team | `kossilon-cosec-qa-20261025` / `prj_5Q6rrOoH7voW4jEmxhhMqxz0s8qp`; `team_qvzlsFmfCsLkgItSypqHjw3z` / `ynwaforevers-projects` |
| Deployment / source | `dpl_82pmUQuebGV1cZ1Ly7pwNnW1h7RU`, `READY`, Git `main@48371b2c3cdd73e6faab60ec733896d5f3b71fa8` |
| Ready / runtime | 2026-10-30 01:52:31 HKT (`1793296351640` ms); `tanstack-start`, region `sin1`, target `production` inside QA only |
| Artifact checksum field | `PROVIDER_EXPOSES_NO_DIGEST` — provider limitation; acceptable checksum substitute/disposition `OWNER_REQUIRED` |
| Neon project | `broad-mouse-83325496` / `kossilon-cosec-isolated-20261025` |
| Branch / database / compute | `br-aged-flower-b3clbnr6` (`main`) / `kossilon_qa` / `ep-delicate-math-b35l9rdb` (`aws-ap-southeast-1`) |
| Auth tenant | `0f60a808-46df-46f3-8723-a47767ad48ba`, `better_auth` |
| Public Auth base URL | `https://ep-delicate-math-b35l9rdb.neonauth.c-4.ap-southeast-1.aws.neon.tech/kossilon_qa/auth` (shepherd-confirmed Auth config; runtime linkage not re-read) |
| Restricted roles | `app_role=NONE_EXISTS`, `readonly_observer_role=NONE_EXISTS`; only `kossilon_qa_owner` in earlier evidence; both selected role bindings `OWNER_REQUIRED`, owner role not selected |
| CI evidence only | [Run 40892827294](https://github.com/YNWAforever/kossilon-hub/actions/runs/40892827294), ComSec OS-reported GREEN at `48371b2c`; required CI run IDs/policy remain `OWNER_REQUIRED` |

Shepherd verified two read-only provider queries at 2026-10-30 ~01:52 HKT:
Vercel `get_deployment` and Neon `get_neon_auth_config`. These add to the prior
ten reads (Vercel 2, Neon 8): **12 cumulative reads, Vercel 3 / Neon 9**.
This docs editor made zero provider calls. This follow-up performs zero provider
mutations, deployments, role creations, DB connections or Native/AP actions.
QA runtime env DB/Auth URL linkage was **NOT re-read by shepherd**; it is
ComSec OS-reported only. The Neon read confirms the public Auth config/base URL,
which does not establish runtime DB URL linkage or data isolation.

QA aliases are reference hosts only: `kossilon-cosec-qa-20261025.vercel.app`,
`kossilon-cosec-qa-20261025-ynwaforevers-projects.vercel.app`, and
`kossilon-cosec-qa-20261025-git-main-ynwaforevers-projects.vercel.app`.
Machine evidence is `approval-request.json#/qa_binding_evidence`.

## Historical demo evidence — recorded candidate only, not selected or preferred

The following demo/CI evidence was supplied for an earlier refresh and is
retained as a candidate only. The prior provider-candidate pass recorded ten
read-only queries; the current QA follow-up adds two, as described above.
No URL visit, hosted CI query or AP execution occurs here. Full machine evidence: [approval-request.json](approval-request.json),
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

Demo `READY` and CI `SUCCESS` are historical observations. Demo DB/Auth values
remain recorded candidates only; QA IDs are now selected separately. Neither
stack has proved runtime linkage or data isolation. No artifact digest is
exposed; production `kossilon-hub` was not touched. This refresh deploys nothing.

Historical demo deployment `dpl_2YSZmZTxQzxPLsL3nUnUF6vLeeEY` and its fixed URL
remain in discovery and the original metadata receipt as **HISTORICAL /
SUPERSEDED**, not current bindings. Old receipts and older packets are unchanged.

## Baseline SHAs

| Pin | SHA | What it is |
| --- | --- | --- |
| Historical repository comparison/source pin | `d5183ba04cd510230e7a7f6b6b53c4529141aad6` | `main`; PR [#150](https://github.com/YNWAforever/kossilon-hub/pull/150) merge. Supplied demo deployment/source and CI evidence recorded above; Native unapproved |
| Current packet branch base | `48371b2c3cdd73e6faab60ec733896d5f3b71fa8` | `main` at start of `codex/native-gate-a-owner-required-20261029`; selected QA deployed source is `48371b2c`; historical repo/lock references stay `d5183ba` |
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
They do not transfer to `79ad0c04`, historical `ae9cbc19` / `d5183ba`, or selected QA `48371b2c`.
A later Native approval would have to name the candidate and exact scope.
This prepare-only packet retains historical demo/source evidence at `d5183ba`
and selects the approved QA IDs at `48371b2c`; neither approves execution or
proves a deployed artifact checksum.

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
`79ad0c04`, historical `ae9cbc19` / `d5183ba`, or selected QA `48371b2c`.

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
Repository references, historical demo evidence and current QA binding evidence
are in [APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md),
[gate-a-discovery.json](gate-a-discovery.json) and [approval-request.json](approval-request.json).
Counts refer to top-level selected values; selecting QA IDs does not settle
runtime linkage, isolation, checksum disposition or required CI policy.

| Field | Recorded value or remaining owner input |
| --- | --- |
| `environment_owner` | Recorded: Willy (YNWAforever), unchanged; no Native/AP approval |
| `existing_isolated_url` | Selected QA stable alias `https://kossilon-cosec-qa-20261025.vercel.app`; runtime DB/Auth linkage, isolation and Native origin/availability remain `OWNER_REQUIRED` |
| `runtime_project_id` | Selected QA `prj_5Q6rrOoH7voW4jEmxhhMqxz0s8qp` / `kossilon-cosec-qa-20261025`; team `team_qvzlsFmfCsLkgItSypqHjw3z` |
| `deployment_id` | Selected QA `dpl_82pmUQuebGV1cZ1Ly7pwNnW1h7RU`, shepherd-verified `READY`; immutable URL above; no deploy performed here |
| `observed_source_sha` | Selected QA Git `main@48371b2c3cdd73e6faab60ec733896d5f3b71fa8`; historical repo/lock references stay pinned to `d5183ba` |
| `observed_artifact_checksum` | Recorded `PROVIDER_EXPOSES_NO_DIGEST`, a provider limitation, not a digest; acceptable checksum substitute/disposition remains `OWNER_REQUIRED` |
| `required_ci_run_ids_and_results` | `OWNER_REQUIRED`; main CI `40892827294` GREEN at `48371b2c` is evidence only, not required-check policy or required CI run selection |
| `artifact_sbom_and_dependency_disposition` | `OWNER_REQUIRED`: deployed SBOM or verified deployed lockfile identity and accepted dependency disposition; historical repo hashes do not close this |
| `db_provider_project_id` | Selected `broad-mouse-83325496` / `kossilon-cosec-isolated-20261025`; runtime DB URL linkage and isolation remain open |
| `db_branch_id` | Selected `br-aged-flower-b3clbnr6` (`main`); runtime linkage, data lineage/disposability and access policy remain open |
| `database_name` | Selected `kossilon_qa`; owner role is not selected as an app or observer role |
| `app_role` | `OWNER_REQUIRED`: `NONE_EXISTS`, only `kossilon_qa_owner` previously observed; restricted role creation/approval required later |
| `readonly_observer_role` | `OWNER_REQUIRED`: `NONE_EXISTS`; restricted read-only role and verified privileges required later |
| `server_identity_binding` | `OWNER_REQUIRED`: host/proxy/port binding, migration ledger, physical catalog, checksum and effective privileges; API exposes no port, no 5432 assumption |
| `auth_tenant_id` | Selected `0f60a808-46df-46f3-8723-a47767ad48ba`; shepherd confirms public Auth base URL only; runtime env linkage and data isolation remain open |
| `role_identity_manifest` | `OWNER_REQUIRED`: all 14 actual alias IDs, user/profile/team/revision mapping and existing QA session method; no seed/test IDs substituted |
| `network_allowlist` | `OWNER_REQUIRED`: exact approved hosts for later slice; `approved_hosts=[]`, reference hosts grant no access |
| `read_only_cost_ceiling_and_expiry_hkt` | `OWNER_REQUIRED`: currency, amount, HKT window/expiry and approver; no old budget reused |
| `cleanup_manifest_and_disposition` | Recorded `RETAIN_ONLY`, unchanged; no delete/reset, no session/resource created here; future exact cleanup/session IDs require a later packet |

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
| AP-00 | Eleven recorded values (including no-digest limitation); eight top-level fields/14 alias IDs `OWNER_REQUIRED`; isolation unproven; Gate B `NOT_READY`; no AP approval |
| AP-01 | QA deployment/Auth config recorded; checksum substitute, SBOM, required CI runs/policy, runtime linkage/isolation, roles/manifest, allowlist and budget/expiry open; no AP-01 execution |
| AP-02 | No reviewed fixture driver or exact IDs; QA database selected but disposability unproved |
| AP-03 | No bound staff session, core fixture or proved isolated Native runtime. QA binding approval does not establish that journey |
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

## 2026-10-30 QA binding validation and remaining gaps

The selected QA deployed source is `48371b2c3cdd73e6faab60ec733896d5f3b71fa8`.
The 26 historical repository source/blob/SHA256 references and both lockfile
hashes stay pinned to `d5183ba`; they are not evidence of QA artifact bytes.
The packet branch base remains `48371b2c`; this follow-up starts from
`5c646e5561e1959f51d0f9331362d393b6b6e6ad` and commits locally without a push.
`verification-report.json` fingerprints the six other packet files after edits.

The eight top-level `OWNER_REQUIRED` fields are required CI run IDs/results,
artifact SBOM/dependency disposition, app role, read-only observer role, server
identity, role identity manifest, network allowlist, and cost ceiling/expiry.
All 14 alias IDs, required-check policy, acceptable checksum substitute or
disposition, runtime DB/Auth URL linkage, data isolation and Native
origin/availability remain open. The only QA role observed in earlier evidence
is `kossilon_qa_owner`; it is not selected. Both restricted roles are `NONE_EXISTS`.
No role inventory was re-read in this two-query follow-up.

Demo remains a recorded candidate only, not selected or preferred, with
`UNPROVEN` runtime DB/Auth linkage. Historical QA CLI/Git deployments from
2026-10-29 remain in the candidate block as superseded evidence; the current
selected QA Git deployment is `dpl_82pmUQuebGV1cZ1Ly7pwNnW1h7RU` at `48371b2c`.
There is no requirement to deploy the historical comparison SHA `d5183ba`.

Vercel Git deployment exposes no artifact digest. The selected checksum field
records `PROVIDER_EXPOSES_NO_DIGEST` as a limitation only. Historical demo
source SHA, CI run `40755216699` and repository lock hashes remain **LABELLED
SUBSTITUTES ONLY, explicitly not a deployed artifact digest or approval**.
QA source SHA and main CI run `40892827294` GREEN likewise do not resolve
artifact checksum disposition or required CI run selection/policy. Demo `/files`
404 remains ComSec OS-reported only and was not re-run.

Shepherd verified two read-only provider queries at 2026-10-30 ~01:52 HKT:
Vercel `get_deployment` and Neon `get_neon_auth_config`. These add to the prior
ten reads (Vercel 2, Neon 8): **12 cumulative reads, Vercel 3 / Neon 9**.
This docs editor made zero provider calls. This follow-up performs zero provider
mutations, deployments, role creations, DB connections or Native/AP actions.
QA runtime env DB/Auth URL linkage was **NOT re-read by shepherd**; it is
ComSec OS-reported only. The Neon read confirms the public Auth config/base URL,
which does not establish runtime DB URL linkage or data isolation.

Historical matrix **70 BLOCKED / 114 NOT_RUN / 0 PASS** and Gate B are unchanged.
Local validation parses all JSON and checks cross-file selected values/counts,
approval boundaries, evidence references, SHA256 fingerprints, Markdown links,
secret patterns, docs-only scope and `git diff --check`. The repository's
read-only `npm run verify:audit-release` checks the general audit ledger; it
has no Native runtime authority. No AP is approved or executed.
