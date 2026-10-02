# B05 whole-branch review and one fix pass

Fresh independent Codex GPT-6.1 Sol review of
`73d999dfa524f273d0c062458cbf780f65630e6c..362e127b596f9c59c5b5040aa5a7e03332f4be83`:
0 Critical / 3 Important / 0 Minor. Read-only; no second review dispatched.

| Important finding                             | Actual RED                                                                                                                         | Fix and GREEN                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enforcement flags missing from fingerprint    | Disabling an immutable trigger and genuinely failed CREATE UNIQUE INDEX CONCURRENTLY both retained the same hash; two tests failed | Include tgenabled and indisvalid/indisready/indislive; both state changes now alter hash and refuse mismatched catalog                                                          |
| Catalog checked before protecting table locks | Other connection successfully added incompatible evidence text while compiled preflight held only ledger lock                      | Lock all82 attributable tables before catalog, held through transaction; two-session DDL and cooperating function-DDL lock fail55P03                                            |
| Transient full handoff uniqueness             | Compiled0080 raised23505 for legitimate returned/cancelled same-manifest history                                                   | Intermediate index is non-unique; original0081 creates final active-attempt uniqueness. Completed history retained/new attempt allowed; outstanding unknown remains fenced23505 |

Focused actual Postgres17 suite:17/17PASS. Full Postgres18.6/66-original-SQL rehearsal:
all82original table row hashes and66ledger unchanged; forced pre-receipt failure rolls
back; repeat refused;94localtables/1actualreceipt. Includes two completed same-manifest
handoffs and one legacy unknown attempt. Evidence contains exact SQL/payload/catalog
hashes and actual local command. No provider write/production recovery/UAT claim.

Initial exact362e127 full CI37025726591 failed only integration registry convention
(2195PASS/1FAIL,231files), exposing the new test file not in serialized DB project.
The existing registry is updated; no gate relaxed. Fresh fixed-head full CI receipts
are appended in status.md and PR#116 after actual completion.

## Behaviors the reviewer declined to judge, and executor decisions

- Provider clone/restore and real workload: remain blocked; local synthetic evidence
  cannot establish genuine recovery/performance.
- Seven extra tables/owners/grants/non-FK dependencies: preserve all objects; owner
  review remains blocked, including DDL-owner/freeze proof.
- Fresh Auth/R2/scanner/OCR/AI/WOZTELL/external handoff/original blocked UAT: remain
  blocked; synthetic SQL/mock/dry-run/current session is not real acceptance.
- Production deployment/parity/scheduler activation: separately gated; preview/CI
  does not prove permissions or native scheduled ticks.
- Application lineage policy and old workflow retirement/recovery: remain unresolved;
  preserve unknown receipts/work and refuse replay.
- Fresh full CI: wait for its real exact-head logs; reviewed head's failed registry
  result is retained and superseded only by observed fixed-head completion.

Approved function DDL must acquire the existing schema advisory lock. Table locks
cannot serialize privileged function DDL that ignores it; production is NO_GO until
the release owner proves sole DDL owner/freeze and permissions. No grant/revoke is
executed by this package. Costs of each retained gate are documented in the runbook.
Deferred Minor findings: none.
