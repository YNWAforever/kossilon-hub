# 2. Platform decisions

Date: 2026-11-09

## Status

Accepted for the pilot.

## Context

The product runs on two Vercel projects (production and demo) with one GitHub repository, while the codebase
still describes a single Cloudflare Worker and CI keeps a Worker build path. The pilot also needs answers for a
staging environment, signup model, language scope, release cadence and the 158 accumulated branches.

## Decisions

### Runtime

- **Vercel-only production.** `kossilon-hub` is the production runtime; `kossilon-hub-demo` is the guarded fixture
  demo. The Cloudflare Worker build path is retained in CI for parity/coverage but is **not** a live deployment.
  Do not describe it as production in docs (see `docs/runbooks/environments.md`).
- Revisit only with a concrete requirement (e.g. R2 Workers binding, edge latency) and a migration plan.

### Environments

| Environment | Definition                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- |
| production  | `main` → Vercel production project, auto-deploy + post-deploy smoke                             |
| demo        | `main` → demo project, guarded fixture build (`VITE_DEMO_FIXTURE_MODE` + project id), read-only |
| preview     | per-PR Vercel preview deployments; not authoritative                                            |
| local       | `npm run dev` with fixture demo; no external services                                           |
| CI          | GitHub Actions; Postgres service for integration tests; Worker path compiled                    |

**Staging** will be a Neon branch plus a Vercel preview/staging deployment with its own env values. It is not
provisioned yet; doing so needs provider approval. Acceptance: a release candidate can be exercised against a
copy of production data without touching production.

### Signup model

- **Invite-only.** No public self-service signup or trial. `/request-access` explains the process; a persisted
  request queue and admin invite flow are the onboarding increment (see `pilot-integrations.md`).

### Language

- **zh-HK for the authenticated app**; English at marketing `/en`, `/en/login`, `/en/request-access`.
- Full English app UI is deferred until a concrete user need; do not add half-translated screens.

### Release cadence

- Merge to `main` → CI → automatic production + demo deploy → post-deploy smoke.
- Roll back by instant rollback to the previous deployment in `docs/releases/deployments.json`; never force-push
  `main` (Lovable history constraint in `AGENTS.md`).
- Production env changes are separate, explicitly approved operations (see `pilot-integrations.md` §3).

### Security headers and auth rate limiting

- Baseline headers (`nosniff`, referrer policy, frame denial, permissions policy, HSTS in production) are always
  applied to HTML responses.
- CSP ships **report-only** by default (`SECURITY_HEADERS=enforce` to enforce). It includes `'unsafe-inline'` for
  scripts/styles because the framework hydrates from inline payloads; tightening it is a follow-up.
  Report-only violations POST to `/api/csp-report` and appear as structured `csp-violation` JSON in runtime logs
  (path + directive + origin only). Enforce only after that log has been clean for an observation window.
- Auth POSTs are throttled per instance (30/5 min per IP) as a speed bump. The durable layer is the platform
  edge/WAF; per-instance limits do not survive cold starts and are not shared across instances.

### Branch cleanup

- Inventory: **158 branches**, most `codex/*`/`claude/*` from completed work.
- Policy: delete only branches whose work is merged into `main` (or explicitly abandoned), in batches, with owner
  approval; never delete release/evidence branches. Audit/delete mechanics: [`../runbooks/branch-cleanup.md`](../runbooks/branch-cleanup.md).
  2026-11-09: 19 session branches deleted; remaining 150 branches = 94 safe / 2 open-PR / 53 unmerged / main (`codex/lineage-policy-*`, `codex/entry-ux-*` receipts are in
  git history already, so they may be deleted after the audit window). Do not force-push, rebase or rewrite
  published history.
- Before deletion: verify with `gh pr list --state merged` / `git merge-base --is-ancestor <branch> main`; keep
  `main`, `demo`, and any active release-candidate branch.

### Capability transparency

- `GET /api/capabilities` reports which integrations are provisioned by **binding name only** (no values, no
  provider probe). Anything `false` must not look enabled in the UI. `/operations` remains the authenticated
  detailed view.

## Consequences

- Docs, CI and runbooks must describe Vercel as production; the Worker path is labelled parity-only.
- No feature PR may change production env or add public signup.
- A staging environment and branch cleanup are operational projects, not feature work.

## Open decisions (owner)

`FIRM_ID`, `EMAIL_FROM`/`RESEND_FROM`, WhatsApp scope, request-access migration approval, optional Slack webhook —
listed in `pilot-integrations.md` §3.
