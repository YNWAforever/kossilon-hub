# Releases — deploy, verify, roll back

Production is the Vercel project `kossilon-hub`, auto-deployed from `main`. The hold that froze
deployments between 2026-10-02 and 2026-11-09 is gone (see `integration-audit/30-auto-deploy-restored.md`).
Canonical environment map: [`environments.md`](environments.md).

## The path a change takes

1. Open a PR against `main`; CI must be green (Node 22, Node 24, verify/build).
2. Merge. Vercel's Git integration creates a production deployment automatically.
3. The **Post-deploy smoke** workflow runs after CI on `main`. It polls
   `GET /api/version` for up to ten minutes until the live SHA equals the merge commit, then runs
   the production and demo checks. Deploy-triggered runs skip the scheduler health check: a
   pre-existing dead cron must not make every deploy look broken.
4. The same smoke job runs on a 15-minute schedule to monitor the live surface **and** the
   maintenance tick (`/api/health`; a manual dispatch can opt in with `include_health`). A failure
   fails the workflow; if the `SMOKE_ALERT_WEBHOOK` repository secret is set, the job also posts
   the failure there.

No hand deployment is required. Do not re-implement one.

## Answering “what is live?”

```powershell
curl.exe -s https://kossilon-hub.vercel.app/api/version
```

```json
{ "sha": "8020f1c…", "environment": "production", "dataMode": "production", "host": "kossilon-…" }
```

`GET /api/version` is read-only, uncached and contains no env values. The checked-in history lives in
`docs/releases/deployments.json`; refresh it after a notable deploy:

```powershell
$env:VERCEL_TOKEN = "<token>"
npm.cmd run record:deployment
```

The script queries Vercel for the current production list and preserves any manual `verified`
notes. Set the note (receipt, smoke run, rollback drill) for the new deployment in the file.

## Health and alerting

- `GET /api/health` returns `200` when the app is up and the five-minute maintenance tick is recent
  (`healthy` or `degraded`), and `503` when the scheduler has `never-observed`, went `stale` or is
  `failing`. The body carries the derived maintenance state and the runtime's database identity
  (`database`, `branchId`) — never raw rows or secrets — so "stale in which database?" is answerable
  from the response.
- The scheduled smoke workflow is the alerting loop. A red scheduled workflow is the signal; make
  sure GitHub notifications for failed workflows reach the operator.
- After rollbacks or deploys, check `/operations` during the next working day (daily pilot check).

## Roll back

Instant rollback to a known deployment ID from `docs/releases/deployments.json`:

```powershell
$env:VERCEL_TOKEN = "<token>"
curl.exe -X POST "https://api.vercel.com/v1/projects/prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC/rollback?teamId=team_qvzlsFmfCsLkgItSypqHjw3z" `
  -H "Authorization: Bearer $env:VERCEL_TOKEN" -H "Content-Type: application/json" `
  -d '{"deploymentId":"dpl_<id>"}'
```

Then confirm `/api/version` reports the rolled-back SHA and run:

```powershell
npm.cmd run smoke:prod
```

There is no schema or data migration to reverse for app-only releases. Database rollbacks are
covered by `docs/runbooks/backup-restore.md` and need explicit approval.

## Failure modes and what to do

| Symptom                                      | Meaning                                 | Action                                                                             |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Smoke fails “production did not reach SHA”   | Deploy failed or is stuck               | Check Vercel deployment logs; fix forward with a revert PR, or instant-rollback    |
| `/api/health` 503 `never-observed`           | Cron has never fired on this runtime/DB | Check project cron definitions; run one manual tick with `CRON_SECRET` and observe |
| `/api/health` 503 `stale`                    | Two ticks missed                        | Treat reminders/escalations as unrefreshed; read Worker logs per pilot runbook     |
| Login smoke fails but `/api/version` matches | Entry regression                        | Instant-rollback, then fix forward                                                 |

## Hard rules

- Never force-push `main` or rewrite pushed history (`AGENTS.md`, Lovable sync).
- Never change production env values as part of a feature PR; that is a separately approved change.
- Do not bypass the smoke workflow by deploying manually unless an incident requires it; record the
  deployment and run the smoke checks afterwards.
