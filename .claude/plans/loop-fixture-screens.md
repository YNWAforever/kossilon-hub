# Loop Runbook — Fixture Screens To Production Data

**Pattern:** `sequential` · **Mode:** `safe` · **Status:** prepared, NOT started

Created 2026-07-30 by `/ecc:loop-start`. Nothing in this runbook has been executed.

---

## Preflight (all verified at `5eede30`)

| Check                                    | Result                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| Working tree clean                       | yes                                                            |
| Branch in sync with origin               | `claude/production-command-center`, 0 ahead / 0 behind         |
| Tests pass before first iteration        | **445 passed, 34 skipped, exit 0**                             |
| `ECC_HOOK_PROFILE` not disabled globally | unset — hooks active (`standard,strict` observed this session) |
| Explicit stop condition                  | yes, see below                                                 |
| Open PRs                                 | #18 (`CLEAN`); #17 merged                                      |

The 34 skipped are repository integration tests behind `describe.skipIf(!databaseUrl)`. **They will stay skipped for every iteration** unless `TEST_DATABASE_URL` is set. Any loop item touching SQL is therefore covered by typecheck only, and must say so in its PR.

---

## The backlog

The defect class: a screen reads `src/lib/*` fixtures with no `dataMode` branch, so production users see invented data. Fixed twice already — `/annual-returns` (PR #18) and `settings.tsx` — using the same shape each time: production component in `src/features/<feature>/components/production-*.tsx`, demo body left inline, route branches with the guard hoisted above the hooks.

### In scope — mechanical, follows the established pattern

| #   | Screen                    | Fixtures        | In production nav?    | Notes                                                                                                            |
| --- | ------------------------- | --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `src/routes/whatsapp.tsx` | `lib/app-data`  | **yes** (`/whatsapp`) | Highest priority: same class as the two already fixed, still shipping invented conversations to production.      |
| 2   | `src/routes/index.tsx`    | `lib/mock-data` | **yes** (`/`)         | Mixed — KPIs already come from `features/dashboard/dashboard-data`. Narrow the remaining `mock-data` reads only. |

### Out of scope — needs a product decision, loop must NOT touch

| Screen                                                                      | Why it stops the loop                                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `clients.tsx`, `clients.$id.tsx`, `enquiries.tsx`, `teams.tsx`, `tasks.tsx` | Already removed from navigation. Whether each should exist in production at all is a product call, not an engineering one. |
| Cron wiring for `runFirmMaintenance`                                        | Needs an auth decision from the user.                                                                                      |
| Case creation / template persistence                                        | Product decisions recorded in the PR #18 spec.                                                                             |

---

## Per-iteration contract

Each iteration handles exactly one backlog item and ends at a pushed PR.

1. Branch `claude/<screen>-production` from `origin/main`.
2. Read the screen and its data source. Establish **what production can actually represent** before writing anything — the `/annual-returns` work found four demo columns with no production equivalent, and one (`completionBlockers`) that looked reusable but was a completion gate, not a work list.
3. Write the failing test first. Route-level tests must run at **both** `dataMode` values — `dataMode: "production"` appeared in no test in this repo before PR #18, which is how a broken `<Outlet />` would have shipped silently.
4. Implement. Production component under `src/features/<feature>/components/`; demo body stays where it is.
5. Gate: `npm run typecheck && npx vitest run && npm run lint && npm run build`.
6. **Mutation-check every new guard**: break it, confirm its own test fails and nothing else, restore. This caught a vacuous test in PR #18 — a `<select>` given an unknown value renders no selected option either way, so the assertion passed with the sanitisation deleted.
7. Verify demo mode in a browser (`VITE_ENABLE_DEMO_AUTH=true`). Production paths cannot be verified without a database — say so explicitly in the PR rather than implying coverage.
8. Conventional commits, PR, stop.

## Model tier

| Work                                                 | Tier         |
| ---------------------------------------------------- | ------------ |
| Single-file mechanical edits with complete spec      | cheap        |
| Multi-file integration, route wiring                 | standard     |
| Deciding what production can represent; final review | most capable |

## Stop conditions (any one halts the loop)

1. Backlog exhausted (both in-scope items shipped).
2. Any gate fails and is not green after one fix attempt.
3. An item turns out to need a product decision — including any in-scope item whose production model can't represent the screen.
4. A change would touch an out-of-scope screen.
5. Working tree dirty at iteration start, or branch behind origin.

## Known hazards, learned the hard way this session

- **Subagents default to the primary repo, not this worktree.** One committed to local `main` at `/Users/willylai/Documents/kossilon-hub` despite an explicit path. Every dispatched agent must verify `git rev-parse --abbrev-ref HEAD` before its first edit and report the output.
- **`@testing-library/jest-dom` is not installed.** `toBeInTheDocument`, `toBeDisabled`, `toHaveTextContent` all throw. Use `.toBeTruthy()`, `(el as HTMLButtonElement).disabled`, `el.textContent`.
- **`// @vitest-environment jsdom` must be line 1.** No global environment, no setup file.
- **`renderToString` does not run TanStack Query.** Asserting a server fn was called from an SSR test always sees zero calls.
- **Route files cannot export non-components** without tripping `react-refresh/only-export-components`. Pure helpers go in a sibling module.
- Route-directory test files must be `-` prefixed or the router treats them as routes.
