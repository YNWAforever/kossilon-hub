# R10 / UC24 — offline measurement report

Binding specification: `oct3-implementation-plan.md` R10. Source baseline:
`8037729c2150918234f16b4d9b65f4f6ca215b4d`. Existing query benchmark measures
five samples and single 10/25-user waves; it does not cover the required
5-minute ramp and 15-minute steady observation. Preserve those dated receipts.

## Task 1: test the missing measurement contract

Add real-data transformation tests for an offline report, with synthetic samples
explicitly labelled LOCAL CONTRACT. Test per-endpoint/cache/phase nearest-rank
p50/p95/p99, attempted/success/error counts, optional timing layers, and empty
groups. Lock exact build/environment/dataset metadata. Reject malformed samples,
duplicate IDs, negative/non-finite timings and timestamp/phase contradictions.
Expected RED: the new report export is unavailable; no provider call occurs.

## Task 2: implement the smallest offline reporter

Add a versioned, bounded JSON input contract and read-only CLI. Report measured
minute-by-minute actor coverage separately from concurrency. Require at least
300 seconds ramp, 900 seconds steady, 25 distinct actors in each steady minute,
10k cases/50k documents, representative versions/officers and cold/warm samples
for a structurally complete profile. Labels and coverage never prove isolation,
genuine cold state, concurrency, adopted SLO or business acceptance. Always emit
`releaseDecision=NO_GO` and `sloAssessment=not_assessed`. Preserve errors in counts.
No network, secrets, DB/fixture writes or live load. Expected GREEN: exact offline
calculations and refusal contracts pass. Existing benchmark/CI/UAT unchanged.

## Task 3: verify and deliver the R10 slice

Run focused tests, real CLI probes, lint/project plus script typecheck, original
release verifier and all original CI gates on the exact PR head. Retain actual
commands/counts/hash receipts. Update only R10 tracker evidence and append status,
environment/evidence delta and operator instructions. One whole-branch review;
normal merge only after all checks green, then verify exact-main CI. Genuine
hosted load/SLO/native/provider acceptance remains blocked with named owners.

## Review Focus

No aggregation may hide errors, invent zero timings for missing layers, combine
different endpoints/cache phases or claim cold/concurrent/genuine acceptance.
One-wave or sparse samples must remain incomplete. Unknown JSON fields and CLI
errors must not expose raw input. Preserve original50 UAT and old immutable
evidence, SQL/manifest, benchmark, migrations, dependency locks and CI gates.
