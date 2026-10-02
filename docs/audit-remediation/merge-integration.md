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
