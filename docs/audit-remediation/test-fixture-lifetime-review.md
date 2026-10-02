# B07 independent review and single fix pass

Fresh independent Codex GPT-6.1 Sol reviewer, read-only `baaa1a2..9e8b6a0`.
Verdict: with fixes;0Critical/2Important/0Minor. No re-review.
Original evidence hashes/UAT hash matched; guard semantics follow installed postgres/Vitest.

## Important findings and actual verification

1. Two independent NAR concurrency-worker pools passed raw SQL into repositories.
   Actual worker factory probe RED: post-abort fixture-origin company committed,
   causing owned-user FK cleanup failure; original company1/batch1/users2/template1 and late company1 remained.
   Both existing worker paths now share the captured signal; raw pools are shutdown-only.
2. Parent of the failed NAR child had no cancellation ownership.
   Actual native Node child/Postgres RED: after parent cancellation it still wrote1 row.
   The owner now terminates its own direct child and awaits close in `finally`/`onTestFinished`.
   The controlled Vitest child uses threads, so root termination includes its test workers.
   No generic process-tree killer, unrelated process termination or higher timeout is introduced.

Corrected assertion RED2/2,14.87s; all9 lifetime regressions GREEN/0skip,9.77s.
Both original independent-connection concurrency contracts GREEN2/20name-filtered,13.08s.
Initial synthetic-field/alias setup mistakes and type narrowing failure remain in raw logs;
they are not substituted for the genuine RED. The parent now also requires exactly one CLI
failure block, so an additional independent cleanup/SQL error cannot masquerade as its expected timeout.
Raw reviewed-RED database is retained. Complete final fix-head Linux22/24 suite is mandatory before merge;
actual full-CI/merge/main/preview/live receipts are recorded in PR118 after occurrence.

Forced child termination does not promise to undo already committed synthetic rows.
Failed databases remain available for inspection; only a newly created, UUID-named test table
is removed by its awaited cleanup. Already-started SQL, indefinite stalls and the original10s hook limit
retain the documented diagnostic limitations. Production/provider/UAT acceptance remains unchanged.

## Declined behaviors: executor rulings

Each original reviewer line was assessed; none silently became accepted runtime behavior.

| Behavior                                               | Ruling and reason                                                | Cost if wrong                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------ |
| NAR100 latency                                         | Keep unresolved; cleanup changes do not establish its cause.     | Existing120s timeout may recur.                        |
| Today timing                                           | Keep unresolved; no loading implementation change.               | Windows timing failure may recur.                      |
| Share-transfer timing                                  | Keep unresolved; no domain/repository change.                    | Existing30s timeout may recur.                         |
| Cancel already-started SQL                             | Excluded; deny subsequent guarded work, no unknown-result retry. | Already-started work may complete.                     |
| Indefinite body/rollback/SQL/cleanup                   | Fail under existing finite budgets; no success claim.            | Owned rows can remain for diagnosis.                   |
| Drain beyond10s hook budget                            | Preserve original budget and report failure.                     | Runner may advance before settlement.                  |
| Forced runner/machine termination                      | No JavaScript cleanup guarantee.                                 | Committed fixture rows may remain.                     |
| Cursor iterators                                       | No scoped caller; not a general SQL wrapper claim.               | New use requires driver/lifetime contracts.            |
| Reserved SQL clients                                   | No scoped caller; not wrapped.                                   | New use could escape lifetime.                         |
| Subscriptions/listeners/large objects                  | No scoped caller; separate resource contracts if adopted.        | New resources could outlive the test.                  |
| Manual/prepared distributed transactions               | No scoped caller; existing callback transactions covered.        | New transaction API needs a commit boundary.           |
| Detached SQL after completed fixture                   | No such scoped path found; new ownership would be required.      | Future detached work could escape.                     |
| Production/auth/schema/providers/deploy/lineage/owners | Absent from diff; existing release gates remain.                 | Formal release remains blocked.                        |
| New F01–F20/provider/UAT acceptance                    | Unclaimed; original19 LOCAL ONLY/31blocked stays.                | Genuine31 acceptance remains outstanding.              |
| Final-head/main CI/merge/live alias                    | Verify independently after review, binding exact heads.          | Stale observations must never authorise merge/release. |

Deferred minors: none. The earlier B06 deferred documentation minor is outside this review.
