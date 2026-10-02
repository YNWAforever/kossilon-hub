# Reviewed source integration and production hold — 2026-10-02

The user authorised checking and merging each green audit/security PR. Earlier
production restrictions still apply: this integration does not authorise DDL,
environment changes, live sends/invitations/grants or a production release.

## Deployment boundary

Authenticated read-only Vercel metadata confirms project
`prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC`, team
`team_qvzlsFmfCsLkgItSypqHjw3z`, GitHub repository
`YNWAforever/kossilon-hub`, production branch `main`, no ignored-build command.
The current production target is READY
`dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`, source
`aa5d3cbddd895bca953b6eef7266ae1cc0b46215`.

`vercel.json` now explicitly sets `git.deploymentEnabled.main=false`. Vercel's
[official Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
defines unspecified branches as enabled. Only `main` automatic Git deployments
are held; branch previews remain eligible. Existing live domains, hosted project
settings, secrets, database and scheduler declaration are unchanged. This source
setting does not prevent someone running an explicit production deployment: those
commands still require the separate release authority and gates below.

The official JSON schema was downloaded from
`https://openapi.vercel.sh/vercel.json` on 2026-10-02, SHA256
`1a53f8f1cdd40acac5bda6ce69003aaacb4456b39849bd826be0c016b9549fc4`.
The current configuration lacked the main hold (actual contract RED). The
downloaded full schema advertises draft04 but uses numeric `exclusiveMinimum`
in unrelated experimental trigger definitions, so the installed strict Ajv
rejects that meta-schema. Do not disable schema validation or call this a full
schema PASS. Validate the changed Git subtree against the official subtree and
assert the remainder is identical to the prior config; require an actual Vercel
preview to validate the complete config before merging. A successful preview is
not production or provider acceptance.

## Integration procedure

Use merge commits, retain every published branch/history and preserve worktrees.
Integrate the tail PR into its development base, then require all checks on that
base PR's new exact head before the next merge. Record each head, base, CI run,
preview and merge receipt. Never use admin bypass or a failing old preview.

B01 #109's reviewed patch is already copied in PR08. Integrate its published
history through the development stack; if dependency locks conflict, retain the
already tested B03 resolutions only after manifest/lock/source comparisons and
both actual audits. No downgrade, force-push or rewritten history.

At final main integration, verify the main-only deployment hold is in the exact
checked candidate, merge through its PR, run main CI and inspect Vercel's current
production target. It must remain on the observed deployment above; any unexpected
production change is a separate incident, never a successful source-only merge.

## Separate release / rollback

Formal release remains NO_GO: source50 migration IDs versus last-observed
production66 historical IDs is unresolved; original50 UAT remains19 LOCAL ONLY
pass /31blocked. Use release-checklist.md, schema-reconciliation.md and
rollback-runbook.md for exact owners, SQL approval, populated restore, fresh Auth,
scanner/R2/OCR/AI/WOZTELL/handoff/native tick and business acceptance.

After those gates and approval for an exact SHA/platform, remove only the
`git.deploymentEnabled.main=false` source hold in a reviewed change, keeping the
scheduler and other config. Removing it enables automatic main deployment; obtain
release authority before merging that change. For a controlled explicit deployment,
keep the hold and use only the separately approved deployment command/target.
Do not remove the hold merely because CI or preview is green.

Rollback of source integration uses an additive revert via PR and preserves the
hold until a separately approved compatible release. A source revert alone is not
proof of a database restore; never reset/reseed or replay the migration manifest.

## Sequential source integration checkpoint — 2026-10-02

T00–T23 / F01–F20 local source fixes and the B01–B03 security patches have been integrated through thirteen reviewed development PRs. PR #102 is the final main integration; its updated documentation head must pass fresh complete CI and preview before merging. Main still points to the audit baseline at this checkpoint. Final main merge, main-push CI and post-merge production observations will be recorded in the PR #102 delivery receipt.

Every row below has an actual successful exact-head Linux CI run: Node22.23.3, Bun1.4.2, real Postgres17, 230files / 2183PASS / 0fail / 0skip and installed Chrome DEMO12PASS. Both tracked dependency audits, lint, typecheck, build, local migration/repeat/seed, portability, offline and import gates passed. Browser/demo contracts are not fresh Auth/provider/business UAT.

| PR | Checked head | CI run | Merge commit |
| --- | --- | --- | --- |
| #114 | 34d0c13 | [36994563832](https://github.com/YNWAforever/kossilon-hub/actions/runs/36994563832) | fcb3193 |
| #115 | 49f6a56 | [36998115411](https://github.com/YNWAforever/kossilon-hub/actions/runs/36998115411) | fe55fd5 |
| #109 | 99692ce | [36998284847](https://github.com/YNWAforever/kossilon-hub/actions/runs/36998284847) | 4a63da4 |
| #113 | 4a63da4 | [36998952257](https://github.com/YNWAforever/kossilon-hub/actions/runs/36998952257) | b8e83ff |
| #112 | b8e83ff | [36999628605](https://github.com/YNWAforever/kossilon-hub/actions/runs/36999628605) | d39b037 |
| #111 | d39b037 | [37000255685](https://github.com/YNWAforever/kossilon-hub/actions/runs/37000255685) | 9c51760 |
| #110 | 9c51760 | [37000726356](https://github.com/YNWAforever/kossilon-hub/actions/runs/37000726356) | 3dcac40 |
| #108 | 3dcac40 | [37001349377](https://github.com/YNWAforever/kossilon-hub/actions/runs/37001349377) | 47ec725 |
| #107 | 47ec725 | [37001975820](https://github.com/YNWAforever/kossilon-hub/actions/runs/37001975820) | b686f2f |
| #106 | b686f2f | [37002584948](https://github.com/YNWAforever/kossilon-hub/actions/runs/37002584948) | 182c34a |
| #105 | 182c34a | [37003433984](https://github.com/YNWAforever/kossilon-hub/actions/runs/37003433984) | 1d36a9a |
| #104 | 1d36a9a | [37004011384](https://github.com/YNWAforever/kossilon-hub/actions/runs/37004011384) | 7da8d99 |
| #103 | 7da8d99 | [37004791720](https://github.com/YNWAforever/kossilon-hub/actions/runs/37004791720) | e5c76b5 |

Development integration head: `e5c76b50fefa12925570a7f62dd4480f17025d2d`. All fourteen original published heads remain ancestors; normal two-parent merge commits retain Lovable and audit/security history. Apart from PR114 before the source hold, each merged development tree equals the reviewed hold tree `e46e7b9b4dba8413e087fe742131164c255f6563`. Exact head/base/merge parents, raw log hashes and CI/preview URLs are in [the integration evidence](evidence/2026-10-02-source-integration.json).

PR07 #108's original vulnerable Start1.168.26 preview rejection is retained. Its new patched head3dcac40 passed CI37001349377 and the actual Vercel preview before merge47ec725; no provider security bypass was used. B01 #109's two lock conflicts were resolved by retaining the already reviewed B03 tree, with whole-tree equality and new exact-head CI, while retaining both published histories.

Authenticated read-only Vercel metadata observed `2026-10-02T11:56:02.3962021Z`: productionBranch=main, READY deployment `dpl_5Q1h65fxtUByWTJLTngCgsdvpmnT`, SHA `aa5d3cbddd895bca953b6eef7266ae1cc0b46215`, project `prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC`, Node24.x, 0 project deploy hooks. The only repository workflow is CI and contains no deployment command. Hosted settings/env/alias, production DB and recipients were not changed. The source main-only automatic Git deployment hold remains in vercel.json; it is not an ACL against manual deployment or evidence of runtime/native cron acceptance.

Original50 UAT remains19 LOCAL ONLY pass /31blocked /0not_run; no acceptance row was upgraded by integration. Source50 SQL IDs versus last-observed production66 historical IDs remain unreconciled; this integration adds0 migrations. Formal release remains NO_GO. DB, Auth, Storage/scanner, OCR/AI, Messaging, Filing/internal-server, Operations and business/staging owners retain their precise next actions in environment-matrix.md and release-checklist.md. Production facts above are metadata, not a new provider acceptance run.

The sole fresh B04 review returned0Critical/0Important/0Minor. Every declined behavior, executor ruling and cost is retained in [source-merge-review.md](source-merge-review.md). Full upstream schema meta-validation failed due to its draft mismatch; only the changed official Git subtree and exact unchanged remainder passed locally, followed by actual full-platform preview acceptance. Existing historical whitespace/evidence bytes were retained. No second review, admin bypass, force-push, squash, rebase, branch deletion or production operation was used.
