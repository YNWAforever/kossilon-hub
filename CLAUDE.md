# Kossilon Hub — Project Instructions

Company-secretary operations platform for Hong Kong firms (annual returns, WhatsApp
chasing, document review, payments, SLA work queue). Single Cloudflare Worker.

**Not** Next.js and **not** Supabase — ignore the Next.js/Supabase defaults in `~/CLAUDE.md`.
See `AGENTS.md` for the Lovable git-history constraint (never force-push / rebase pushed commits).

## Tech Stack

TanStack Start 1.x (+ TanStack Router file routing, TanStack Query 5) · React 19 · Vite 8 ·
TypeScript 5.8 strict · Tailwind v4 (CSS-only `@theme` in `src/styles.css`) · shadcn/ui
(new-york, slate) · Zod 3 · Postgres via `postgres` (postgres.js, raw SQL — no ORM) ·
Neon Auth via `better-auth/client` · Cloudflare Workers + R2 + Hyperdrive · Vitest 4 · Bun

## Build & Run

- Dev: `npm run dev` · Build: `npm run build` · Preview: `npm run preview`
- Lint: `npm run lint` · Format: `npm run format` (Prettier, 100 cols, double quotes)
- Test: `npm run test` (Vitest; no separate vitest config — Vite config is reused)
- Pre-deploy gates: `npm run check:production-imports` then `npm run verify:firm -- --dry-run`
- DB: `npm run db:migrate` (Bun) — **requires explicit approval for any non-local `DATABASE_URL`**

## The Two-Mode Split (most important thing to know)

Every feature exists twice, selected by router context `dataMode` (`src/features/runtime/data-mode.ts`):

- **demo** — `VITE_ENABLE_DEMO_AUTH=true` in a non-production build. Data lives in
  browser stores under `src/lib/*-store.ts` (`useSyncExternalStore` + module-level state).
- **production** — anything else. Data comes from server functions in
  `src/features/*/server-fns.ts` → repository → Postgres.

Routes branch with `const { dataMode } = Route.useRouteContext()`.
`scripts/check-production-route-imports.ts` fails the build if a route imports a **mutation**
from a demo store (read-only helpers are allowed). Add new mutations to that script's
`PROTECTED_STORE_MUTATIONS` map.

## Project Structure

```
src/routes/          file-based routes; __root.tsx is the only layout. routeTree.gen.ts is generated
src/features/<name>/ vertical slice: types.ts, repository.ts (SQL), server-fns.ts, domain logic, components/
src/lib/             demo stores + mock data + shared UI utils
src/server/          db/client.ts, runtime-env.ts, provider-mode.ts, cron.ts, db/schema.sql
src/server.ts        Worker fetch entry — auth proxy routing, then TanStack SSR handler
src/start.ts         CSRF + error request middleware; defaultSsr: false
db/migrations/       numbered forward-only SQL
scripts/             offline validators/gates + db migrate/seed (run with node --experimental-strip-types or bun)
docs/runbooks/       deployment, quarantine, backup, Neon Auth demo
docs/superpowers/    per-feature design specs and implementation plans
```

## Request Lifecycle (production mode)

`src/server.ts` fetch → `/api/auth/*`, `/api/webhooks/neon-auth`, `/auth/magic-link/confirm`
short-circuit to the Neon Auth proxy; everything else → TanStack Start SSR →
`__root.beforeLoad` calls `getAuthenticatedActor()` and redirects to `/login` on failure →
route component calls a server fn → `createServerFn().validator(zodSchema).handler()` →
`requireActor()`/`requireStaffActor()` resolves the `AuthenticatedActor` from `staff_profiles`
or `client_company_memberships` → `assertStaffAccess` / `assertClientCompanyAccess` →
repository executes tagged-template SQL → repository `close()` in a `finally`.

## Conventions

- **Files** kebab-case; server functions always `server-fns.ts`; tests co-located as `*.test.ts(x)`.
- **Server fns**: every one validates with a Zod schema. Never trust client input for identity —
  derive the actor from the request.
- **Testability**: domain logic is pure and dependency-injected (`dependencies: { repository }`,
  `*ForActor()` functions). Server fns are thin wrappers around those. Follow this — it is why
  468 of 500 tests run with no database. The other 32 are repository integration tests behind
  `describe.skipIf(!databaseUrl)`; they only run when `DATABASE_URL` is set.
- **Route-dir tests** must be prefixed with `-` (e.g. `-settings.interaction.test.tsx`) or the
  router tries to treat them as routes.
- **Errors**: throw `Error` with a `Forbidden: ` / `Unauthorized: ` prefix for authz. Never swallow.
- **Secrets**: validators and verifiers report binding *names* only, never values, and perform no
  network calls. Keep it that way. `.env*` is gitignored except `.env.example` (which holds no values).
- **Imports**: `@/*` → `src/*`. Never import `server-only` (see the ESLint rule); use
  `*.server.ts` or `createServerOnlyFn` instead.
- **Deps**: `bunfig.toml` blocks packages published <24h ago; ask before adding an exclusion.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `style:`).
  Branches `codex/<feature>`. Merge via PR.
- **Workflow**: features start as a spec + plan in `docs/superpowers/`, then land TDD-style
  (`test:` commits alongside `feat:`).
