# Kossilon Hub / ComSec OS

Company-secretary operations platform for Hong Kong firms: annual returns, WhatsApp chasing,
document review, payments and SLAs.

- **Production:** <https://kossilon-hub.vercel.app> — Vercel project `kossilon-hub`, deployed
  automatically from `main` (after CI), Neon Postgres + Neon Auth.
- **Demo:** <https://kossilon-hub-demo.vercel.app> — the read-only **fixture demo**, guarded to the
  demo Vercel project. “Try the demo” → identity picker → simulated data (nothing is saved).
- **Canonical environment map:** [`docs/runbooks/environments.md`](docs/runbooks/environments.md).

## Local development

```powershell
npm.cmd install
npm.cmd run dev          # fixture demo mode locally by default? see environments.md
npm.cmd run test         # Vitest (node + jsdom projects)
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run format
```

The app is **not** Next.js and **not** Supabase. Read `CLAUDE.md` for architecture and
`AGENTS.md` for the git history constraint (never force-push or rebase pushed commits).

## Before changing runtime behaviour

Run the offline firm-deployment gate. It reads binding **names** only, performs no network calls
and prints no secret values:

```powershell
npm.cmd run verify:firm -- --dry-run
```

`BLOCKED` lines for database/storage/WhatsApp/email/backups are expected offline; they are not
failures. `PASS route-data-mode` and the other local checks must pass.

## Release and observability

- Merging to `main` triggers the **Post-deploy smoke** workflow after CI. It waits for
  `/api/version` to report the merge SHA, then checks production and demo entry, SEO, auth-proxy
  and health endpoints. A schedule runs the same checks every 15 minutes.
- `GET /api/version` — live commit, environment and data mode (no secrets).
- `GET /api/health` — app + five-minute maintenance tick; `503` when the scheduler never ran,
  went stale or failed.
- Deployment history: [`docs/releases/deployments.json`](docs/releases/deployments.json).
- How to deploy, verify and roll back: [`docs/runbooks/releases.md`](docs/runbooks/releases.md).

## Runtime flags

| Flag                                              | Where             | Meaning                                                                                     |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `VITE_AUTH_METHODS`                               | production        | Comma-separated `password`, `magic-link`, `google`. Production currently sets all three.    |
| `VITE_ENABLE_DEMO_AUTH`                           | local dev only    | Fixture demo in a non-production build.                                                     |
| `VITE_DEMO_FIXTURE_MODE` + `VITE_DEMO_PROJECT_ID` | demo project only | Guarded fixture demo in a built deployment; `npm run build:demo` refuses any other project. |
| `VITE_ENABLE_NEON_AUTH_DEMO`                      | validator only    | No runtime consumer; do not use it to change UI.                                            |

Demo mode is **read-only** by decision: [`docs/adr/0001-demo-mode-is-read-only.md`](docs/adr/0001-demo-mode-is-read-only.md).

## Data and migrations

- Forward-only SQL in `db/migrations/`; never edit a migration that has run.
- `npm run db:migrate` against any non-local `DATABASE_URL` requires **explicit approval**.
- The production migration ledger is a 66-row historical release reconciled by receipt; see
  `docs/runbooks/firm-deployment.md` and `integration-audit/20-production-release-receipt-2026-11-08.md`.

## Project layout

```
src/routes/        file-based routes; __root.tsx is the only layout; routeTree.gen.ts is generated
src/features/<n>/  vertical slice: types, repository (SQL), server-fns, domain logic, components
src/lib/           demo stores + mock data + shared UI utilities
src/server/        db client, runtime env, version, health and the auth/magic-link handlers
src/server.ts      server entry: auth proxy, robots/sitemap, version/health, webhooks, SSR handler
db/migrations/     numbered forward-only SQL
scripts/           validators, release gates, smoke and deployment-record scripts
docs/runbooks/     environments, releases, deployment, pilot operations, backups, Neon Auth demo
docs/superpowers/  per-feature design specs and implementation plans
```
