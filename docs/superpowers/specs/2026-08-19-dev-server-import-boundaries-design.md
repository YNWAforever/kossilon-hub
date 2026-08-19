# Dev-Server Import-Boundary Fix Design

## Overview

`npm run dev` currently fails to render any page. Visiting almost any route triggers TanStack
Start's import-protection plugin: `[import-protection] Import denied in client environment —
Denied by file pattern: **/server/**`. This was discovered during a manual smoke check of an
unrelated `settings.tsx` change and reported with a full repro trace, a correct general diagnosis
(some server-fns modules statically import server-only code instead of lazy-loading it), and a
request to investigate the true scope and fix it.

**Root cause, confirmed by live reproduction (not just reading source):** several `*server-fns.ts`
modules statically `import` their own repository (or another feature's repository, or the request
helper) at module top level, instead of dynamically `import()`-ing it inside a lazy-loaded handler.
Since `src/routeTree.gen.ts` eagerly imports every route file, and several routes import these
modules, the entire server-only dependency chain (repository → `@/server/db/client`) becomes
statically reachable from the client's module graph. Vite's dev server conservatively treats this
as a live violation and throws (`config.effectiveBehavior`, read directly from
`node_modules/@tanstack/start-plugin-core`'s plugin source, defaults dev to a stricter check than
build).

**Confirmed NOT a production/CI risk.** `npm run build` was run directly and exits 0 with zero
`import-protection` mentions — Rollup's tree-shaking and the Start compiler's client/server
code-splitting definitively prove these imports are dead in the actual client bundle, which the
plugin's own post-transform "edge liveness" check accepts as proof and doesn't report. CI's existing
`Build` step (`.github/workflows/ci.yml`) is unaffected and already green. This is a **dev-server-only**
defect that blocks manual browser-based smoke testing — a real, recurring cost this session (every
UI-touching task on `annual-return`, `whatsapp`, or `settings` has been unable to verify itself live
in a browser), but not a shipped-code correctness problem.

**Confirmed pre-existing, unrelated to recent work.** `git diff main -- src/features/annual-return/server-fns.ts`
is empty at the point this was discovered — the file most responsible predates the checklist-templates
work (and the P0/P1 work before it) entirely.

## Full scope (confirmed by a complete codebase sweep, not just following the original error trace)

Every file exporting a `createServerFn`, and whether it already uses the safe lazy pattern:

| File | Status | Reachable from |
|---|---|---|
| `documents/server-fns.ts` | ✅ Already correct | — |
| `checklist-templates/server-fns.ts` | ✅ Already correct | — |
| `work-items/server-fns.ts` | ✅ Already correct | — |
| `notifications/runtime-dispatch.ts` | ✅ Already correct | — |
| `auth/neon-auth-rpc.ts` | ✅ Already correct (inline `await import()` per-handler, no separate wrapper needed — equally valid) | — |
| `annual-return/server-fns.ts` | ❌ Defective | `documents.tsx`, `payments.tsx`, `portal.tsx` — actively breaking |
| `annual-return/client-portal-server-fns.ts` | ❌ Defective | `portal.tsx` — actively breaking |
| `annual-return/evidence-server-fns.ts` | ❌ Defective | `documents.tsx`, `payments.tsx` — actively breaking |
| `annual-return/follow-up-server-fns.ts` | ❌ Defective | `documents.tsx`, `payments.tsx`, `portal.tsx` — actively breaking |
| `whatsapp/server-fns.ts` | ❌ Defective | `settings.tsx` — actively breaking |
| `clients/server-fns.ts` | ❌ Defective | none today (P1-3's client register UI was never wired to routes) — dormant, will break the instant a route imports it |

Six files need the fix. The underlying defect is identical in every case: a static top-level
`import` of a repository factory (or of another feature's repository, or of `getRequest` combined
with a repository) where the established, already-proven-in-this-codebase pattern uses a
`createServerOnlyFn`-wrapped async loader with a dynamic `import()` instead.

## The fix pattern

Mirrors `documents/server-fns.ts` and `checklist-templates/server-fns.ts` exactly — both already
reviewed and shipped this session. For each defective file:

```typescript
const loadDefault<X>Context = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { create<X>Repository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  const actor = await requireStaffActor(getRequest());
  return { actor, dependencies: { repository: create<X>Repository() } };
});

async function withDefault<X>Context<T>(
  handler: (actor: AuthenticatedActor, dependencies: <X>Dependencies) => Promise<T>,
): Promise<T> {
  const { actor, dependencies } = await loadDefault<X>Context();
  try {
    return await handler(actor, dependencies);
  } finally {
    await dependencies.repository.close();
  }
}
```

Every exported `createServerFn`'s `.handler()` calls `withDefault<X>Context(...)` instead of
touching module-level imported values directly. This is a pure "move where the values come from"
change — **no business logic changes**. Every exported `*ForActor` function (the actual logic,
already dependency-injected per this codebase's testability convention) keeps its exact signature
and behavior; only the thin `createServerFn` wrapper's plumbing changes. Since Vitest's test
environment never runs through Vite's import-protection plugin, the ~750 existing tests are
unaffected by this refactor as long as behavior is preserved — verified per-task by running each
file's existing test suite unchanged, and confirmed overall by the full suite at the end.

**`annual-return/server-fns.ts` specifics:** most of its 13 handlers fit the shared-loader shape
above directly. `queueAnnualReturnWhatsAppReminderMessage` additionally opens a transaction
(`getSqlClient()` → `sql.begin(...)`, passing the transaction into both `createAnnualReturnRepository({sql: tx})`
and `createWhatsAppRepository({sql: tx})`) — its loader resolves `getSqlClient`/`createWhatsAppRepository`
alongside the shared ones, and the transaction logic itself is unchanged, just fed from lazily-resolved
values instead of static imports. `getAnnualReturnDashboardMetrics` currently takes no validator input;
its handler still needs the actor + repository, so it also routes through the shared context loader.

**Files that only statically import `getRequest`** (`evidence-server-fns.ts`) still get the same
treatment for consistency, even though `getRequest` alone (an `@tanstack/react-start/server` package
import, not a `src/server/**` path) may not itself be the triggering violation — its actual defect
comes from what it transitively reaches through `./evidence-service`. Converting the whole file to
the lazy pattern is simpler and more consistent than hand-verifying exactly which imports are the
live ones per file.

## Regression gate

No existing test would have caught this — the suite renders via jsdom/`renderToString`, never
through Vite's real client bundler, and `npm run build` (which does exercise the real bundler)
doesn't catch it either, since production tree-shaking proves the dead imports don't survive.
The gap is specifically in `npm run dev`'s conservative pre-tree-shaking behavior.

New `scripts/verify-dev-server-imports.ts`, following this repo's own established pattern
(`scripts/verify-firm-deployment.ts`: spin up the real thing, check its real behavior, offline,
no network access needed) rather than inventing a new convention:

1. Starts the Vite dev server as a child process (`VITE_ENABLE_DEMO_AUTH=true`, matching
   `.claude/launch.json`'s `kossilon-demo` config), on an ephemeral port, piping its stdout/stderr
   into a buffer the script controls (not the terminal) so violation text can be inspected
   programmatically.
2. Waits for it to report ready (its stdout emitting `ready in`, matching what real runs print).
3. Requests every route under `src/routes/*.tsx` (excluding dynamic/parameterized routes that need
   real data, or hitting them with a placeholder id is acceptable since we're checking for a
   compile-time import violation, not correct data rendering).
4. Fails (non-zero exit) if the buffered dev-server output contains the literal string
   `[import-protection]` at any point during the run — confirmed via live reproduction this is
   where the violation actually surfaces (the dev server's own stdout/stderr), not the HTTP
   response body the browser receives, which instead shows a downstream symptom
   (`Failed to fetch dynamically imported module`) rather than the root error text. Also fail if
   any route request itself errors or times out, as a secondary signal.
5. Tears down the dev server child process in a `finally`, regardless of outcome.

Wired into `.github/workflows/ci.yml` as a new step, placed after the existing `Build` step (so a
build failure is reported first, since it's the cheaper/faster signal) and before the final cron-wiring
grep step.

## Testing

- Each of the 6 file-conversion tasks: run that file's existing test suite unchanged, confirm it
  still passes (proving no behavior change).
- The new gate script gets its own quick unit-level sanity check if practical (e.g., mock a child
  process that emits the denial string and confirm the script detects and fails on it), otherwise
  its own successful CI run against the now-fixed codebase is the proof.
- Final task: full `tsc`/`lint`/test suite sweep, run the new gate script directly and confirm it
  passes, and a real manual smoke test in a browser — finally possible, since this fix is what makes
  it possible — confirming demo mode renders `/`, `/annual-returns`, `/documents`, `/payments`,
  `/portal`, `/settings`, `/work-queue` without any import-protection error.

## Out of scope

- Any business logic change to any of the 6 files — this is purely a module-loading refactor.
- `clients/server-fns.ts`'s routes/UI (P1-3) — fixing the file's import pattern doesn't wire it up
  to any route; that remains P1-3's job.
- Extending the regression gate to check every possible route parameter combination — the gate
  proves the import graph is clean, not that every page renders correct data.
- Any change to `main`'s already-green CI `Build` step — it isn't broken and doesn't need to change.

## Acceptance

1. `npm run dev` (demo mode) renders every route in a real browser with no `[import-protection]`
   error, for both `/` and every route reachable from the sidebar.
2. All 6 identified files use the lazy `createServerOnlyFn` + dynamic-`import()` pattern; `grep -rlL
   "createServerOnlyFn" $(grep -rl "= createServerFn(" src/features/)` (adjusted to also accept the
   inline-dynamic-import variant `neon-auth-rpc.ts` already uses) shows no remaining defective file.
3. Full test suite passes unchanged in count (no regressions, no changes needed to existing tests).
4. `npm run build` still passes (unaffected, already did).
5. `scripts/verify-dev-server-imports.ts` exists, passes locally, and is wired into CI.
