# Retiring blocked integrations

**Date:** 2026-09-12
**Status:** design approved, implementation not started

## The defect this comes from

`local-postgres` was listed in `BLOCKED_INTEGRATIONS` with `blocksRelease: true`
while both of its own stated clearing conditions had already been met. Its
`clearedBy` reads "a connectable `TEST_DATABASE_URL`, or the CI run result on a
PR". CI has been running every repository test against a migrated and seeded
Postgres on every pull request, and the suite also runs locally against a
container. Its `effect` still claimed "every SQL judgement in this work comes
from reading, not running" — by then the opposite of true.

So `/operations` was telling staff that a working capability was a
release-blocking disabled one.

**`capabilities.test.ts` could not have caught it.** That test cross-checks
entries against `BLOCKED_INTEGRATION:` markers in `src/` in both directions, and
its own header names the direction that "matters in a year's time" as an entry
with no marker. This failure is a third direction: the entry and its marker went
stale **together**, so both sides agreed and the test saw a consistent pair.

Nothing anywhere asks whether a declared blocker is still true.

## The asymmetry this design is built on

Two failure modes, and they are not equally bad:

| | Cost |
| --- | --- |
| A blocker outlives its cause | Staff distrust a capability that works; a release gate is held for nothing |
| A blocker is cleared while still true | Someone trusts a disabled safety gate |

Only the second is dangerous. So: **flag loudly, never auto-clear.** A blocker
whose evidence appears fails a test or raises a notice; a human deletes the
entry. The product never asserts its own capability back into existence.

## The type

`BlockedIntegration` gains one required field.

```ts
/**
 * Where this blocker's clearing condition could be observed, if anywhere.
 *
 * Required, not optional, because "nothing in this system can check this" and
 * "nobody thought to check" used to look identical.
 */
export type ClearingEvidence =
  /** Observable while the test suite runs. */
  | { observable: "build" }
  /** Observable only from a deployed runtime's own data. */
  | { observable: "runtime" }
  /**
   * Not observable from inside the product. `why` is required so that
   * "external" cannot quietly become the default answer for anything awkward.
   */
  | { observable: "external"; why: string };
```

The required `why` is the field doing the real work. Without it every future
entry gets marked `external` and the mechanism dies quietly; with it, an author
must write down what kind of fact this is — a signed contract, another team's
protocol — and that sentence is itself reviewable.

Assignments:

| Entry | Kind |
| --- | --- |
| `local-postgres` | `build` |
| `deployment-runtime` | `runtime` |
| `malware-scanner-provider` | `external` |
| `document-text-extraction` | `external` |
| `ai-provider` | `external` |
| `whatsapp-media-download` | `external` |
| `external-handoff-destination` | `external` |

## The two checkers

### Build

Lives beside the existing convention test. Evidence for `local-postgres` is that
the database tests actually executed, which in-process means `TEST_DATABASE_URL`
is set — the same signal `describe.skipIf(!databaseUrl)` uses throughout the
repository.

A developer with no database sees nothing. **CI, which sets it, fails.** That is
the right place to catch it. The failure message names the entry and says to
delete it, rather than only going red.

### Runtime

A pure function over data `buildOperationsHealth` already holds:

```ts
export function staleBlockedIntegrations(input: {
  blocked: readonly BlockedIntegration[];
  maintenanceState: MaintenanceHealthState;
}): readonly BlockedIntegrationId[];
```

`deployment-runtime`'s evidence is a recorded scheduled run, and
`maintenanceHealthOf` already distills exactly that: `never-observed` means no
scheduled run exists, so **any other state is the evidence**. No new query and
no new table read — the check is free.

The result rides on `OperationsHealthView`, and the route renders a notice
worded as "this may no longer be true; a person should confirm and remove it".
Never "cleared".

### The guard that keeps it honest

An entry with no corresponding check would look checked and never be — which is
this whole defect again, one level up. So **both** kinds are guarded, not just
the runtime one:

- every `runtime`-kind entry must have a case in `staleBlockedIntegrations`
- every `build`-kind entry must have a case in the convention test

Adding a blocker of either observable kind without wiring up its check fails the
suite. Only `external` entries have nothing to wire, which is the point of
making `why` required: declaring "nothing can check this" is a deliberate act,
not the path of least resistance.

## Testing

`staleBlockedIntegrations` is pure and unit-tested across four cases:

- entry present, evidence absent → silent
- entry present, evidence present → flagged
- entry already removed, evidence present → silent (nothing to flag)
- a `build` or `external` entry → never flagged by the runtime path, because its
  evidence does not live there

Plus the exhaustiveness guard above.

## Deliberate non-goals

**No special-casing of `blocksRelease`.** A stale blocker is the same defect
whether or not it gates a release; branching on it would add a path nobody
tests.

**No auto-clear, for any kind.** Including the two observable ones.

**No review dates or expiry for `external` entries.** Five entries that a person
already reads on `/operations` do not justify a scheduling mechanism.

## The limitation, stated plainly

**This catches nothing for the five `external` entries.** A scanner contract
could be signed tomorrow and the product would keep claiming the capability is
blocked, exactly as it does today. The design makes that gap *declared* rather
than invisible; it does not close it.

## Immediate consequence

**This design's first act is to fail CI.** `local-postgres`'s build evidence is
present right now, so the new test fails the moment it exists, and the only way
to make it pass is to retire the entry — which is correct, because both of its
stated clearing conditions have been met.

The test should land first, so the failure is on the record, and the deletion
second. A change that adds the mechanism and the deletion in one commit hides
the only proof the mechanism works.
