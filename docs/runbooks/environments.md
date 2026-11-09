# Environments — canonical map

Single source of truth for what runs where. If a runbook disagrees, this file and the live
`/api/version` response win. No secret values are recorded here.

## Surfaces

| Surface        | Vercel / host                                                                                                                        | Source      | Data mode                 | Data / auth                                                                                                                   | Deploy                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Production** | project `kossilon-hub` (`prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC`), team `team_qvzlsFmfCsLkgItSypqHjw3z`; <https://kossilon-hub.vercel.app> | `main`      | production                | Neon Postgres (project `red-morning-00331124`, branch `br-muddy-mountain-aov8bbku`) + Neon Auth                               | Git auto-deploy from `main`, gated by CI + post-deploy smoke |
| **Demo**       | project `kossilon-hub-demo` (`prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm`); <https://kossilon-hub-demo.vercel.app>                             | `main`      | demo (fixture, read-only) | Browser fixtures; demo project has `VITE_DEMO_FIXTURE_MODE=true` + `VITE_DEMO_PROJECT_ID`, build command `npm run build:demo` | Git auto-deploy from `main` (fixture build)                  |
| **Preview**    | one deployment per PR in both projects                                                                                               | PR branch   | project dependent         | preview env values; treat as non-authoritative                                                                                | Vercel preview review                                        |
| **Local dev**  | `npm run dev`                                                                                                                        | worktree    | demo fixtures             | `VITE_ENABLE_DEMO_AUTH=true`, no external services                                                                            | n/a                                                          |
| **CI**         | GitHub Actions                                                                                                                       | PR / `main` | test                      | Postgres service for integration tests                                                                                        | Node 22 + Node 24                                            |

The **Cloudflare Worker build path** is retained in CI for parity/coverage only. It is **not** the
live runtime; production is Vercel. The `scheduled`-hook code remains so a Worker deployment would
still work, but no Worker is deployed today.

## Production environment (names only)

`DATABASE_URL`, `NEON_AUTH_URL`, `NEON_AUTH_COOKIE_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `RESEND_API_KEY`, `CRON_SECRET`,
`MAINTENANCE_SCHEDULER_OWNER=vercel`, `VITE_AUTH_METHODS`.

Known gaps as of 2026-11-09 (tracked in `integration-audit/32-next-development-plan.md`):
`FIRM_ID`, `EMAIL_FROM`/`RESEND_FROM`, WOZTELL bindings, malware-scanner configuration, backups
evidence. Do not “fix” these by copying values into docs; they are provider/provisioning decisions.

**Maintenance verification (2026-11-09, decided):** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` and
`x-vercel-cron-schedule`; the maintenance endpoint verifies both and records a cron run as
`platformTriggerVerified: true` when the schedule header matches this deployment's `*/5 * * * *`. `/api/health`
reports `scheduler.evidence` and stays 503 on a dead/failing cron. Deployment without that header remains
`http-candidate` and is not counted as verified. See [`pilot-integrations.md`](pilot-integrations.md) §4.

## Flags

| Flag                          | Production                   | Demo            | Local  | Notes                                           |
| ----------------------------- | ---------------------------- | --------------- | ------ | ----------------------------------------------- |
| `VITE_AUTH_METHODS`           | `password,magic-link,google` | unset           | unset  | controls sign-in methods; unset = all           |
| `VITE_ENABLE_DEMO_AUTH`       | must be unset/false          | unset           | `true` | fixture demo only in a non-production build     |
| `VITE_DEMO_FIXTURE_MODE`      | must be unset                | `true`          | unset  | enabling on production is a build-guard failure |
| `VITE_DEMO_PROJECT_ID`        | must be unset                | demo project id | unset  | second half of the fixture guard                |
| `VITE_ENABLE_NEON_AUTH_DEMO`  | unset                        | unset           | unset  | accepted by validator, no runtime consumer      |
| `MAINTENANCE_SCHEDULER_OWNER` | `vercel`                     | n/a             | n/a    | the Worker path checks for `cloudflare`         |

## Where the facts come from

- Live commit/environment/data mode: `GET https://kossilon-hub.vercel.app/api/version`
- App + scheduler health: `GET /api/health` (`503` = scheduler never ran / stale / failing)
- Provisioned integrations (binding names only): `GET /api/capabilities`
- Deployment history: `docs/releases/deployments.json` (regenerate with `npm run record:deployment`)
- Platform decisions: [`../adr/0002-platform-decisions.md`](../adr/0002-platform-decisions.md)
- Vercel project settings: Vercel dashboard/API; the deployment record and version endpoint are the
  reviewed copies.

## Change authority

- Production env, Neon Auth providers, WOZTELL/templates, R2, scanner, backups: **explicit approval**
  per change (`docs/runbooks/firm-deployment.md`).
- Demo project flags/build command: demo-only, may be changed for verification with a recorded
  rollback (see `integration-audit/28-gated-demo-entry.md`).
- Never set demo/fixture flags on the production project.
