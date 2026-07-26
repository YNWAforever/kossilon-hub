# 1. Demo mode is read-only

Date: 2026-07-26

## Status

Accepted.

## Context

`dataMode` selects between **demo** (browser fixtures in `src/lib/*-store.ts`) and
**production** (server functions → repository → Postgres). Demo originally had a full
write path: 29 functions across `annual-return-store.ts` and `client-portal-store.ts`
that mutated module-level state and notified `useSyncExternalStore` subscribers.

Commit `bed1cc6` ("refactor: guard production routes from browser mutations", 13 Jul 2026)
introduced `scripts/check-production-route-imports.ts`, a build gate that failed if a route
imported one of those writers. The gate matched on the **import edge** and was
unconditional — a call correctly guarded behind `dataMode === "demo"` failed exactly as a
production-mode call did. The cheapest way to pass it was to disconnect the demo handlers,
so the same commit replaced them with strings: `setPacketWarning("Production packet state is
managed by the annual-return server action.")` and fifteen others.

From that point the writers had no caller. By July 2026 the position was:

- 0 of 29 writers were imported from outside the two store modules; they referenced each
  other, so they formed a closed cluster with no entry point.
- The stores' external surface was 43 bindings, all reads, derivations and types.
- Store state could not change at runtime. The demo was already a static fixture.
- `client-portal-store.ts`'s snapshot was seeded empty and filled only by those writers, so
  the demo portal had displayed no documents and no payment proofs since 13 July.
- The gate's denylist had a second copy in `-production-authorization.test.ts` that had
  already drifted — 21 names against the gate's 22.
- The gate never covered the one live violation in the tree: `settings.tsx` makes 23
  unconditional `templatesStore.*` write calls with no `dataMode` branch, because that store
  is object-shaped and absent from the map.

## Decision

Demo mode is a **read-only preview**. The demo stores expose reads, derivations and types;
they export no write path, and one must not be added.

The write cluster and its tests are deleted. `check-production-route-imports.ts`, its
`package.json` script and the duplicated denylist are deleted with it: a store that exports
no mutation cannot be misimported, so the invariant the gate enforced is now structural.

Fixtures were added to `initialSnapshot` covering rejected, accepted and superseded review
states, so the portal and payments screens still demonstrate their range and the derivations
over them stay covered without a write path.

## Consequences

- Demo screens render; their controls do not act. The inert controls left by `bed1cc6` are
  still on screen and should be either removed or visibly disabled — tracked separately.
- Behavioural coverage that used writers for setup is gone. Read derivations are covered
  against directly-constructed fixtures instead, which removes those tests' dependency on
  shared mutable module state.
- Writing anything in demo mode now requires a deliberate reversal of this decision, not an
  incremental addition.
- This does **not** address `settings.tsx`, which still writes to `templatesStore` in
  production mode. That is a real defect and needs its own fix.

## Alternatives considered

**Restore the interactive demo** — make the gate mode-aware and re-wire the 16 handlers.
Rejected: it commits the project to maintaining two complete write implementations of the
same domain permanently, and they had already diverged badly — three incompatible
`AnnualReturnCase` types, three payment-status enums, and an `"accepted"` vs `"verified"`
mismatch patched by hand at `documents.tsx:276`.

**Keep the gate** pointing at the now-empty stores. Rejected: a denylist naming 22
functions that no longer exist is worse than none, because `CLAUDE.md` instructed
contributors to maintain it.

**Repoint the gate** at `templatesStore` / `kbStore` / `clients-store`. Not rejected on
merit — it would fail the build immediately on 23 call sites in `settings.tsx`, which makes
it a demand for a feature (persist templates, or branch on `dataMode`) rather than a gate
change. It belongs with the `settings.tsx` fix.
