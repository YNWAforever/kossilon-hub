# R10 / UC24 — bounded offline sample CSV

Binding spec: `oct3-implementation-plan.md` R10, which requires per-endpoint
sample CSV as well as aggregate percentiles. Baseline main:
`f61b1ae70954311fac314d1069785445f91ee7a2`. PR135 supplies JSON aggregation;
it does not export individual samples to CSV. Preserve its immutable receipts.

## Task 1: reproduce the absent export

Add real transformation and child-process tests in
`scripts/audit-performance-samples.test.ts`. Consumer-visible requirements:
one row per input sample, source order/identity retained, errors included,
optional timing layers blank rather than zero, explicit zero retained,
endpoint/actor/cache/phase/timestamps/elapsed plus build/environment/target
identity, `NO_GO` and `not_assessed` in each row. Retain header on empty input;
neutralise spreadsheet formula prefixes in identifiers. Reuse the existing
strict measurement validation, including duplicate/out-of-window/phase/unknown
field rejection and fixed non-echoing errors. Test the real Node CLI flag
`--samples-csv`, malformed/oversized files, and existing JSON mode.
Expected RED: CSV function/flag unavailable; no provider or database use.

## Task 2: add the minimal exporter

Extract the existing input validation unchanged into one internal helper.
Add `buildAuditPerformanceSamplesCsv(input: unknown): string` in the existing
reporter; emit fixed header/RFC4180 rows with CRLF, no raw errors or content.
Add only the optional `--samples-csv` CLI flag after the input filename.
Retain JSON default and exits 0 structurally complete / 1 incomplete / 2 invalid.
Validate all input before writing stdout; reuse bounded regular-file reading.
CSV is an offline derived artifact, never cold/concurrency/SLO/UAT proof.
Expected GREEN: focused new and original reporter contracts pass; original
report output/default CLI behavior is unchanged.

## Task 3: verify, document and deliver

Run focused tests, actual lint/typecheck including script/test files, original
release verifier, and the full project suite with an owned local PG18 database.
Record exact commands, counts, environment and hashes; original50 UAT and old
evidence/benchmarks/migrations/locks/CI bytes remain unchanged. Append R10
status/evidence/environment and update only its tracker row. Add CSV operator
instructions, one fresh whole-branch review, normal merge only if every exact
head check is green, then verify exact-main original CI. Retain runtime blockers
and separate local code completion from formal release NO_GO.

## Review Focus

Dropping error rows, fabricated zero timings, loss of SHA/identity, validation
drift between CSV/JSON, formula execution, partial stdout on invalid input,
argument/file-boundary regressions, or promotion of CSV to genuine acceptance.
No network/DB/provider/fixture writes in the exporter. Existing source privacy
choice remains local reads: automatic review rejected graph indexing; no
alternate or indirect index operation is allowed.
