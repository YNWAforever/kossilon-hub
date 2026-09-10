# Phase F — pilot, scale and repeatable operations

Design, 2026-09-11. Plan §9.

## The problem this phase actually has

Phase F is written for a firm with a database, provider accounts, pilot staff and
real cases. This repository has none of them. Its acceptance gate —
"representative real staff scenarios pass with recorded browser/API/data/file
evidence" — cannot be met here, and no amount of code changes that.

What can be built is the part of F2 that is a *product capability* rather than an
observation: **the system's ability to tell someone that it is not running.**

## F-1 The tick leaves no trace

`runScheduledMaintenanceForWorker` runs the nine passes and then:

```ts
console.log("scheduled maintenance", JSON.stringify(result));
```

That is the whole record. It goes to the Cloudflare log stream, which is
ephemeral, requires a person to go and look, and is not readable by the product.

So today, if the cron stops firing — or, the live possibility under
`BLOCKED_INTEGRATION: deployment-runtime`, if the nitro `cloudflare:scheduled`
hook never registers on the deployed runtime and it never fires *at all* — the
observable symptoms are:

- SLA escalations are never evaluated.
- Reminders are never evaluated and the outbox is never dispatched.
- Quarantined documents are never scanned or escalated.
- Expired upload intents are never reclaimed.

...and every screen looks completely normal, because every screen reads tables
that a *human* still writes to. The first real signal is a missed statutory
deadline.

F2 says "Prove scheduled jobs actually run on the deployment runtime… Record
last-success and lag." There is nothing to record it in.

### F-1 builds `maintenance_runs`

Migration `0033`. One row per invocation, written on the success path *and* the
failure path, carrying the whole `ScheduledMaintenanceResult` as `jsonb` rather
than a handful of columns somebody guessed at.

Two design points carry the weight:

**A run that could not be assembled still tries to write a row.** If the
repositories cannot be constructed — no `DATABASE_URL`, Hyperdrive down — the
row cannot be written either, and that is unavoidable: the record lives in the
thing that broke. Which is exactly why the health rule below is built on the
*absence* of a recent row rather than on the presence of a failed one. A failed
row is a bonus, not the mechanism.

**`outcome` distinguishes three things, not two.** `succeeded` (every pass ran),
`partial` (the run completed and named which passes threw — the state
`MaintenancePassesFailedError` already models), `failed` (the run did not get far
enough to have passes).

## F-2 What "healthy" is allowed to mean

`src/features/operations/health.ts`, pure and clock-injected.

The states, and why each exists separately:

| State | Meaning |
|---|---|
| `never-observed` | No run has ever been recorded. **Not healthy.** This is this repository's actual state, and it is what a fresh deployment whose cron never registered also looks like. |
| `stale` | Runs exist, the most recent is older than the tolerance. This is the state that detects a cron that stopped. |
| `failing` | The most recent run did not complete. |
| `degraded` | Recent, completed, but passes threw. |
| `healthy` | Recent, completed, no pass threw. |

`never-observed` is the whole point. A dashboard that showed a green tick over an
empty table would be worse than no dashboard: it would be a positive claim, made
out of no evidence, about the one subsystem nobody watches.

Tolerance derives from the declared cron (`*/5 * * * *`) rather than a literal, so
changing the schedule cannot silently make the staleness rule wrong.

### A `not-configured` pass is not a failure

Six integrations are blocked and two of them make a pass report
`scanner: "not-configured"` / `worker: "not-configured"` on every single tick,
permanently. Folding that into `degraded` would paint the screen red forever and
train staff to ignore it — and the day something *actually* broke, the colour
would not change.

So blocked capabilities are a separate channel of the same screen: listed,
named, with what a pilot does instead. Visible, and not an alarm.

## F-3 The capability inventory, and the test that keeps it true

`src/features/operations/capabilities.ts` declares each blocked integration: the
capability a user would reasonably expect, what happens instead, the manual
fallback for a pilot, and what would clear it.

`capabilities.convention.test.ts` cross-checks the declared ids against the
`BLOCKED_INTEGRATION: <id>` markers actually present in `src/`, **in both
directions**:

- A marker in the source with no inventory entry → a capability is disabled and
  the operations screen does not say so.
- An inventory entry with no marker in the source → the docs claim something is
  disabled after the code stopped saying it was.

The second direction is the one that matters over time. It is how "clearly
disabled" stays true after the person who wrote it has moved on, and it is the
only mechanical part of the F acceptance gate's "remaining optional unsupported
capabilities are clearly disabled/manual" that this repository can enforce.

## What Phase F does not build, and why

- **F1 pilot.** Needs staff, cases and a running deployment. Not simulatable; a
  scripted "pilot" over fixtures would produce a report about fixtures.
- **F2 scale.** "Add indexes only for measured hot queries and check query plans
  against the chosen database" — there is no database, so there is no
  measurement, so adding indexes now would be the exact thing the plan forbids.
- **F2 backup/restore verification.** Needs a database and a bucket to restore.
- **F3 measurement.** Every metric would be computed over zero rows. The plan's
  own instruction — "Do not report saved hours, accuracy or adoption as actual
  without measured evidence" — is better served by a stated measurement contract
  than by a dashboard of zeros that looks like a result.

Each is recorded as blocked with the specific input that would clear it, in
`docs/implementation/kossilon/status.md`.
