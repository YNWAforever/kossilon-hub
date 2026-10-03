# Oct4 R01 staging request package — local execution

Spec: docs/audit-remediation/oct3-execution-plan.md Task 1/4 and the Oct3 user assignment. Continue the completed local R00-R11 ledger; no repeated implementation or release closure.

## Global Constraints

Worktree starts at f5efd1283d00f02189e51ddf1e287d35a547360d. R01 candidate stays 257fb9d0be17525a305f38bd26001ad8fa45deb8, based on actual-live aa5d3cbddd895bca953b6eef7266ae1cc0b46215. Prepare a provider request, never execute it. No SQL, migration, compute, hosted role, Auth/domain, env, deployment, schedule or send mutation. Original50/frozen package/evidence bytes remain unchanged. Existing candidate has no main maintenance-trigger configuration; never document invented disable flags or simulated mode as genuine staging.

## Review Focus

- Exact parent/project identity, protected backup IDs and unassigned target IDs; no blind retry on unknown create.
- Cloned data/Auth/roles are sensitive; no_compute does not establish a usable isolated Auth runtime. Copied credentials/OAuth must be reviewed before compute/deploy.
- The branch request is one precise approval scope; acceptance template/LOCAL checks cannot grant Phase B, write a false provider receipt, or advance original UAT.
- Candidate diff/locks equal the reviewed isolated artifact; do not mix main schema or ordinary migration into R01.

## Task 1: prepare and verify the non-executing R01 staging package

Interfaces: known source project/branch/live/candidate consume into an exact create_branch JSON and not_run acceptance template; future provider-assigned IDs remain null. R03 full release/native scheduler remains a separate dependency.

- [ ] Prepare request.json, acceptance-template.json, operator runbook, immutable metadata/hash receipt.
- [ ] Validate exact tool payload, non-default/non-compute request, all current protected IDs, candidate hash/diff/lock contracts, original12 tracker IDs and ten unrelated rows unchanged.
- [ ] Run existing audit-staging-config tests; Expected: 7PASS/0FAIL/0SKIP. These are LOCAL existing contracts, not new RED or genuine Auth.
- [ ] Run local package verifier and git diff --check; Expected: package PASS/protected9/candidate locks and schema byte-unchanged/provider writes0/new genuine0. Run original verify:audit-release; Expected: exit0 with formal NO_GO.
- [ ] Update only R01/R03 rows and append status/environment/evidence delta with actual counts/precise owners.
- [ ] Commit the reviewable documentation slice, one fresh whole-range review, then exact-head original CI. Normal source merge only after all exact-head checks pass; source merge cannot authorize or run the request.

Ruling: this is documentation and a non-executing provider request, not a product behavior change; validate files/facts and reuse existing meaningful contracts rather than invent a RED product test or rerun unrelated local DB suites. Original exact-head CI gates remain.
