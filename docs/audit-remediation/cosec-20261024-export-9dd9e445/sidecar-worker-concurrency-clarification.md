# UC157 sidecar worker-limit clarification

Recorded at 2026-10-23T18:50:07.227Z.

The human user clarified that there was no limit of one focused test invocation. The parent instruction "one small focused worker only" bounded concurrency and resource use, not the total number of focused invocations.

Earlier sidecar statements attributing a one-invocation limit to the user were an incorrect interpretation. In particular, the ONE_FOCUSED_RUN_LIMIT explanation in sidecar-green-status.json, and related wording in the initial runner/classification/handoff/freeze receipts, must not be read as an actual user-imposed invocation limit. Historical files remain preserved unchanged. This note corrects only that interpretation; it does not change any recorded run result, timing, resource reading, hash, or failure classification.

The source and test remain frozen at the SHA256 and byte counts recorded in sidecar-final-frozen.json. The previous focused green result remains 5 passed / 0 failed. No additional tests or source/test edits were performed for this clarification. Parent will run the repaired five cases under its own focused/full verification gates.

This note is append-only. Existing receipts and manifests remain unchanged and describe their historical snapshots.
