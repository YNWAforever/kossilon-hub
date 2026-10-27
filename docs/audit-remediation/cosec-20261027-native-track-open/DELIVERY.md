# Native acceptance track: opened, prepare only

**原生驗收軌道已開啟，只準備。Native remains NO_GO.**

Hong Kong date 2026-10-27. This packet refreshes the unapproved plan in
[../cosec-20261025-native-plan-fccb7c22/](../cosec-20261025-native-plan-fccb7c22/).
It does not approve any AP, does not execute Native, and does not fill a binding.

`execution_enabled` is `false`. `approved_packet_ids` is `[]`. Every binding value
below is `NOT_READY`.

## Baseline SHAs

| Pin | SHA | What it is |
| --- | --- | --- |
| Current product candidate | `79ad0c04da892ec03601f11c12d82fcc84039b31` | Draft PR [#149](https://github.com/YNWAforever/kossilon-hub/pull/149), branch `cursor/reminder-upload-protocol-942a`, subject `docs: record staff recovery finalize resume evidence` |
| PR #147 head | `fcce28d6b5483bd78bc31c8f32590325f3152d98` | Draft PR [#147](https://github.com/YNWAforever/kossilon-hub/pull/147), branch `codex/cosec-20261023`. Ancestor of #149. Merge-base of #149 and #148 |
| PR #148 head | `713f4a3d1fddc41905b0c3243230185fc5bc18e3` | Draft PR [#148](https://github.com/YNWAforever/kossilon-hub/pull/148), branch `cursor/protocol-review-reminder-upload-3c21`. One docs commit whose parent is the #147 head. Not an ancestor of #149 |
| Previous Native source candidate | `4d63818fe2562146f85e9a7b9917d8f0eb58f4c1` | `fix(admin): hand over case responsibilities before staff disable`. Ancestor of #149. Superseded as the candidate |
| Previous delivery named by that plan | `531887acce5468f7321a3a2919a7afaa20dedac1` | `docs(audit): complete UC186 same-source local build gate`. Ancestor of #149. Two commits after `4d63818` |

Commit counts on this history: `4d63818..531887ac` = 2, `531887ac..fcce28d6` = 55,
`fcce28d6..79ad0c04` = 6, `4d63818..79ad0c04` = 63.

#148 and #149 share the protocol-review files under
`docs/audit-remediation/cosec-20261027-protocol-review-reminder-upload/` with no
diff. #149 then adds the reminder-command and staff-recovery implementation
(`74007730` through `79ad0c04`). #148 stops at the design note.

The previous plan's runtime conclusions stay attached to `4d63818` / `531887ac`.
They do not transfer to `79ad0c04`. A later approval has to name `79ad0c04`, or a
newer SHA that a human pins after reading the diff. This file does not observe a
deployed artifact of either SHA.

## What was re-read

The prior packet still has empty bindings, `execution_enabled: false`, and
`approved_packet_ids: []`. Its `approval-request.json` SHA256 is
`20ad7c792f6a23b37b478005ea14ba4c065f69a29cd1f806ac64a730f5f5db96`.
That file is left unchanged.

Historical matrix file
`../cosec-20261025-native-plan-fccb7c22/acceptance-results.csv`
SHA256 `287bafceb836b4e42b96cfbc006ee83dd9ac65900100d1ba199f93631537e6fb`,
184 rows. Column `native_result`: **BLOCKED 70 / NOT_RUN 114 / PASS 0**.
This open-track packet recounts that file. It does not re-run the matrix on
`79ad0c04`.

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

This prepare pass performed no Native Auth, HTTP, RLS, browser, provider, CI,
scheduler, or restore action. It created no resources, ran no migration, sent no
message, took no payment, merged nothing, and deployed nothing. It did not query
hosted CI, so no run is recorded here as green or red. Missing run IDs stay
`NOT_READY`.

## What Willy supplies for AP-00

The fill-in form is [APPROVAL-CHECKLIST.md](APPROVAL-CHECKLIST.md). Machine
fields are [approval-request.json](approval-request.json). Secrets stay in the
existing secret store or an operator session. Do not paste secrets into git or
chat.

**Gate A — required before the first slice can be proposed for approval.** All
are `NOT_READY` today.

| Field | What to supply |
| --- | --- |
| `environment_owner` | Named owner of the already-isolated target |
| `existing_isolated_url` | URL of an environment that already exists. A missing URL stays `NOT_READY`. This packet does not ask for a new deploy |
| `runtime_project_id` | Project or runtime ID of that environment |
| `deployment_id` | Deployment ID whose artifact will be read |
| `observed_source_sha` | SHA the deployment actually runs. It must equal the approved git candidate. The candidate to compare against is `79ad0c04da892ec03601f11c12d82fcc84039b31` until a human pins a later SHA |
| `observed_artifact_checksum` | Checksum of that deployed artifact |
| `required_ci_run_ids_and_results` | Required check names, run IDs, and results for that same head |
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
| `cleanup_manifest_and_disposition` | Retain-only disposition for sessions opened by that slice. Exact disposable IDs, if any, come from the owner |

Gate A aliases, each actual Auth ID `NOT_READY`: `ADMIN_PRIMARY`,
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
| AP-00 | Every binding field is `NOT_READY`. No owner, URL, CI run, database, Auth tenant, storage, fixture, cost ceiling, or expiry was supplied |
| AP-01 | Gate A is empty. No metadata read, session, or HTTP call was made |
| AP-02 | No reviewed fixture driver, no exact IDs, no disposable database target |
| AP-03 | No bound staff session, no core fixture, no same-SHA deployed runtime. Local Today and case edits are not that journey |
| AP-04 | Storage, object prefix, scanner sandbox, and real scan receipts are `NOT_READY`. No payment was taken |
| AP-05 | `STAFF_SOURCE` and `RACE_SOURCE_01`–`06` have no Auth IDs. Disabling seven QA profiles is not approved |
| AP-06 | The 104-obligation fixture and `PAGING_SOURCE` are unbound |
| AP-07 | No approved calendar hash or expected dates. No fault clone or fault runtime. UC134 remains historical `NOT_RUN` |
| AP-08 | Scale fixture manifest and no-dispatch policy are unbound |
| AP-09 | Destinations, models, corpus, currency, and spend ceiling are blank. Approved provider calls and approved spend are 0 |
| AP-10 | No device, browser, or network profile. AP-08 data does not exist. No performance number is claimed |
| AP-11 | No scheduler owner, job IDs, backup ID, or restore target. No tick was observed |
| AP-12 | No exact cleanup IDs. Disposition stays retain. This prepare pass created no resource to dispose |

Detail: [blockers.md](blockers.md).

## What cannot start until bindings exist

AP-01-RO-1 and every later AP. Also blocked on this packet: Native Auth, HTTP,
RLS, browser, provider, hosted CI execution, scheduler observation, restore,
resource creation, migrations, messages, payments, merge, and production
Vercel or Neon deploy.

Historical local evidence, including the UC186 slice at `4d63818` / `531887ac`
and the reminder and recovery work on #149, stays local. It does not close the
70 / 114 / 0 gate.

## Recommended next human step

Willy fills Gate A outside this repo, then returns only the non-secret
identifiers he is willing to commit. He leaves Gate B as `NOT_READY` until the
packet that needs it. He does not mark an AP approved by filling the table.

Until those identifiers exist, the Native gate stays **NO_GO** and no executor
should start AP-01-RO-1.
