# B08: NAR apply SLA calendar CPU

Spec: the October audit's existing single-row domain-service, current-version,
authorization, no-blind-retry and real-evidence requirements; existing calendar
arithmetic and original 30s/120s/10s test budgets remain binding.

Baseline: a0b753e4c4bce4c410dcb58cfc381039c82f0c65, both actual Linux runtime CI
legs 234 files / 2209 PASS / 0 skip. Local NAR100 profile: 75.21s test body,
64.076s dispatch gaps immediately after calendar holidays (100 occurrences).
An actual PostgreSQL observation showed ClientRead at that boundary. Gaps include
application processing; they are not exact SQL execution time.

## Interfaces and constraints

snapshotSla calls addBusinessMinutes separately for warning and due dates.
addBusinessMinutes constructs the same Intl.DateTimeFormat anew for every scanned
minute, including closed weekends. Reuse one formatter within each invocation;
retain all date, interval, holiday, timezone, partial-minute and validation behavior.
No shared result cache, global timezone cache, transaction, SQL, permission,
schema, provider, clock or bulk-domain shortcut is introduced.

## Task 1: Reproduce and repair calendar allocation overhead

1. Add a real 100-snapshot deterministic Saturday workload under the unchanged
   ordinary 30s test lifetime. Assert hand-checked Monday timestamps and each
   independent policy identity; yield between snapshots and obey cancellation.
   Expected: baseline timeout, not an assertion/setup error.
2. Add hand-checked spring/fall DST and non-hour timezone contracts. Measure a
   fixed synthetic 100-snapshot script before/after on the same runtime/input.
   Expected: exact timestamps; measurement is local, not an accepted runtime SLO.
3. Construct one Intl formatter per addBusinessMinutes invocation and pass it to
   local-minute reads. Expected: all calendar/SLA contracts and workload PASS.
4. Repeat the original NAR100 contract against the same uniquely owned local
   fixture; preserve all original budgets, authorization and single-row service.
   Expected: 100 applied / 0 pending, normal cleanup, actual duration recorded.
5. Run focused NAR/work-item/Postgres contracts, typecheck/lint and the complete
   original CI workflow on both runtime legs. Preserve every actual failure.
   Expected: exact-head full CI PASS; never infer from focused tests.
6. Commit focused source/tests and actual evidence/runbook/status updates; create
   a draft PR, obtain one fresh whole-branch review, fix Important/Critical once
   via RED/GREEN and full suite. Merge normally only after exact final-head green
   checks, then independently verify main and production metadata.

Task completion command: a fresh PowerShell gate validates the actual fixed-input
benchmark results, original NAR100 outcome/cleanup, unchanged UAT SHA and complete
exact-head Node22/24 CI steps/counts, then reruns calendar/SLA contracts.

## Review Focus

Timezone validation on zero minutes; partial seconds; spring/fall DST and non-hour
offsets; holiday overrides and invalid intervals; distinct mutable caller calendars;
no format-result caching or cross-call state; abort/drain of the slow regression;
original limits and single-item authorization/domain/transaction paths unchanged;
actual before/after inputs and hardware versus product/runtime acceptance; preserve
original 50 UAT and unresolved Today/share-transfer diagnostics.
