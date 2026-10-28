# Review 2 — queue findings 1 and 4 disposition

Reviewed: 2026-10-23 HKT (source fingerprint capture: 2026-10-22T21:32:55Z).  
Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`  
Branch/base: `codex/cosec-20261023` / `1c57a67213af72bff8d776694e6ed8c986b921db`, plus the current shared dirty sources/new files.

## Disposition

**Findings 1 and 4 are resolved at the inspected local-source and parent-focused-unit evidence layer.** No additional actionable defect was established within those two fixes. This does not close full-suite, authenticated runtime, native browser, DB, deployment or production acceptance.

The original `REVIEW-2.md` is preserved unchanged. This pass wrote only this disposition receipt; it did not edit source/tests/other receipts, run tests or linters, connect to DB, call the network, or create a commit.

## Finding 1 — queue return serialization

Current `src/features/work-items/queue-view-state.ts:33–36` uses the installed router's `defaultStringifySearch` to build the return URL. The old plain `URLSearchParams` builder is gone. Its copy of the search excludes the internal `contextError` field.

The installed `@tanstack/router-core/src/searchParams.ts` confirms the necessary symmetry: `defaultParseSearch` JSON-parses scalar values, and `defaultStringifySearch` JSON-quotes string values that would otherwise be parsed into a different type. `src/router.tsx` does not override either default. Consequently a JSON cursor is serialized as a string and retains its microsecond timestamp text; numeric q text remains text on the generated return journey. The queue parser also normalizes scalar numeric/boolean q values from a directly copied URL into strings rather than dropping the search.

`src/features/work-items/queue-view-state.test.ts` now uses the real `defaultParseSearch`, rather than `Object.fromEntries(new URL(...).searchParams)`, for the full filter/page round trip. Its second case checks q `123` and a production-shaped JSON cursor containing scope, rank, due, priority, UUID and version; the returned cursor must exactly equal the original string. It separately checks directly parsed `?q=123`. Unsafe/unrelated return paths remain rejected by the existing safe-return checks.

Source consumers were checked: `src/routes/work-queue.tsx:151` calls this builder, and the annual-return/corporate-change detail return anchors pass their returnTo through `caseReturnPath`. The corrected builder therefore reaches the actual detail return action.

**Accepted for finding 1 at the local source/unit layer.** No SQL cursor execution or mounted authenticated router/browser journey was performed in this review.

## Finding 4 — malformed/repeated filters must not widen reads

Current `queueViewSearch` validates supplied enum choices, owner identity, work-type scalar/length, cursor scalar/length and q scalar shape before reporting normalized defaults. Arrays from repeated q/owner/status values set `contextError=true` instead of being treated as a usable unfiltered search. The flag is computed from input shape; it is not trusted from a supplied contextError query parameter.

`src/routes/work-queue.tsx:73–78` checks that flag in its outer component before mounting `WorkQueueSession`. The session owns `useQuery(listWorkQueuePage)` and the bulk toolbar, so malformed context cannot start those reads through the normalized fallback values. The error screen has an alert and an explicit reset action that navigates to `queueViewSearch({})`; a default read occurs only after the operator chooses recovery.

The real-parser tests cover the original trigger `?view=team&q=a&q=b` plus repeated owner and status filters. The component regression verifies that the invalid-context screen renders an alert, the queue server stub is not called, the bulk component is not mounted, and the reset action requests clean default search state. The component test injects contextError through mocked route hooks, so the complete assurance here combines that guard test with the real parser/helper cases and inspected route wiring; it is not represented as an unmocked end-to-end route test.

**Accepted for finding 4 at the local source/unit layer.** No global/broader queue or snapshot read is reachable from the inspected invalid-input branch before explicit recovery.

## Parent evidence inspected, not rerun

Command recorded in both supplied files:

```text
vitest run --project unit src/features/work-items/queue-view-state.test.ts src/routes/-work-queue.interaction.test.tsx --maxWorkers 1
```

| Evidence | Observed result | Interpretation |
| --- | --- | --- |
| `REVIEW-2-queue-red.txt` | 2 failed files; 6 failed / 12 passed; 18 total | Five helper failures (two serialization and three repeated-filter cases), plus one missing invalid-context guard failure. Preserved historical RED output. |
| `REVIEW-2-queue-green.txt` | 2 passed files; 18 passed; duration 4.04s | Parent-recorded focused GREEN result. The helper has 11 cases and the component file 7 cases; 18 is the combined focused total, not 18 unmocked browser tests. |

The GREEN log includes the existing vite-tsconfig-paths advisory and the WorkQueueRoute export/code-splitting advisory. They are warnings, not failed tests. The RED log also includes its historical undefined-query-data diagnostic when the missing guard allowed the queue read; this is not a new GREEN failure.

This review independently checked the present source and tests against the reported behavior. The log does not itself cryptographically bind a test run to the current dirty source files; the hashes below identify what was inspected. The parent's final combined full-unit run is still pending and must bind acceptance to the eventual final shared source state. No full-suite or native acceptance is inferred from this receipt.

## Reviewed fingerprints (SHA256)

| File | SHA256 |
| --- | --- |
| `src/features/work-items/queue-view-state.ts` | `adc48ccb434780643e51ab259a8188e689850b9abd4a8d257f927d225a05febb` |
| `src/features/work-items/queue-view-state.test.ts` | `9c15879d0b2fd11080d381b5a1c8a448c213e22ad53d0b1b211ed1eb83918e61` |
| `src/routes/work-queue.tsx` | `2139a726ae8698162b4cbbc00bb1c99d180936c2f3de17cab7e5112c02b69d72` |
| `src/routes/-work-queue.interaction.test.tsx` | `9d1f5f95e471994c6e557f750d4670fc49325e80a021ac48bfabf6b9dcfc067d` |
| `REVIEW-2-queue-green.txt` | `b12fc7febc2558bfc393f5667dc8df6b4ae8978caed69b67c274559c97dfe1a4` |
| `REVIEW-2-queue-red.txt` | `7c442224ea304d32a5f9d0e85f64f61011814262b5e5db1d2b264c272a79c8d3` |

## Ownership preserved

The completed Today fixes and daily cursor serializer were not edited. The parent owns queue implementation and final combined verification; Noether owns R20 refresh; Dirac now exclusively owns the caseReturnPath client-UUID-detail change and finding 6. Neither that sanitizer nor any source-interface change was made in this review pass.
