# T21 performance evidence — 2026-10-02

Source: `3b4e4bad70a5a72485068b079982b824c210af8f`. Actual command: `TEST_DATABASE_URL=<dedicated-local> DATABASE_SSL=disable bun scripts/benchmark-audit-queries.ts`. Bun1.3.14 (reports Node compatibility24.3.0), Windows x64/i5-12500/12 logical CPUs/34,033,348,608 bytes RAM; Postgres17 localhost55441/kossilon_pr02_ci. This benchmark is separate from actual Node22.23.3 Vitest/Chrome gates.

The same owned schema,10,000 synthetic cases/checklist rows and50,000 metadata-only documents is used before/after. Authorised scope is the same synthetic company-name prefix. Today baseline runs the existing sequential listAllCases then canonical deriveWorkViews; after reads50 rows plus independently aggregated full-scope counts. Document baseline is a conservative unbounded metadata SQL lower bound, excluding expensive version joins; it is not a claim to reproduce the old browser or every old repository cost. No provider/object bytes or production load.

## Measured warm workloads

| Workload | Concurrent users | Before p50/p95 ms | After p50/p95 ms |
| --- | ---: | ---: | ---: |
| Today page + all metrics | 1 (5 samples) | 7771.7 / 8173.3 | 114.6 / 124.4 |
| Today page + all metrics | 10 (one wave) | 20896.6 / 21678.1 | 280.9 / 318.5 |
| Today page + all metrics | 25 (one wave) | 58490.2 / 59207.5 | 458.9 / 525.0 |
| Documents metadata | 1 (5 samples) | 252.8 / 314.3 | 46.4 / 107.3 |
| Documents metadata | 10 (one wave) | 2380.1 / 2837.4 | 141.9 / 209.3 |
| Documents metadata | 25 (one wave) | 6029.0 / 7380.5 | 466.1 / 661.9 |

All164 measured requests succeeded. Today warm single-user query count201→12 (includes transaction/JIT control statements); returned row DTOs10000→50; JSON2,500,980→12,808 bytes. Documents query count1→1; DTOs50000→100; JSON27,950,001→72,307 bytes. Raw JSON records per-wave heap/RSS deltas, first-sample observations, full query plans and errors. Negative memory deltas are garbage collection, not negative memory consumption; no peak/capacity claim.

First measured statement samples: Today7779.4→142.8ms; documents269.4→43.1ms. Fixture creation has already used a connection and warmed buffers. The raw label `first connection/statement` does not establish genuinely cold OS/database caches; those were not flushed. Five warm samples and one10/25-user wave give limited statistical confidence. The final run was sequential, after other test/diagnostic processes completed. Initial pre-JIT observations overlapped a diagnostic and are retained separately, not used as the final comparison.

## Query-plan decisions

Actual EXPLAIN ANALYZE BUFFERS found398 JIT functions taking6187.568ms versus8.201ms execution with transaction-local JIT disabled. Operational read transactions now disable JIT and restore the previous setting, including nested transactions. The final scoped metrics plan executes18.113ms. No global DB setting or index migration was added. Current metadata page is materialized with actor/search/cursor/LIMIT before version/intents hydration; this addressed an actual120s scale timeout without increasing it.

Postgres.js timestamp serialization lost microseconds and skipped pages. Cursor boundaries now preserve raw database timestamps and pass them as text before server-side timestamptz conversion. Actual owned transaction tests traverse all10,000 cases and50,000 documents without duplication/loss, reach201/401/5001/10000/50000 by authorised search, and return zero cross-scope rows. Canonical domain/readiness SQL parity remains enforced; commands still recheck current evidence under locks.

## Actual browser observations

Installed Chrome, read-only demo,390×844/1280×900:2 timing/network tests PASS8.5s. LCP600/596ms, CLS0/0; Event Timing INP candidates40/56ms from few navigation interactions. These are observed local values, not field INP or a production core journey. Actual route resources show no pdfjs-dist/mammoth/doc-parser/PDF worker before file parsing. Existing knowledge-base upload already dynamically imports its parser; no overlapping loader was introduced. Earlier selector failures are retained as test-harness failures, not product performance evidence.

## Gates and limitations

Focused Node22/Postgres17:12 files97 tests PASS0skip124.31s; typecheckPASS; lint0errors/1existing warning. Separate Chrome navigation/layout4 tests PASS and timing2 tests PASS. Benchmark cleanup confirms only its owned schema removed and public company/case/document counts unchanged.

The proposed staging≤1s list/metrics budget has not been accepted by the business/release owner. Production hardware, real officer/version distribution, genuine Auth sessions, platform HTTP/render latency and cold-cache behavior remain unverified. PERF-01 stays blocked for staging acceptance, with this local evidence attached.

Evidence: `evidence/2026-10-02-t21-performance.json`, `*-performance-prejit.json`, `*-query-plans.json`, `t21-*-browser-performance.json`; task/gate log hashes in `evidence/2026-10-02-t21-gates.json`. Source migration set remains50IDs (0001–0034,0067–0082), distinct from last observed production66 historical IDs. No production mutation/deployment/send.
