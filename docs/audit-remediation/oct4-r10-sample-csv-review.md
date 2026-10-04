# R10 sample CSV — whole-branch review and author rulings

One fresh read-only reviewer (`review_r10_sample_csv`, GPT6 Astra) reviewed
`f61b1ae70954311fac314d1069785445f91ee7a2..6d3642e9bcfcad78dcb75ba5b9bf571038bce28e`,
all nine changed files, master R10, this plan and its ledger. No extra reviewer
or implementation agent. Verdict: **0 Critical / 0 Important / 0 Minor**;
source ready subject to exact-head CI. No fix pass or deferred minor.

The reviewer verified 27 source/raw hashes and 177 protected artifacts, original
UAT/migrations/locks/CI/benchmark preservation, only R10 tracker row changes,
baseline26/RED14+1/focused41/full241files2304PASS0FAIL0SKIP, actual PG18/Node22/Bun
identities and exact tmpfs cleanup. Independent in-memory probes exercised absent
timings, zero duration, errors, identifiers, nonmutation and matching CSV/JSON
refusal. No provider/DB/file mutation was performed by the reviewer.

## Author rulings on every declined gate

Each row records what the user of this scoped tool receives, why the boundary
stands, and the cost if that decision is wrong. These are retained external or
publication gates, not new acceptance results.

| #   | Declined subject                                        | Author ruling / reason                                                                                                                                                                    | Cost if wrong                                              |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | 25-user concurrency / representativeness                | CSV preserves observations; genuine profile/timeline still needs owner approval and capture.                                                                                              | False load/concurrency acceptance.                         |
| 2   | Cold DB/OS/platform state                               | Cache label remains a caller assertion; no cache reset or cold-proof claim.                                                                                                               | Misleading cold percentiles.                               |
| 3   | Adopted SLO / PASS                                      | Always not_assessed/NO_GO; SLO owner and actual metrics remain required.                                                                                                                  | Unauthorised performance acceptance.                       |
| 4   | Hosted region/pool/hardware/RTT equivalence             | No hosted profile was run; original JSON metadata and independent target receipts are required.                                                                                           | Wrong topology recommendation.                             |
| 5   | Upstream sample authenticity/completeness               | Export every supplied error/success; runner attempted/completed/unknown totals need separate audit.                                                                                       | Omitted failures bias results.                             |
| 6   | Production/scheduler SHA, resolved SBOM, provider state | Closing metadata can confirm web identity only; scheduler/SBOM/genuine provider receipts remain unverified.                                                                               | False release parity.                                      |
| 7   | B1/role/owners/freeze/schema/hosted restore             | Retain exact capability blocker and original approval; no parameter retry or hosted SQL in this slice.                                                                                    | Unsafe access or DDL assumptions.                          |
| 8   | Native ticks/failure/recovery/queue/unknown             | No manual or synthetic tick promoted; native acceptance stays blocked.                                                                                                                    | Stale queues or duplicate dispatch.                        |
| 9   | Auth/storage/scanner/AI/WhatsApp/payment/invite/filing  | Local regression only; controlled genuine identities/bytes/receipts are separate.                                                                                                         | Unsafe authorisation or provider claims.                   |
| 10  | Business/original50 genuine UAT                         | Original50 byte-preserved, 19historicalLOCALONLY/31blocked/newgenuine0.                                                                                                                   | False business sign-off.                                   |
| 11  | Plans/tuning/payload/render/SLA100/NAR100 speedup       | No runtime tuning or new before/after result; preserve previous dated measurements.                                                                                                       | Unsupported speedup claim.                                 |
| 12  | Hosted fixture cleanup/public counts                    | No hosted fixtures or load created; owned local regression target removed separately.                                                                                                     | Unaccounted hosted data changes.                           |
| 13  | Current daemon state after cleanup                      | Executor captured exact ID/label/tmpfs/mount guards and post-removal remaining0; closing check remains its responsibility.                                                                | Leaked local resource.                                     |
| 14  | Remote availability of ignored raw receipts             | Keep owned local files/hash manifest; CI logs are remote source gates, not a replacement for local PG18 receipts. Approved artifact-store retention is an owner input for external audit. | Remote reviewers cannot inspect lost raw evidence.         |
| 15  | Exact-head CI/normal merge/main CI                      | Executor must verify every head check, match the head during normal merge and inspect independent main CI. Dated tracker snapshot is closed by actual PR receipts.                        | Untested source merged or mismatched proof.                |
| 16  | Spreadsheet autoformatting                              | Identity/SHA import uses text columns; source JSON/hash retained. Formula prefixes are neutralised in CSV.                                                                                | Display coercion corrupts identity comparison.             |
| 17  | CRLF Git whitespace warning                             | Preserve original tracker record endings; use cr-at-eol for whole-branch whitespace validation, retaining default warnings as evidence.                                                   | Tooling treats valid record endings as whitespace defects. |

Initial ledger ruling: automatic approval review rejected graph indexing due to
private-source destination risk and the user's local-read choice. Known-path
local review/reading is the safe alternative; no indirect indexing. Cost: reduced
graph-assisted discovery. No renewed permission request was needed for local work.

## Delivery boundary

Local receipt: `evidence/2026-10-04-r10-sample-csv.json`. Source/CI/review completion
does not complete hosted R10 or R01–R11 genuine acceptance. Formal release NO_GO.
Exact final head, all checks, merge parents/main CI and closing resource observations
are recorded in the delivery PR after they actually happen, avoiding invented
self-referential commit hashes or a receipt-only follow-up PR.
