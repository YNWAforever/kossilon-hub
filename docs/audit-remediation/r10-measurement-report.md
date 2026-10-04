# R10 / UC24 offline measurement report

`scripts/audit-performance-report.ts` reads an existing measurement export. It
does not generate traffic, contact a provider, seed data or grant load-test
approval. The old `benchmark-audit-queries.ts` and its dated receipts retain
their original single-wave scope.

```sh
node --experimental-strip-types scripts/audit-performance-report.ts owned-run/samples.json > owned-run/report.json
```

Exit 0 means the supplied profile has structurally complete sample coverage.
Exit 1 emits an incomplete report with specific blockers. Exit 2 refuses invalid
input and emits only a fixed error; it never echoes a filename, raw JSON or a
filesystem/provider error. Inputs are regular files up to 32 MiB and 250,000
samples. Use new output paths and retain the original export/hash. Stdout is the
only output written by the tool.

## Version 1 input contract

The source schema is the authoritative shape. Unknown fields are rejected at
every object boundary. Identifiers are pseudonymous labels of 1–100 ASCII
letters/digits/underscore/dot/hyphen; never insert credentials, URLs, emails,
customer names or document bytes.

| Field | Required content |
| --- | --- |
| `formatVersion` | `1` |
| `environment` | `level`, `targetId`, exact 40-character lowercase `buildSha`, `platform`, `runtime`, `postgresMajor`, `webRegion`, `databaseRegion`, `poolSize`, `hardware` |
| `environment.level` | `LOCAL_CONTRACT`, `LOCAL_REAL_DB`, `CI_DEMO`, `STAGING_OBSERVATION` or `PRODUCTION_OBSERVATION`; these are input classifications, not verified identities |
| `dataset` | Actual non-negative integer `cases`, `documents`, `versions`, `officers`; counts do not establish business approval or representativeness |
| `profile` | UTC `rampStartUtc`, `steadyStartUtc`, `endUtc`, strictly ordered; each phase at most one hour |
| `expectedEndpoints` | Unique reviewed workload labels, 1–50; declare every endpoint in scope |
| `expectedActors` | Unique pseudonymous actors, 1–100; complete profile requires exactly 25 |
| `samples[]` | Unique `id`, declared `endpoint`/`actorId`, `phase` (`ramp`/`steady`), `cache` (`cold`/`warm`/`unknown`), UTC `startedAtUtc`/`endedAtUtc`, `outcome` (`success`/`error`) |
| `samples[].timings` | Optional observed `httpMs`, `dbRttMs`, `sqlMs`, `serializationMs`, `renderMs`, `providerMs`; each finite and non-negative |

Samples must start and finish inside the declared observation window; a phase
is determined by its start time. Retain requests that cross a load-stop time in
the raw runner export and declare an observation end covering their completion.
Do not discard timeouts/failed requests to make a profile appear complete.
Clock regressions, duplicate sample IDs, out-of-window samples and undeclared
actors/endpoints are refused. The reporter cannot discover absent/unrecorded
requests; audit the runner's attempted/completed/unknown totals separately.

## Output and interpretation

Groups keep endpoint, phase and cache separate. Both all-attempt and
success-only elapsed p50/p95/p99 use nearest-rank quantiles. Failed attempts
remain in total/error counts and all-attempt latency. Error rate is a fraction
of attempts. Each optional timing layer has its own sample count; absent values
produce `null` percentiles, never zero. Timing layers can overlap, so the tool
does not sum them or infer missing measurements. UTC timestamp precision limits
the elapsed measurement; keep the underlying monotonic clock data as well.

Completeness requires a ramp of at least 300 seconds, steady of at least 900
seconds, 10k cases/50k documents, nonzero versions/officers, PG18 and cold/warm
labelled samples per endpoint. Every minute reports distinct observed actors
per endpoint, with a linear 25-actor ramp and all 25 in steady; partial final
minutes are included. This checks request coverage. It does **not** prove that
25 users were simultaneously active, or that a claimed cold sample had cold
database/OS/platform state.

Every report retains `releaseDecision=NO_GO`, `sloAssessment=not_assessed` and
explicit limits. Even complete synthetic or STAGING-labelled exports are not
genuine acceptance. Adopted SLO, authentic artifact/target identity, isolation,
representative business data, active-user timeline, cold-state evidence,
HTTP/RTT/render receipts, fixture cleanup and native scheduler receipts require
their separate owners and review under the master plan.

## Remaining external inputs

- Operations/Business: adopt UC24 SLO and approve equivalent 25-user workload,
  dataset/window/cost, active-user timeline and cold-state measurement method.
- DB/Release: resolve approved B1 endpoint capability, restricted app role,
  equivalent PG18 region/pool target, logical owners/DDL freeze and hosted restore.
- Auth/Storage/provider owners: controlled identities and isolated bindings;
  no live sending, invitation or production load is authorised by this tool.

The current local slice produces no new before/after runtime performance result
and does not change original50 UAT status. The existing before/after query and
SLA/NAR evidence remains in `performance.md` and `sla-calendar-performance.md`.

## Individual sample CSV (R10 / UC24)

The same bounded input can be exported as quoted RFC4180 rows with CRLF:

```sh
node --experimental-strip-types scripts/audit-performance-report.ts owned-run/samples.json --samples-csv > owned-run/samples.csv
```

Keep a new output path, the unchanged original JSON/hash and the default JSON
report together. CSV retains each sample in source order, including errors,
endpoint, actor, phase, cache label, original timestamps, elapsed milliseconds,
six optional timing layers and exact build/environment/target identity.
Missing timings are empty cells; an observed zero remains zero. Empty samples
produce the header only. Every observed row includes `NO_GO` and `not_assessed`.
CSV does not replace the JSON report's profile blockers, coverage, full runtime
metadata or dataset counts, and creates no new performance or genuine UAT result.

Identifiers beginning with a spreadsheet formula prefix receive a leading
apostrophe before CSV quoting; retain their original identity in the source JSON.
Import identity/SHA columns as text when using a spreadsheet. The exporter uses
the same strict validation as the JSON reporter; invalid input is refused before
any stdout. The existing 32 MiB/250,000-sample bounds and exit 0/1/2 meaning remain.
Exit 0 still means structurally complete coverage, never an adopted SLO or release
approval. Default CLI invocation continues to emit JSON.
